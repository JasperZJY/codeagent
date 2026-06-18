import { generateAssistantText } from "./llm.js";
import { summarizeGoals } from "./goals.js";
import type { AgentGoal, ConversationMessage, RuntimeConfig, ToolResultBlock } from "./types.js";

export type ReflectionVerdict = "pass" | "revise" | "blocked";

export interface ReflectionReport {
  verdict: ReflectionVerdict;
  issues: string[];
  nextActions: string[];
  lessons: string[];
}

export async function runReflection(
  config: RuntimeConfig,
  prompt: string,
  messages: ConversationMessage[],
  toolResults: ConversationMessage[],
  goals: AgentGoal[],
  runtimeContext: string
): Promise<ReflectionReport> {
  const fallback = deterministicReflection(toolResults, goals);
  if (!config.useLlm) {
    return fallback;
  }
  const text = await generateAssistantText(
    config,
    buildReflectionSystemPrompt(prompt, goals, runtimeContext),
    messages,
    JSON.stringify(fallback)
  );
  return parseReflectionReport(text) ?? fallback;
}

export function parseReflectionReport(text: string): ReflectionReport | undefined {
  const json = extractJsonObject(stripCodeFence(stripReasoningTags(text)).trim());
  if (!json) {
    return undefined;
  }
  try {
    return normalizeReport(JSON.parse(json));
  } catch {
    return undefined;
  }
}

export function formatReflection(report: ReflectionReport): string {
  return [
    `Reflection verdict: ${report.verdict}`,
    report.issues.length ? `Issues: ${report.issues.join("; ")}` : "Issues: none",
    report.nextActions.length ? `Next actions: ${report.nextActions.join("; ")}` : "Next actions: none",
    report.lessons.length ? `Lessons: ${report.lessons.join("; ")}` : "Lessons: none"
  ].join("\n");
}

function deterministicReflection(toolResults: ConversationMessage[], goals: AgentGoal[]): ReflectionReport {
  const failures = toolResults
    .flatMap((message) => message.blocks)
    .filter((block): block is ToolResultBlock => block.type === "tool_result" && block.isError)
    .map((block) => `${block.toolName}: ${String(block.output)}`);
  if (failures.length > 0) {
    return {
      verdict: "blocked",
      issues: failures.slice(0, 5),
      nextActions: ["Inspect the failed tool output and choose a fallback tool or ask for configuration."],
      lessons: failures.map((failure) => `Recover from ${failure}`).slice(0, 3)
    };
  }
  const blockedGoals = goals.filter((goal) => goal.status === "blocked");
  if (blockedGoals.length > 0) {
    return {
      verdict: "blocked",
      issues: blockedGoals.map((goal) => goal.evidence ?? goal.title),
      nextActions: ["Resolve blocked goals before finalizing."],
      lessons: []
    };
  }
  return {
    verdict: "pass",
    issues: [],
    nextActions: [],
    lessons: []
  };
}

function buildReflectionSystemPrompt(prompt: string, goals: AgentGoal[], runtimeContext: string): string {
  return [
    "You are the reflection reviewer for a local code agent.",
    "Return ONLY valid JSON. Do not include Markdown fences or prose.",
    "Do not expose hidden chain-of-thought. Use concise observable issues only.",
    "",
    "Review whether the latest turn satisfied the user request and goals.",
    "If more work is needed, set verdict to revise or blocked and list concrete nextActions.",
    "Capture durable lessons that would help future similar tasks.",
    "",
    "JSON schema:",
    "{\"verdict\":\"pass\",\"issues\":[],\"nextActions\":[],\"lessons\":[]}",
    "",
    `User request: ${prompt}`,
    "Goals:",
    summarizeGoals(goals),
    runtimeContext ? `Runtime context:\n${runtimeContext}` : "Runtime context: none"
  ].join("\n");
}

function normalizeReport(value: unknown): ReflectionReport | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const object = value as Record<string, unknown>;
  const verdict = normalizeVerdict(object["verdict"]);
  if (!verdict) {
    return undefined;
  }
  return {
    verdict,
    issues: stringArray(object["issues"]),
    nextActions: stringArray(object["nextActions"] ?? object["next_actions"]),
    lessons: stringArray(object["lessons"])
  };
}

function normalizeVerdict(value: unknown): ReflectionVerdict | undefined {
  return value === "pass" || value === "revise" || value === "blocked" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function stripCodeFence(value: string): string {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

function stripReasoningTags(value: string): string {
  return value.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractJsonObject(value: string): string | undefined {
  const start = value.indexOf("{");
  if (start < 0) {
    return undefined;
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }
  return undefined;
}
