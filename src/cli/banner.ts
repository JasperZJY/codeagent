import path from "node:path";
import type { ContextCompactionReport } from "../core/context.js";
import type { MemoryEntry } from "../core/memory.js";
import type { RagSearchResult } from "../core/rag.js";
import { toSessionMetadata } from "../core/sessionManager.js";
import { workspaceFingerprint, type PersistedSession } from "../core/session.js";
import type {
  AgentGoal,
  AgentTaskPlan,
  ContextMonitorReport,
  ProjectCommandProfile,
  ProjectInitResult,
  ResumeState,
  RuntimeConfig
} from "../core/types.js";
import { slashCommandHelp } from "./slash.js";

export function renderBanner(config: RuntimeConfig, session: PersistedSession): string {
  return [
    "  ____          _        _                    _",
    " / ___|___   __| | ___  / \\   __ _  ___ _ __ | |_",
    "| |   / _ \\ / _` |/ _ \\/ _ \\ / _` |/ _ \\ '_ \\| __|",
    "| |__| (_) | (_| |  __/ ___ \\ (_| |  __/ | | | |_",
    " \\____\\___/ \\__,_|\\___/_/   \\_\\__, |\\___|_| |_|\\__|",
    "                              |___/",
    "",
    renderStatus(config, session),
    "",
    "Type /help for commands. Use Shift+Enter in terminals that support multiline input."
  ].join("\n");
}

export function renderStatus(config: RuntimeConfig, session: PersistedSession): string {
  return renderRows([
    ["Profile", config.profile ?? "default"],
    ["Provider", config.provider],
    ["Model", config.model],
    ["Permissions", config.permissionMode],
    ["Workspace", path.resolve(config.workspaceRoot)],
    ["Session", session.title ?? session.sessionId],
    ["Session id", shortId(session.sessionId)],
    ["Messages", String(session.messages.length)],
    ["Usage", `input=${session.usage.inputTokens} output=${session.usage.outputTokens}`],
    ["Dialog blocks", config.dialogBlocks === false ? "off" : "on"],
    ["Token usage", config.showTokenUsage === false ? "off" : "on"],
    ["Summary", config.summaryMode ?? "auto"],
    ["Terminal mode", config.terminalMode ?? "tui"],
    ["Auto-save", sessionPath(config, session)]
  ]);
}

export function renderInteractiveHelp(): string {
  const width = Math.max(...slashCommandHelp.map((entry) => entry.usage.length));
  return [
    "Interactive commands:",
    "",
    ...slashCommandHelp.map((entry) => `  ${entry.usage.padEnd(width)}  ${entry.description}`)
  ].join("\n");
}

export function renderSessionSummary(config: RuntimeConfig, session: PersistedSession): string {
  return [
    "Current session:",
    renderRows([
      ["Title", session.title ?? session.sessionId],
      ["Summary", session.summary ?? "none"],
      ["Session id", session.sessionId],
      ["Messages", String(session.messages.length)],
      ["Created", session.createdAt],
      ["Updated", session.updatedAt],
      ["Workspace", session.workspaceRoot],
      ["Profile", session.profile ?? config.profile ?? "default"],
      ["Provider", session.provider ?? config.provider],
      ["Model", session.model ?? config.model],
      ["Prompts", String(session.promptHistory.length)],
      ["Usage", `input=${session.usage.inputTokens} output=${session.usage.outputTokens}`],
      ["Path", sessionPath(config, session)]
    ])
  ].join("\n");
}

export function renderSessions(sessions: PersistedSession[]): string {
  if (sessions.length === 0) {
    return "No saved sessions found for this workspace.";
  }
  const titleCounts = countTitles(sessions);
  return [
    "Available sessions:",
    "",
    ...sessions.slice(0, 20).map((session, index) => {
      const metadata = toSessionMetadata(session);
      const title = disambiguatedTitle(session, titleCounts);
      return [
        `${index + 1}. ${title}`,
        `   updated: ${formatDate(metadata.updatedAt)} · messages: ${metadata.messageCount} · profile: ${metadata.profile ?? "default"} · model: ${metadata.model ?? "unknown"} · id: ${shortId(metadata.id)}`,
        `   workspace: ${metadata.workspaceRoot}`,
        metadata.summary ? `   summary: ${metadata.summary}` : undefined
      ].filter(Boolean).join("\n");
    })
  ].join("\n");
}

export function renderCompactionReport(report: ContextCompactionReport): string {
  if (!report.compacted) {
    return [
      "Context compact skipped.",
      renderRows([
        ["Session", report.sessionId],
        ["Messages", String(report.beforeMessages)],
        ["Keep", String(report.keepMessages)]
      ])
    ].join("\n");
  }
  return [
    "Context compacted.",
    renderRows([
      ["Session", report.sessionId],
      ["Before", String(report.beforeMessages)],
      ["After", String(report.afterMessages)],
      ["Compressed", String(report.compactedMessages)],
      ["Retained", String(report.retainedMessages)],
      ["Usage", `input=${report.usage.inputTokens} output=${report.usage.outputTokens}`]
    ]),
    "",
    report.summaryPreview
  ].join("\n");
}

export function renderGoals(goals: AgentGoal[]): string {
  if (goals.length === 0) {
    return "No active goals.";
  }
  return [
    "Active goals:",
    "",
    ...goals.map((goal) => {
      const evidence = goal.evidence ? `  ${goal.evidence}` : "";
      return `- [${goal.status}] ${goal.id} ${goal.title}${evidence}`;
    })
  ].join("\n");
}

export function renderTaskPlan(plan: AgentTaskPlan | undefined): string {
  if (!plan) {
    return "No active task plan.";
  }
  return [
    `Task plan: ${plan.id}`,
    renderRows([
      ["Status", plan.status],
      ["Created", plan.createdAt],
      ["Updated", plan.updatedAt]
    ]),
    "",
    ...plan.tasks.map((task) => {
      const suffix = task.evidence ? `\n  ${task.evidence}` : "";
      return `- [${task.status}] ${task.id} ${task.title}${suffix}`;
    })
  ].join("\n");
}

export function renderProjectProfile(profile: ProjectCommandProfile): string {
  const commands = Object.entries(profile.commands);
  return [
    "Project command profile:",
    "",
    renderRows([
      ["Workspace", profile.workspaceRoot],
      ["Detected", profile.detections.map((item) => `${item.type}:${item.file}`).join(", ") || "none"],
      ["Updated", profile.updatedAt]
    ]),
    "",
    "Commands:",
    ...(commands.length ? commands.map(([kind, command]) => `- ${kind}: ${command}`) : ["- none"]),
    "",
    "Warnings:",
    ...(profile.warnings.length ? profile.warnings.map((warning) => `- ${warning}`) : ["- none"])
  ].join("\n");
}

export function renderProjectInit(result: ProjectInitResult): string {
  return [
    "Project initialized:",
    "",
    renderRows([
      ["Project", result.projectPath],
      ["Rules", result.rulesPath],
      ["Commands", result.commandsPath],
      ["Outline files", String(result.outlineFiles)]
    ]),
    "",
    "Risks:",
    ...(result.risks.length ? result.risks.map((risk) => `- ${risk}`) : ["- none"])
  ].join("\n");
}

export function renderContextReport(report: ContextMonitorReport, mode: "context" | "tokens" | "cost" = "context"): string {
  if (mode === "tokens") {
    return renderRows([
      ["Session", report.sessionId],
      ["Messages", String(report.messages)],
      ["Total input", String(report.usage.inputTokens)],
      ["Total output", String(report.usage.outputTokens)],
      ["Active estimate", String(report.estimatedActiveTokens)],
      ["Tool result tokens", String(report.toolResultTokens)]
    ]);
  }
  if (mode === "cost") {
    return renderRows([
      ["Provider", report.cost.provider],
      ["Model", report.cost.model],
      ["Local", report.cost.local ? "yes" : "no"],
      ["Estimated USD", report.cost.estimatedUsd === undefined ? "unavailable" : String(report.cost.estimatedUsd)],
      ["Note", report.cost.note]
    ]);
  }
  return [
    "Context monitor:",
    "",
    renderRows([
      ["Session", report.sessionId],
      ["Messages", String(report.messages)],
      ["Prompts", String(report.promptHistory)],
      ["Usage", `input=${report.usage.inputTokens} output=${report.usage.outputTokens}`],
      ["Active estimate", String(report.estimatedActiveTokens)],
      ["Tool ratio", `${Math.round(report.toolResultRatio * 100)}%`],
      ["Compression", report.compressionMode],
      ["Compacted", report.compactionDetected ? "yes" : "no"],
      ["CCR entries", String(report.ccrEntries)]
    ])
  ].join("\n");
}

export function renderResumeState(state: ResumeState): string {
  return [
    "Resume state:",
    "",
    renderRows([
      ["Session", state.sessionId ?? "none"],
      ["Last prompt", state.lastPrompt ?? "none"],
      ["Validation", state.validationStatus],
      ["Changed files", String(state.changedFiles.length)],
      ["Commands", String(state.executedCommands.length)]
    ]),
    "",
    "Goals:",
    ...(state.goals.length ? state.goals.map((goal) => `- [${goal.status}] ${goal.title}`) : ["- none"]),
    "",
    "Plan:",
    ...(state.taskPlan ? state.taskPlan.tasks.map((task) => `- [${task.status}] ${task.id} ${task.title}`) : ["- none"]),
    "",
    "Changed files:",
    ...(state.changedFiles.length ? state.changedFiles.map((file) => `- ${file.status} ${file.path}`) : ["- none"]),
    "",
    "Executed commands:",
    ...(state.executedCommands.length ? state.executedCommands.map((command) => `- ${command}`) : ["- none"]),
    "",
    "Blocked reasons:",
    ...(state.blockedReasons.length ? state.blockedReasons.map((reason) => `- ${reason}`) : ["- none"]),
    "",
    "Next steps:",
    ...state.nextSteps.map((step) => `- ${step}`)
  ].join("\n");
}

export function renderMemory(entries: MemoryEntry[]): string {
  if (entries.length === 0) {
    return "No memory entries.";
  }
  return [
    "Project memory:",
    "",
    ...entries.map((entry) => `- ${entry.type} ${entry.text}`)
  ].join("\n");
}

export function renderRagIndexResult(result: unknown): string {
  if (!result || typeof result !== "object") {
    return String(result);
  }
  const object = result as Record<string, unknown>;
  return renderRows([
    ["RAG index", String(object["path"] ?? "")],
    ["Files", String(object["files"] ?? "")],
    ["Chunks", String(object["chunks"] ?? "")]
  ]);
}

export function renderRagMatches(matches: RagSearchResult[]): string {
  if (matches.length === 0) {
    return "No RAG matches. Run /rag index first if the index is empty.";
  }
  return [
    "RAG matches:",
    "",
    ...matches.map((match) => [
      `- ${match.path}:${match.startLine}-${match.endLine} score=${match.score}`,
      indent(shorten(match.text, 600))
    ].join("\n"))
  ].join("\n");
}

function countTitles(sessions: PersistedSession[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const title = session.title ?? session.sessionId;
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  return counts;
}

function disambiguatedTitle(session: PersistedSession, counts: Map<string, number>): string {
  const title = session.title ?? session.sessionId;
  if ((counts.get(title) ?? 0) <= 1) {
    return title;
  }
  return `${title} (${formatDate(session.updatedAt)} · ${shortId(session.sessionId)})`;
}

function shortId(value: string): string {
  return value.length <= 8 ? value : value.slice(0, 8);
}

function formatDate(value: string): string {
  return value.slice(0, 16).replace("T", " ");
}

function renderRows(rows: Array<[string, string]>): string {
  const width = Math.max(...rows.map(([key]) => key.length));
  return rows.map(([key, value]) => `${key.padEnd(width)}  ${value}`).join("\n");
}

function sessionPath(config: RuntimeConfig, session: PersistedSession): string {
  return path.join(
    config.workspaceRoot,
    ".code-agent",
    "sessions",
    workspaceFingerprint(session.workspaceRoot),
    `${session.sessionId}.json`
  );
}

function indent(value: string): string {
  return value.split(/\r?\n/).map((line) => `  ${line}`).join("\n");
}

function shorten(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}
