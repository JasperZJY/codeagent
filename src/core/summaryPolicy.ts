import type { ConversationMessage, RuntimeTraceEvent, SummaryMode, TurnSummary } from "./types.js";

export interface SummaryDecision {
  shouldShowSummary: boolean;
  reason: string;
  style: "none" | "brief" | "full";
}

export function decideSummary(turn: TurnSummary, mode: SummaryMode = "auto"): SummaryDecision {
  if (mode === "off") {
    return { shouldShowSummary: false, reason: "summary disabled", style: "none" };
  }
  if (mode === "always") {
    return { shouldShowSummary: true, reason: "summary always enabled", style: "full" };
  }

  if (hasFailures(turn)) {
    return { shouldShowSummary: true, reason: "failure or blocked turn", style: "brief" };
  }
  if (turn.taskPlan) {
    return { shouldShowSummary: true, reason: "plan/todo was used", style: "brief" };
  }
  if (hasFileMutation(turn.toolResults)) {
    return { shouldShowSummary: true, reason: "files were modified", style: "brief" };
  }
  if (hasValidation(turn)) {
    return { shouldShowSummary: true, reason: "validation command ran", style: "brief" };
  }
  if (hasPythonExecution(turn.toolResults)) {
    return { shouldShowSummary: true, reason: "python execution ran", style: "brief" };
  }
  if (hasGitCheckpointOrDiff(turn.toolResults)) {
    return { shouldShowSummary: true, reason: "git/diff/checkpoint tool ran", style: "brief" };
  }
  if (turn.iterations > 2) {
    return { shouldShowSummary: true, reason: "multi-step task", style: "brief" };
  }
  return { shouldShowSummary: false, reason: "simple turn", style: "none" };
}

function hasFailures(turn: TurnSummary): boolean {
  return turn.stopReason === "error" ||
    turn.validation?.status === "failed" ||
    turn.validation?.status === "blocked" ||
    turn.toolResults.some((message) => message.blocks.some((block) => block.type === "tool_result" && block.isError));
}

function hasFileMutation(messages: ConversationMessage[]): boolean {
  return messages.some((message) => message.blocks.some((block) =>
    block.type === "tool_result" &&
    !block.isError &&
    (block.toolName === "write_file" || block.toolName === "edit_file")
  ));
}

function hasPythonExecution(messages: ConversationMessage[]): boolean {
  return messages.some((message) => message.blocks.some((block) =>
    block.type === "tool_result" &&
    block.toolName.startsWith("python_") &&
    block.toolName !== "python_risk" &&
    block.toolName !== "python_analyze_result"
  ));
}

function hasGitCheckpointOrDiff(messages: ConversationMessage[]): boolean {
  const gitTools = new Set(["git_status", "git_diff", "changes_summary", "checkpoint_create", "revert_changes", "git_commit_message"]);
  return messages.some((message) => message.blocks.some((block) => block.type === "tool_result" && gitTools.has(block.toolName)));
}

function hasValidation(turn: TurnSummary): boolean {
  return Boolean(turn.validation?.commands.length) ||
    (turn.trace ?? []).some(isValidationTrace);
}

function isValidationTrace(event: RuntimeTraceEvent): boolean {
  if (event.type !== "ran" || event.label !== "shell") {
    return false;
  }
  const input = event.input;
  const command = input && typeof input === "object" ? String((input as Record<string, unknown>)["command"] ?? "") : "";
  return /\b(npm\s+(run\s+)?(test|typecheck)|npm\s+test|pytest|py_compile|tsc|python\b.*py_compile)\b/i.test(command);
}
