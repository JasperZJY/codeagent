import type { AgentTaskPlan, ConversationMessage, RuntimeTraceEvent, TestFixLoopResult } from "./types.js";

export interface ReflectionDecision {
  shouldReflect: boolean;
  reason: string;
  level: "none" | "light" | "full";
}

export interface ReflectionPolicyInput {
  prompt: string;
  toolResults: ConversationMessage[];
  trace: RuntimeTraceEvent[];
  taskPlan?: AgentTaskPlan;
  validation?: TestFixLoopResult;
}

const EXPLICIT_REFLECTION_RE = /(reflect|reflection|review your work|double[- ]check|think again|反思|复盘|检查你的方案|检查结果|审查)/i;

export function decideReflection(input: ReflectionPolicyInput): ReflectionDecision {
  if (EXPLICIT_REFLECTION_RE.test(input.prompt)) {
    return full("user explicitly requested reflection or review");
  }

  if (input.validation?.status === "failed" || input.validation?.status === "blocked") {
    return full(`validation ${input.validation.status}`);
  }

  const failures = countToolFailures(input.toolResults);
  if (failures >= 2) {
    return full(`${failures} tool failures`);
  }

  if (input.taskPlan?.status === "blocked" || input.taskPlan?.status === "failed") {
    return full(`task plan ${input.taskPlan.status}`);
  }

  const mutatedFiles = collectMutatedFiles(input.toolResults);
  if (mutatedFiles.length > 2) {
    return full(`${mutatedFiles.length} files changed`);
  }

  if (input.trace.some((event) => event.type === "ran" && event.label === "shell" && event.ok === false)) {
    return full("shell command failed");
  }

  if (mutatedFiles.length > 0) {
    return light(`${mutatedFiles.length} file${mutatedFiles.length === 1 ? "" : "s"} changed`);
  }

  if (input.validation?.commands.length || input.trace.some((event) => event.type === "ran" && event.label === "shell")) {
    return light("validation or command execution ran");
  }

  if (failures === 1) {
    return light("one tool failed but task continued");
  }

  return {
    shouldReflect: false,
    level: "none",
    reason: "simple turn without mutations, validation failures, or explicit review request"
  };
}

function full(reason: string): ReflectionDecision {
  return { shouldReflect: true, level: "full", reason };
}

function light(reason: string): ReflectionDecision {
  return { shouldReflect: true, level: "light", reason };
}

function countToolFailures(messages: ConversationMessage[]): number {
  let failures = 0;
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === "tool_result" && block.isError) {
        failures += 1;
      }
    }
  }
  return failures;
}

function collectMutatedFiles(messages: ConversationMessage[]): string[] {
  const files = new Set<string>();
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type !== "tool_result" || block.isError) {
        continue;
      }
      if (!["write_file", "edit_file", "python_write_and_run"].includes(block.toolName)) {
        continue;
      }
      const output = block.output;
      if (!output || typeof output !== "object") {
        continue;
      }
      const pathValue = (output as Record<string, unknown>)["path"] ?? (output as Record<string, unknown>)["scriptPath"];
      if (typeof pathValue === "string") {
        files.add(pathValue);
      }
    }
  }
  return [...files];
}
