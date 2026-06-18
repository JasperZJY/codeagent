import { ChangeTracker } from "./changeTracker.js";
import { SessionStore, type PersistedSession } from "./session.js";
import { TaskStore } from "./tasks.js";
import type { ConversationMessage, ResumeState } from "./types.js";

export async function buildResumeState(
  workspaceRoot: string,
  session?: PersistedSession
): Promise<ResumeState> {
  const activeSession = session ?? await latestSession(workspaceRoot);
  const taskPlan = await new TaskStore(workspaceRoot).resumeLatestIncomplete();
  const changes = await new ChangeTracker(workspaceRoot).summarizeLatest();
  const executedCommands = activeSession ? collectExecutedCommands(activeSession.messages) : [];
  const validationStatus = inferValidationStatus(activeSession?.messages ?? [], taskPlan?.status);
  const blockedReasons = collectBlockedReasons(activeSession?.messages ?? [], taskPlan);
  const nextSteps = inferNextSteps(validationStatus, blockedReasons, taskPlan?.status);
  const state: ResumeState = {
    goals: activeSession?.goals ?? [],
    changedFiles: changes.files.map((file) => ({
      path: file.path,
      status: file.status,
      toolName: file.toolName
    })),
    executedCommands,
    validationStatus,
    blockedReasons,
    nextSteps
  };
  if (activeSession) {
    state.sessionId = activeSession.sessionId;
    const lastPrompt = activeSession.promptHistory.at(-1);
    if (lastPrompt) {
      state.lastPrompt = lastPrompt;
    }
  }
  if (taskPlan) {
    state.taskPlan = taskPlan;
  }
  return state;
}

async function latestSession(workspaceRoot: string): Promise<PersistedSession | undefined> {
  return (await new SessionStore(workspaceRoot).list())[0];
}

function collectExecutedCommands(messages: ConversationMessage[]): string[] {
  const commands: string[] = [];
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === "tool_use" && block.name === "shell" && block.input && typeof block.input === "object") {
        const command = (block.input as Record<string, unknown>)["command"];
        if (typeof command === "string") {
          commands.push(command);
        }
      }
    }
  }
  return [...new Set(commands)];
}

function inferValidationStatus(
  messages: ConversationMessage[],
  taskStatus: string | undefined
): ResumeState["validationStatus"] {
  const shellResults = messages
    .flatMap((message) => message.blocks)
    .filter((block) => block.type === "tool_result" && block.toolName === "shell");
  const latest = shellResults.at(-1);
  if (latest?.type === "tool_result") {
    const output = latest.output && typeof latest.output === "object" ? latest.output as Record<string, unknown> : {};
    return output["code"] === 0 && !latest.isError ? "passed" : "failed";
  }
  if (taskStatus === "blocked") {
    return "blocked";
  }
  if (taskStatus === "failed") {
    return "failed";
  }
  return "unknown";
}

function collectBlockedReasons(
  messages: ConversationMessage[],
  taskPlan: Awaited<ReturnType<TaskStore["loadCurrent"]>>
): string[] {
  const reasons: string[] = [];
  for (const task of taskPlan?.tasks ?? []) {
    if ((task.status === "blocked" || task.status === "failed") && task.evidence) {
      reasons.push(`${task.id}: ${task.evidence}`);
    }
  }
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === "tool_result" && block.isError) {
        reasons.push(`${block.toolName}: ${shorten(String(block.output), 240)}`);
      }
    }
  }
  return [...new Set(reasons)].slice(0, 12);
}

function inferNextSteps(
  validationStatus: ResumeState["validationStatus"],
  blockedReasons: string[],
  taskStatus: string | undefined
): string[] {
  if (blockedReasons.length > 0 || validationStatus === "failed" || validationStatus === "blocked" || taskStatus === "blocked") {
    return [
      "Inspect blocked reasons and recent validation output.",
      "Use /changes or /diff to review agent modifications.",
      "Resume the incomplete plan with /resume-task after resolving blockers."
    ];
  }
  return [
    "Review /plan and continue pending tasks.",
    "Run validation commands if code changed.",
    "Use /context to check context pressure before continuing."
  ];
}

function shorten(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
}
