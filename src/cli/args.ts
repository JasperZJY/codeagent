import {
  normalizeContextCompression,
  normalizeOutputFormat,
  normalizePermissionMode,
  normalizeSummaryMode,
  normalizeTerminalMode,
  normalizeThinkingDisplayMode,
  type ConfigOverrides
} from "../core/config.js";
import type { CliAction } from "../core/types.js";

export interface ParsedCli {
  action: CliAction;
  overrides: ConfigOverrides;
}

export function parseArgs(argv: string[]): ParsedCli {
  const overrides: ConfigOverrides = {};
  const rest: string[] = [];
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === "--") {
      rest.push(...argv.slice(index + 1));
      break;
    }
    if (token === "--cwd" || token === "-C" || token === "--directory") {
      overrides.workspaceRoot = requireValue(argv, index, token);
      index += 2;
      continue;
    }
    if (token?.startsWith("--cwd=")) {
      overrides.workspaceRoot = token.slice("--cwd=".length);
      index += 1;
      continue;
    }
    if (token === "--profile") {
      overrides.profile = requireValue(argv, index, token);
      index += 2;
      continue;
    }
    if (token?.startsWith("--profile=")) {
      overrides.profile = token.slice("--profile=".length);
      index += 1;
      continue;
    }
    if (token === "--model") {
      overrides.model = requireValue(argv, index, token);
      index += 2;
      continue;
    }
    if (token === "--provider") {
      const value = requireValue(argv, index, token);
      if (value === "anthropic" || value === "claude") {
        overrides.provider = "anthropic";
      } else {
        overrides.provider = "openai-compatible";
      }
      index += 2;
      continue;
    }
    if (token?.startsWith("--provider=")) {
      const value = token.slice("--provider=".length);
      overrides.provider = value === "anthropic" || value === "claude" ? "anthropic" : "openai-compatible";
      index += 1;
      continue;
    }
    if (token?.startsWith("--model=")) {
      overrides.model = token.slice("--model=".length);
      index += 1;
      continue;
    }
    if (token === "--output-format") {
      overrides.outputFormat = normalizeOutputFormat(requireValue(argv, index, token));
      index += 2;
      continue;
    }
    if (token?.startsWith("--output-format=")) {
      overrides.outputFormat = normalizeOutputFormat(token.slice("--output-format=".length));
      index += 1;
      continue;
    }
    if (token === "--permission-mode") {
      overrides.permissionMode = normalizePermissionMode(requireValue(argv, index, token));
      index += 2;
      continue;
    }
    if (token?.startsWith("--permission-mode=")) {
      overrides.permissionMode = normalizePermissionMode(token.slice("--permission-mode=".length));
      index += 1;
      continue;
    }
    if (token === "--context-compression") {
      overrides.contextCompression = normalizeContextCompression(requireValue(argv, index, token));
      index += 2;
      continue;
    }
    if (token?.startsWith("--context-compression=")) {
      overrides.contextCompression = normalizeContextCompression(token.slice("--context-compression=".length));
      index += 1;
      continue;
    }
    if (token === "--headroom-base-url") {
      overrides.headroomBaseUrl = requireValue(argv, index, token);
      index += 2;
      continue;
    }
    if (token?.startsWith("--headroom-base-url=")) {
      overrides.headroomBaseUrl = token.slice("--headroom-base-url=".length);
      index += 1;
      continue;
    }
    if (token === "--max-turns") {
      overrides.maxTurns = parsePositiveInt(requireValue(argv, index, token), token);
      index += 2;
      continue;
    }
    if (token?.startsWith("--max-turns=")) {
      overrides.maxTurns = parsePositiveInt(token.slice("--max-turns=".length), "--max-turns");
      index += 1;
      continue;
    }
    if (token === "--session") {
      overrides.sessionId = requireValue(argv, index, token);
      index += 2;
      continue;
    }
    if (token === "--use-llm") {
      overrides.useLlm = true;
      index += 1;
      continue;
    }
    if (token === "--no-llm") {
      overrides.useLlm = false;
      index += 1;
      continue;
    }
    if (token === "--verbose") {
      overrides.verbose = true;
      index += 1;
      continue;
    }
    if (token === "--no-verbose") {
      overrides.verbose = false;
      index += 1;
      continue;
    }
    if (token === "--markdown") {
      overrides.markdown = true;
      index += 1;
      continue;
    }
    if (token === "--no-markdown") {
      overrides.markdown = false;
      index += 1;
      continue;
    }
    if (token === "--no-dialog-blocks") {
      overrides.dialogBlocks = false;
      index += 1;
      continue;
    }
    if (token === "--no-token-usage") {
      overrides.showTokenUsage = false;
      index += 1;
      continue;
    }
    if (token === "--summary") {
      overrides.summaryMode = normalizeSummaryMode(requireValue(argv, index, token));
      index += 2;
      continue;
    }
    if (token?.startsWith("--summary=")) {
      overrides.summaryMode = normalizeSummaryMode(token.slice("--summary=".length));
      index += 1;
      continue;
    }
    if (token === "--terminal-mode") {
      overrides.terminalMode = normalizeTerminalMode(requireValue(argv, index, token));
      index += 2;
      continue;
    }
    if (token?.startsWith("--terminal-mode=")) {
      overrides.terminalMode = normalizeTerminalMode(token.slice("--terminal-mode=".length));
      index += 1;
      continue;
    }
    if (token === "--thinking") {
      overrides.thinkingDisplay = normalizeThinkingDisplayMode(requireValue(argv, index, token));
      index += 2;
      continue;
    }
    if (token?.startsWith("--thinking=")) {
      overrides.thinkingDisplay = normalizeThinkingDisplayMode(token.slice("--thinking=".length));
      index += 1;
      continue;
    }
    rest.push(token ?? "");
    index += 1;
  }

  return { action: parseAction(rest), overrides };
}

function parseAction(args: string[]): CliAction {
  if (args.length === 0) {
    return { type: "interactive" };
  }
  const command = args[0] ?? "help";
  const tail = args.slice(1);
  switch (command) {
    case "interactive":
    case "repl":
      return { type: "interactive" };
    case "help":
    case "--help":
    case "-h":
      return { type: "help" };
    case "summary":
      return { type: "summary" };
    case "manifest":
      return { type: "manifest" };
    case "commands":
      return { type: "commands", ...parseListArgs(tail) };
    case "tools":
      return { type: "tools", ...parseListArgs(tail) };
    case "route":
      return { type: "route", prompt: requiredPrompt(tail), limit: parseLimit(tail) };
    case "bootstrap":
      return { type: "bootstrap", prompt: requiredPrompt(tail), limit: parseLimit(tail) };
    case "turn-loop":
    case "turn":
      return { type: "turn-loop", prompt: requiredPrompt(tail), limit: parseLimit(tail) };
    case "prompt":
    case "ask":
      return { type: "prompt", prompt: requiredPrompt(tail), limit: parseLimit(tail) };
    case "exec-tool":
      if (!tail[0] || !tail[1]) {
        throw new Error("missing_argument: exec-tool requires <name> <json-payload>");
      }
      return { type: "exec-tool", name: tail[0], payload: tail.slice(1).join(" ") };
    case "session":
      if (tail[0] === "list" || !tail[0]) {
        return { type: "session-list" };
      }
      if (tail[0] === "load" && tail[1]) {
        return { type: "session-load", sessionId: tail[1] };
      }
      throw new Error("unsupported_session_action: expected session list|load <id>");
    case "mcp-server":
    case "mcp":
      return { type: "mcp-server" };
    case "doctor":
      return { type: "doctor" };
    default:
      if (command.startsWith("-")) {
        throw new Error(`unknown_option: ${command}`);
      }
      return { type: "prompt", prompt: args.join(" "), limit: parseLimit(args) };
  }
}

function parseListArgs(args: string[]): { query?: string; limit: number } {
  const limit = parseLimit(args);
  const queryIndex = args.findIndex((arg) => arg === "--query");
  const query = queryIndex >= 0 ? args[queryIndex + 1] : undefined;
  return query ? { query, limit } : { limit };
}

function parseLimit(args: string[]): number {
  const index = args.findIndex((arg) => arg === "--limit");
  if (index < 0) {
    return 10;
  }
  return parsePositiveInt(args[index + 1], "--limit");
}

function requiredPrompt(args: string[]): string {
  const filtered: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--limit") {
      i += 1;
      continue;
    }
    filtered.push(args[i] ?? "");
  }
  const prompt = filtered.join(" ").trim();
  if (!prompt) {
    throw new Error("missing_prompt: prompt text is required");
  }
  return prompt;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing_flag_value: ${flag} requires a value`);
  }
  return value;
}

function parsePositiveInt(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid_flag_value: ${name} expects a positive integer`);
  }
  return parsed;
}
