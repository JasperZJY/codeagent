import path from "node:path";
import { normalizeToolCallAlias } from "./toolAliases.js";
import type { RoutedMatch, RuntimeConfig } from "./types.js";
import { toolCatalog } from "../tools/registry.js";

export interface ModelToolAction {
  tool: string;
  input: Record<string, unknown>;
  reason?: string;
}

export interface ModelActionPlan {
  actions: ModelToolAction[];
  final?: string;
}

export type AgentRouteIntent =
  | "direct_answer"
  | "inspect_files"
  | "search_files"
  | "write_file"
  | "edit_file"
  | "internet_search"
  | "memory"
  | "rag"
  | "task"
  | "project"
  | "validation"
  | "code_intel"
  | "python"
  | "skills"
  | "init"
  | "context"
  | "resume_state"
  | "run_command"
  | "unclear";

export type AgentRouteStrategy =
  | "direct"
  | "prompt_chain"
  | "react"
  | "self_correction"
  | "coordinator";

export interface AgentRoutePlan {
  intent: AgentRouteIntent;
  strategy: AgentRouteStrategy;
  tools: string[];
  reason?: string;
}

export function buildCoordinatorSystemPrompt(
  config: RuntimeConfig,
  routedMatches: RoutedMatch[],
  runtimeContext = ""
): string {
  const routeHints = routedMatches.length
    ? routedMatches.map((match) => `${match.kind}:${match.name}(${match.score})`).join(", ")
    : "none";
  return [
    "You are the coordinator router for a local code agent.",
    "Return ONLY valid JSON. No Markdown fences and no prose outside JSON.",
    "Do not expose hidden chain-of-thought. Use a short reason only.",
    "",
    "Classify the user request before tool planning.",
    "Use this order, inspired by prompt-chain/coordinator/ReAct workflows:",
    "1. classify the request intent;",
    "2. choose a workflow strategy;",
    "3. choose candidate tools;",
    "4. let the action planner decide exact tool inputs later.",
    "",
    "Allowed intent labels:",
    "direct_answer, inspect_files, search_files, write_file, edit_file, internet_search, memory, rag, task, project, validation, code_intel, python, skills, init, context, resume_state, run_command, unclear",
    "",
    "Allowed strategy labels:",
    "direct, prompt_chain, react, self_correction, coordinator",
    "",
    "JSON schema:",
    "{\"intent\":\"inspect_files\",\"strategy\":\"react\",\"tools\":[\"list_dir\",\"read_file\"],\"reason\":\"short observable reason\"}",
    "",
    "Tool selection rules:",
    "- direct_answer: no tools.",
    "- inspect_files: list_dir/read_file/glob_search/grep_search.",
    "- search_files: grep_search/glob_search.",
    "- write_file: write_file, optionally read_file first when context is needed.",
    "- edit_file: read_file then edit_file.",
    "- internet_search: web_search, or fetch_url when the user gives a URL.",
    "- memory: memory_search or memory_write.",
    "- rag: rag_index or rag_search.",
    "- task: task_plan, task_add, task_update, task_reset, or task_resume.",
    "- project: project_profile.",
    "- validation: validation_plan or parse_errors.",
    "- code_intel: symbol_index, symbol_search, find_definition, find_references, analyze_imports, call_graph, or code_outline.",
    "- python: python_exec, python_run_file, python_write_and_run, python_analyze_result, python_last_result, python_clean_tmp, or python_risk.",
    "- skills: skill_list, skill_search, skill_read, skill_use, skill_create, skill_reload, or skill_init.",
    "- init: project_init.",
    "- context: context_monitor.",
    "- resume_state: resume_state.",
    "- run_command: shell only when command execution is clearly requested.",
    "",
    `Workspace: ${path.resolve(config.workspaceRoot)}`,
    `Permission mode: ${config.permissionMode}`,
    `Route hints: ${routeHints}`,
    runtimeContext ? `Runtime context:\n${runtimeContext}` : "Runtime context: none"
  ].join("\n");
}

export function buildPlanningSystemPrompt(
  config: RuntimeConfig,
  routedMatches: RoutedMatch[],
  routePlan: AgentRoutePlan,
  runtimeContext = ""
): string {
  const tools = toolCatalog
    .map((tool) => {
      return [
        `- ${tool.name}`,
        `  description: ${tool.description}`,
        `  requiredPermission: ${tool.requiredPermission}`,
        `  inputSchema: ${JSON.stringify(tool.inputSchema)}`
      ].join("\n");
    })
    .join("\n");

  const routeHints = routedMatches.length
    ? routedMatches.map((match) => `${match.kind}:${match.name}(${match.score})`).join(", ")
    : "none";

  return [
    "You are the planning layer for a local code agent.",
    "Return ONLY valid JSON. Do not include Markdown fences, XML tags, explanations, or prose outside JSON.",
    "Do not reveal chain-of-thought. If useful, provide only a short reason per action.",
    "Follow the coordinator route. Use a ReAct-style loop: choose Action(tool,input), wait for Observation, then continue or finish.",
    "Choose tools when the user asks to read, list, search, edit, create, or run commands in the workspace.",
    "Do not say you cannot access local files. The runtime can execute the listed tools in the configured workspace.",
    "For file generation or code-writing requests, use write_file with the complete final file content.",
    "When the user asks to save generated prose, reports, notes, or answers as Markdown, use write_file with a .md path and put the complete Markdown content in the file.",
    "If the user requests a Markdown file but does not provide a filename, choose a concise relative filename such as output.md or a title-based .md filename.",
    "After writing requested file content, keep final responses short and mention the file path instead of repeating the whole file.",
    "For existing-file changes, prefer read_file before edit_file unless the requested replacement is fully explicit.",
    "If the current tool observations are enough to answer, return an empty actions array.",
    "Never invent that a tool succeeded; only request tool actions and let the runtime execute them.",
    "",
    "JSON schema:",
    "{\"actions\":[{\"tool\":\"read_file\",\"input\":{\"path\":\"README.md\"},\"reason\":\"inspect file\"}],\"final\":\"optional short completion note\"}",
    "",
    "Rules:",
    "- actions must be an array.",
    "- tool must exactly match one available tool name.",
    "- input must be an object matching the selected tool.",
    "- Use at most 3 actions per response.",
    "- Use relative workspace paths unless the user provided an absolute path inside the workspace.",
    "",
    `Workspace: ${path.resolve(config.workspaceRoot)}`,
    `Permission mode: ${config.permissionMode}`,
    `Provider: ${config.provider}`,
    `Model: ${config.model}`,
    `Route hints: ${routeHints}`,
    `Coordinator intent: ${routePlan.intent}`,
    `Coordinator strategy: ${routePlan.strategy}`,
    `Coordinator tools: ${routePlan.tools.length ? routePlan.tools.join(", ") : "none"}`,
    routePlan.reason ? `Coordinator reason: ${routePlan.reason}` : "Coordinator reason: none",
    runtimeContext ? `Runtime context:\n${runtimeContext}` : "Runtime context: none",
    "",
    "Available tools:",
    tools
  ].join("\n");
}

export function parseAgentRoutePlan(text: string): AgentRoutePlan | undefined {
  const jsonText = extractJsonObject(stripReasoningTags(stripCodeFence(text)).trim());
  if (!jsonText) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return undefined;
  }
  return normalizeRoutePlan(parsed);
}

export function parseModelActionPlan(text: string): ModelActionPlan | undefined {
  const normalizedText = stripReasoningTags(stripCodeFence(text)).trim();
  const jsonText = extractJsonValue(normalizedText);
  if (jsonText) {
    try {
      return normalizePlan(JSON.parse(jsonText));
    } catch {
      return undefined;
    }
  }

  const toolCallPlan = extractToolCallPlan(normalizedText);
  return toolCallPlan?.actions.length ? toolCallPlan : undefined;
}

export function describePlan(plan: ModelActionPlan): string {
  if (plan.actions.length > 0) {
    return plan.actions.map((action) => `tool:${action.tool}`).join(", ");
  }
  return plan.final ? "final" : "no actions";
}

export function describeRoutePlan(routePlan: AgentRoutePlan): string {
  const tools = routePlan.tools.length ? routePlan.tools.join(",") : "none";
  return `${routePlan.intent}/${routePlan.strategy} tools:${tools}`;
}

export function fallbackRouteFromMatches(routedMatches: RoutedMatch[]): AgentRoutePlan {
  const toolNames = routedMatches.filter((match) => match.kind === "tool").map((match) => match.name);
  if (toolNames.includes("write_file")) {
    return { intent: "write_file", strategy: "react", tools: uniqueTools(toolNames) };
  }
  if (toolNames.includes("edit_file")) {
    return { intent: "edit_file", strategy: "self_correction", tools: uniqueTools(toolNames) };
  }
  if (toolNames.includes("shell")) {
    return { intent: "run_command", strategy: "react", tools: uniqueTools(toolNames) };
  }
  if (toolNames.includes("web_search") || toolNames.includes("fetch_url")) {
    return { intent: "internet_search", strategy: "react", tools: uniqueTools(toolNames) };
  }
  if (toolNames.includes("memory_search") || toolNames.includes("memory_write")) {
    return { intent: "memory", strategy: "react", tools: uniqueTools(toolNames) };
  }
  if (toolNames.includes("rag_index") || toolNames.includes("rag_search")) {
    return { intent: "rag", strategy: "react", tools: uniqueTools(toolNames) };
  }
  if (toolNames.some((name) => name.startsWith("task_"))) {
    return { intent: "task", strategy: "react", tools: uniqueTools(toolNames) };
  }
  if (toolNames.includes("project_profile")) {
    return { intent: "project", strategy: "react", tools: uniqueTools(toolNames) };
  }
  if (toolNames.includes("validation_plan") || toolNames.includes("parse_errors")) {
    return { intent: "validation", strategy: "self_correction", tools: uniqueTools(toolNames) };
  }
  if (toolNames.some((name) => name.startsWith("python_"))) {
    return { intent: "python", strategy: "self_correction", tools: uniqueTools(toolNames) };
  }
  if (toolNames.some((name) => name.startsWith("skill_"))) {
    return { intent: "skills", strategy: "react", tools: uniqueTools(toolNames) };
  }
  if (toolNames.some((name) => [
    "symbol_index",
    "symbol_search",
    "find_definition",
    "find_references",
    "analyze_imports",
    "call_graph",
    "code_outline"
  ].includes(name))) {
    return { intent: "code_intel", strategy: "react", tools: uniqueTools(toolNames) };
  }
  if (toolNames.includes("project_init")) {
    return { intent: "init", strategy: "react", tools: uniqueTools(toolNames) };
  }
  if (toolNames.includes("context_monitor")) {
    return { intent: "context", strategy: "react", tools: uniqueTools(toolNames) };
  }
  if (toolNames.includes("resume_state")) {
    return { intent: "resume_state", strategy: "react", tools: uniqueTools(toolNames) };
  }
  if (toolNames.includes("grep_search") || toolNames.includes("glob_search")) {
    return { intent: "search_files", strategy: "react", tools: uniqueTools(toolNames) };
  }
  if (toolNames.includes("read_file") || toolNames.includes("list_dir")) {
    return { intent: "inspect_files", strategy: "react", tools: uniqueTools(toolNames) };
  }
  return { intent: "direct_answer", strategy: "direct", tools: [] };
}

function normalizePlan(value: unknown): ModelActionPlan | undefined {
  if (Array.isArray(value)) {
    const actions = normalizeActionArray(value);
    return actions.length ? { actions } : undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const actions = normalizeActions(value);
  const final = firstString(value["final"], value["answer"], value["response"]);
  const plan: ModelActionPlan = { actions };
  if (final) {
    plan.final = final;
  }
  if (plan.actions.length === 0 && !plan.final && !("actions" in value)) {
    return undefined;
  }
  return plan;
}

function normalizeRoutePlan(value: unknown): AgentRoutePlan | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const rawIntent = firstString(value["intent"], value["classification"], value["route"]);
  const rawStrategy = firstString(value["strategy"], value["workflow"], value["mode"]);
  const intent = normalizeIntent(rawIntent);
  const strategy = normalizeStrategy(rawStrategy);
  if (!intent || !strategy) {
    return undefined;
  }

  const knownTools = new Set(toolCatalog.map((tool) => tool.name));
  const rawTools = Array.isArray(value["tools"]) ? value["tools"] : [];
  const tools = rawTools
    .filter((tool): tool is string => typeof tool === "string")
    .map((tool) => normalizeToolCallAlias(tool, {}).name)
    .filter((tool) => knownTools.has(tool))
    .slice(0, 6);
  const reason = firstString(value["reason"], value["rationale"]);
  const routePlan: AgentRoutePlan = { intent, strategy, tools: uniqueTools(tools) };
  if (reason) {
    routePlan.reason = reason;
  }
  return routePlan;
}

function normalizeActions(value: Record<string, unknown>): ModelToolAction[] {
  const rawActions = Array.isArray(value["actions"])
    ? value["actions"]
    : isSingleAction(value)
      ? [value]
      : [];

  return normalizeActionArray(rawActions);
}

function normalizeActionArray(rawActions: unknown[]): ModelToolAction[] {
  const knownTools = new Set(toolCatalog.map((tool) => tool.name));
  const actions: ModelToolAction[] = [];
  for (const raw of rawActions.slice(0, 3)) {
    if (!isRecord(raw)) {
      continue;
    }
    const input = isRecord(raw["input"])
      ? raw["input"]
      : isRecord(raw["arguments"])
        ? raw["arguments"]
        : {};
    const tool = firstString(raw["tool"], raw["name"], raw["toolName"]);
    if (!tool) {
      continue;
    }
    const normalized = normalizeToolCallAlias(tool, input);
    if (!knownTools.has(normalized.name)) {
      continue;
    }
    const reason = firstString(raw["reason"], raw["purpose"]);
    const action: ModelToolAction = { tool: normalized.name, input: normalized.input };
    if (reason) {
      action.reason = reason;
    }
    actions.push(action);
  }
  return actions;
}

function extractToolCallPlan(value: string): ModelActionPlan | undefined {
  const knownTools = new Set(toolCatalog.map((tool) => tool.name));
  const actions: ModelToolAction[] = [];
  const pattern = /([A-Za-z_][\w-]*)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null && actions.length < 3) {
    const tool = match[1];
    if (!tool || !knownTools.has(tool)) {
      continue;
    }
    const input = parseCallArguments(match[2] ?? "");
    actions.push({ tool, input });
  }
  return actions.length ? { actions } : undefined;
}

function parseCallArguments(value: string): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const pattern = /([A-Za-z_][\w-]*)\s*=\s*("[^"]*"|'[^']*'|[^,\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const key = match[1];
    const raw = match[2]?.trim() ?? "";
    if (!key) {
      continue;
    }
    input[key] = raw.replace(/^["']|["']$/g, "");
  }
  return input;
}

function isSingleAction(value: Record<string, unknown>): boolean {
  return typeof value["tool"] === "string" || typeof value["toolName"] === "string";
}

function normalizeIntent(value: string | undefined): AgentRouteIntent | undefined {
  const allowed: AgentRouteIntent[] = [
    "direct_answer",
    "inspect_files",
    "search_files",
    "write_file",
    "edit_file",
    "internet_search",
    "memory",
    "rag",
    "task",
    "project",
    "validation",
    "code_intel",
    "python",
    "skills",
    "init",
    "context",
    "resume_state",
    "run_command",
    "unclear"
  ];
  return allowed.find((item) => item === value);
}

function normalizeStrategy(value: string | undefined): AgentRouteStrategy | undefined {
  const allowed: AgentRouteStrategy[] = [
    "direct",
    "prompt_chain",
    "react",
    "self_correction",
    "coordinator"
  ];
  return allowed.find((item) => item === value);
}

function uniqueTools(values: string[]): string[] {
  return [...new Set(values)];
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stripCodeFence(value: string): string {
  return value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
}

function stripReasoningTags(value: string): string {
  return value.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractJsonObject(value: string): string | undefined {
  const start = value.indexOf("{");
  return start >= 0 ? extractBalancedJson(value, start, "{", "}") : undefined;
}

function extractJsonValue(value: string): string | undefined {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");
  if (objectStart < 0 && arrayStart < 0) {
    return undefined;
  }
  if (arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart)) {
    return extractBalancedJson(value, arrayStart, "[", "]");
  }
  return extractBalancedJson(value, objectStart, "{", "}");
}

function extractBalancedJson(value: string, start: number, open: "{" | "[", close: "}" | "]"): string | undefined {
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
    if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }
  return undefined;
}
