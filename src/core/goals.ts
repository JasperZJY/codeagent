import type { AgentGoal, ToolExecution } from "./types.js";
import type { PersistedSession } from "./session.js";

export function startTurnGoals(session: PersistedSession, prompt: string): AgentGoal[] {
  const goals = inferGoals(prompt);
  session.goals = goals;
  return goals;
}

export function updateGoalsFromExecution(goals: AgentGoal[], execution: ToolExecution): void {
  const now = new Date().toISOString();
  const affected = goals.filter((goal) => goal.status !== "done");
  if (affected.length === 0) {
    return;
  }

  if (!execution.ok) {
    for (const goal of affected) {
      goal.status = "blocked";
      goal.evidence = `${execution.toolName} failed: ${shorten(String(execution.output), 160)}`;
      goal.updatedAt = now;
    }
    return;
  }

  const goal = bestGoalForTool(affected, execution.toolName);
  if (!goal) {
    return;
  }
  goal.status = "done";
  goal.evidence = summarizeExecution(execution);
  goal.updatedAt = now;
}

export function markPendingGoalsRunning(goals: AgentGoal[]): void {
  const now = new Date().toISOString();
  for (const goal of goals) {
    if (goal.status === "pending") {
      goal.status = "running";
      goal.updatedAt = now;
    }
  }
}

export function summarizeGoals(goals: AgentGoal[]): string {
  if (goals.length === 0) {
    return "No active goals.";
  }
  return goals
    .map((goal) => `- [${goal.status}] ${goal.title}${goal.evidence ? ` (${goal.evidence})` : ""}`)
    .join("\n");
}

export function goalsMet(goals: AgentGoal[]): boolean {
  return goals.length > 0 && goals.every((goal) => goal.status === "done");
}

function inferGoals(prompt: string): AgentGoal[] {
  const lowered = prompt.toLowerCase();
  const goals: string[] = [];
  if (/(https?:\/\/\S+)/i.test(prompt) || includesAny(lowered, ["上网", "联网", "web search", "latest", "最新"])) {
    goals.push("Retrieve current external information");
  }
  if (includesAny(lowered, ["读取", "阅读", "查看", "list", "read", "文件", "目录"])) {
    goals.push("Inspect requested workspace context");
  }
  if (includesAny(lowered, ["搜索", "查找", "grep", "find"])) {
    goals.push("Search for relevant evidence");
  }
  if (includesAny(lowered, ["编写", "生成", "保存", "写入", "创建", "write", "create", "save"])) {
    goals.push("Create or update requested project artifact");
  }
  if (goals.length === 0) {
    goals.push("Answer the user request");
  }
  return goals.map((title, index) => ({
    id: `g${index + 1}`,
    title,
    status: "pending",
    updatedAt: new Date().toISOString()
  }));
}

function bestGoalForTool(goals: AgentGoal[], toolName: string): AgentGoal | undefined {
  if (toolName === "write_file" || toolName === "edit_file") {
    return findGoal(goals, "artifact") ?? findGoal(goals, "Create") ?? goals[0];
  }
  if (toolName === "read_file" || toolName === "list_dir") {
    return findGoal(goals, "Inspect") ?? goals[0];
  }
  if (toolName === "grep_search" || toolName === "glob_search" || toolName === "rag_search") {
    return findGoal(goals, "Search") ?? goals[0];
  }
  if (toolName === "web_search" || toolName === "fetch_url") {
    return findGoal(goals, "external") ?? goals[0];
  }
  return goals[0];
}

function findGoal(goals: AgentGoal[], token: string): AgentGoal | undefined {
  const lowered = token.toLowerCase();
  return goals.find((goal) => goal.title.toLowerCase().includes(lowered));
}

function summarizeExecution(execution: ToolExecution): string {
  if (execution.output && typeof execution.output === "object") {
    const output = execution.output as Record<string, unknown>;
    if (typeof output["path"] === "string") {
      return `${execution.toolName} ${output["path"]}`;
    }
    if (typeof output["numMatches"] === "number") {
      return `${execution.toolName} matched ${output["numMatches"]}`;
    }
    if (Array.isArray(output["entries"])) {
      return `${execution.toolName} listed ${output["entries"].length}`;
    }
  }
  return `${execution.toolName} ok`;
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function shorten(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
}
