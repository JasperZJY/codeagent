import type { OutputFormat, RoutedMatch, RuntimeConfig, TurnSummary } from "../core/types.js";
import { stringifyJson } from "../utils/json.js";
import { renderAssistantAnswer, renderAnswerOptions, renderTokenUsageLine, renderTrace } from "./trace.js";

export function render(value: unknown, format: OutputFormat): string {
  if (format === "json") {
    return stringifyJson(value);
  }
  if (format === "markdown") {
    return renderMarkdown(value);
  }
  return renderText(value);
}

export function renderMatches(matches: RoutedMatch[], format: OutputFormat): string {
  if (format === "json") {
    return render({ matches }, format);
  }
  const lines = matches.map(
    (match) => `${match.kind}\t${match.name}\t${match.score}\t${match.description}`
  );
  return lines.length ? lines.join("\n") : "No matches.";
}

export function renderTurnSummary(
  turn: TurnSummary,
  format: OutputFormat,
  options: { config?: RuntimeConfig; verbose?: boolean; markdown?: boolean; useColor?: boolean; width?: number } = {}
): string {
  if (format === "json") {
    return render(turn, format);
  }
  const assistantText = turn.assistantMessages
    .flatMap((message) => message.blocks)
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  if (format === "markdown") {
    return [
      "# Turn Summary",
      "",
      `- Session: ${turn.sessionId}`,
      `- Stop reason: ${turn.stopReason}`,
      `- Iterations: ${turn.iterations}`,
      `- Usage: input=${turn.usage.inputTokens} output=${turn.usage.outputTokens}`,
      "",
      "## Routed Matches",
      ...(turn.routedMatches.length
        ? turn.routedMatches.map((match) => `- ${match.kind}:${match.name} (${match.score})`)
        : ["- none"]),
      "",
      "## Assistant",
      assistantText || "No assistant output."
    ].join("\n");
  }
  const trace = renderTrace(turn.trace, undefined, { verbose: Boolean(options.verbose) });
  const renderConfig: RuntimeConfig = options.config ?? {
    workspaceRoot: "",
    provider: "openai-compatible" as const,
    model: "",
    baseUrl: "",
    apiKey: "",
    permissionMode: "read-only" as const,
    outputFormat: format,
    maxTurns: 1,
    maxBudgetTokens: 8000,
    useLlm: false,
    dialogBlocks: true,
    showTokenUsage: true,
    summaryMode: "auto" as const,
    terminalMode: "tui" as const,
    ...(options.verbose !== undefined ? { verbose: options.verbose } : {}),
    ...(options.markdown !== undefined ? { markdown: options.markdown } : {})
  };
  const answerOptions = {
    ...renderAnswerOptions(renderConfig, turn),
    ...(options.markdown !== undefined ? { markdown: options.markdown } : {}),
    ...(options.useColor !== undefined ? { useColor: options.useColor } : {}),
    ...(options.width !== undefined ? { width: options.width } : {})
  };
  return [
    trace,
    renderAssistantAnswer(turn, answerOptions) || assistantText || "No assistant output.",
    renderTokenUsageLine(turn, renderConfig, options.useColor ?? false)
  ].filter(Boolean).join("\n\n");
}

export function renderHelp(): string {
  return [
    "Usage: code-agent [global flags] [command] [args]",
    "",
    "Run without a command to start the interactive shell.",
    "",
    "Global flags:",
    "  --cwd, -C <path>",
    "  --profile <name>",
    "  --provider openai-compatible|anthropic",
    "  --model <model>",
    "  --output-format text|json|markdown",
    "  --permission-mode read-only|workspace-write|danger-full-access",
    "  --context-compression off|local|headroom",
    "  --headroom-base-url <url>",
    "  --max-turns <number>",
    "  --session <id>",
    "  --use-llm | --no-llm",
    "  --verbose | --no-verbose",
    "  --markdown | --no-markdown",
    "  --no-dialog-blocks",
    "  --no-token-usage",
    "  --summary auto|off|always",
    "  --terminal-mode tui|scrollback",
    "",
    "Commands:",
    "  interactive | repl",
    "  summary",
    "  manifest",
    "  commands [--query <text>] [--limit <n>]",
    "  tools [--query <text>] [--limit <n>]",
    "  route <prompt>",
    "  bootstrap <prompt>",
    "  turn-loop <prompt>",
    "  prompt <prompt>",
    "  exec-tool <name> <json-payload>",
    "  session list",
    "  session load <id>",
    "  mcp-server",
    "  doctor"
  ].join("\n");
}

export function publicConfig(config: RuntimeConfig): Omit<RuntimeConfig, "apiKey"> & { apiKey: "set" | "unset" } {
  return {
    ...config,
    apiKey: config.apiKey ? "set" : "unset"
  };
}

function renderText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderText(item)).join("\n");
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${typeof item === "object" ? stringifyJson(item) : String(item)}`)
      .join("\n");
  }
  return String(value);
}

function renderMarkdown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return ["```json", stringifyJson(value), "```"].join("\n");
}
