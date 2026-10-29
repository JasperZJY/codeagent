import type { AssistantGenerationResult } from "./llm.js";
import { parseModelActionPlan, type ModelActionPlan } from "./planner.js";
import { normalizeToolCallAlias } from "./toolAliases.js";
import type { ConversationMessage, ThinkingTrace, TokenUsage } from "./types.js";

export interface InternalToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
  reason?: string;
}

export interface NormalizedAssistantResponse {
  text: string;
  toolUses: InternalToolUse[];
  usage?: TokenUsage;
  thinking?: ThinkingTrace[];
}

export interface NormalizeAssistantOptions {
  idPrefix?: string;
}

export function normalizeAssistantResult(
  result: AssistantGenerationResult,
  options: NormalizeAssistantOptions = {}
): NormalizedAssistantResponse {
  const normalized = normalizeAssistantText(result.text, options);
  return {
    ...normalized,
    ...(result.usage ? { usage: result.usage } : {}),
    ...(result.thinking?.length ? { thinking: result.thinking } : {})
  };
}

export function normalizeAssistantText(
  text: string,
  options: NormalizeAssistantOptions = {}
): NormalizedAssistantResponse {
  const plan = extractActionPlan(text);
  const toolUses = plan ? toolUsesFromPlan(plan, options.idPrefix ?? "tool") : [];
  return {
    text: toolUses.length ? "" : stripEmptyToolCode(text),
    toolUses
  };
}

export function toolUseMessage(toolUse: InternalToolUse): ConversationMessage {
  return {
    role: "assistant",
    blocks: [
      {
        type: "tool_use",
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input
      }
    ]
  };
}

function extractActionPlan(text: string): ModelActionPlan | undefined {
  const toolCodePlan = extractToolCodePlan(text);
  if (toolCodePlan?.actions.length) {
    return toolCodePlan;
  }
  const labeledToolPlan = extractLabeledToolUsePlan(text);
  if (labeledToolPlan?.actions.length) {
    return labeledToolPlan;
  }
  return parseModelActionPlan(text);
}

function extractToolCodePlan(text: string): ModelActionPlan | undefined {
  const actions: ModelActionPlan["actions"] = [];
  const pattern = /<tool_code>([\s\S]*?)<\/tool_code>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const body = match[1]?.trim();
    if (!body) {
      continue;
    }
    const plan = parseModelActionPlan(body);
    if (plan?.actions.length) {
      actions.push(...plan.actions);
    }
  }
  return actions.length ? { actions } : undefined;
}

function extractLabeledToolUsePlan(text: string): ModelActionPlan | undefined {
  const match = text.match(/Tool use\s+([A-Za-z_][\w-]*)\s*:\s*({[\s\S]*}?)(?:\s*$|\n\s*Tool use\s+)/i);
  if (!match) {
    return undefined;
  }
  const tool = match[1];
  const json = match[2];
  if (!tool || !json) {
    return undefined;
  }
  const parsed = parseLabeledToolInput(tool, json);
  if (!parsed) {
    return undefined;
  }
  return {
    actions: [
      {
        tool,
        input: normalizeToolInput(parsed)
      }
    ]
  };
}

function parseLabeledToolInput(tool: string, json: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return parseLenientLabeledToolInput(tool, json);
  }
}

function parseLenientLabeledToolInput(tool: string, text: string): Record<string, unknown> | undefined {
  if (tool !== "write_file") {
    return undefined;
  }
  const pathValue = readJsonStringField(text, "path") ?? readJsonStringField(text, "file_path");
  const content = readJsonStringField(text, "content");
  if (!pathValue || content === undefined) {
    return undefined;
  }
  return { path: pathValue, content };
}

function readJsonStringField(text: string, key: string): string | undefined {
  const match = new RegExp(`"${key}"\\s*:\\s*"`, "i").exec(text);
  if (!match) {
    return undefined;
  }
  let index = (match.index ?? 0) + match[0].length;
  let value = "";
  let escaped = false;
  while (index < text.length) {
    const char = text[index] ?? "";
    index += 1;
    if (escaped) {
      value += decodeJsonEscape(char);
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      return value;
    }
    value += char;
  }
  return value;
}

function decodeJsonEscape(char: string): string {
  if (char === "n") {
    return "\n";
  }
  if (char === "r") {
    return "\r";
  }
  if (char === "t") {
    return "\t";
  }
  return char;
}

function normalizeToolInput(input: Record<string, unknown>): Record<string, unknown> {
  if (typeof input["file_path"] === "string" && typeof input["path"] !== "string") {
    const { file_path, ...rest } = input;
    return { ...rest, path: file_path };
  }
  return input;
}

function stripEmptyToolCode(text: string): string {
  return text.replace(/<tool_code>\s*<\/tool_code>/gi, "").trim();
}

function toolUsesFromPlan(plan: ModelActionPlan, idPrefix: string): InternalToolUse[] {
  return plan.actions.map((action, index) => {
    const normalized = normalizeToolCallAlias(action.tool, normalizeToolInput(action.input));
    return {
      id: `${idPrefix}-${index + 1}`,
      name: normalized.name,
      input: normalized.input,
      ...(action.reason ? { reason: action.reason } : {})
    };
  });
}
