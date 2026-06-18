import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  ContextCompressionMode,
  OutputFormat,
  PermissionMode,
  ProviderKind,
  SummaryMode,
  TerminalMode,
  ThinkingDisplayMode,
  RuntimeConfig
} from "./types.js";

export interface ConfigOverrides {
  workspaceRoot?: string;
  profile?: string;
  provider?: ProviderKind;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  permissionMode?: PermissionMode;
  outputFormat?: OutputFormat;
  maxTurns?: number;
  maxBudgetTokens?: number;
  llmTimeoutMs?: number;
  sessionId?: string;
  useLlm?: boolean;
  verbose?: boolean;
  markdown?: boolean;
  dialogBlocks?: boolean;
  showTokenUsage?: boolean;
  summaryMode?: SummaryMode;
  terminalMode?: TerminalMode;
  thinkingDisplay?: ThinkingDisplayMode;
  contextCompression?: ContextCompressionMode;
  headroomBaseUrl?: string;
}

export interface RuntimeProfileConfig {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  useLlm?: boolean;
}

export interface RuntimeProfileInfo {
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKeySource: string;
}

export interface RuntimeProfileSummary {
  profiles: RuntimeProfileInfo[];
  defaultProfile?: string;
}

type ConfigFile = Partial<{
  model: string;
  provider: ProviderKind;
  baseUrl: string;
  apiKey: string;
  defaultProfile: string;
  profiles: Record<string, RuntimeProfileConfig>;
  permissionMode: PermissionMode;
  outputFormat: OutputFormat;
  maxTurns: number;
  maxBudgetTokens: number;
  llmTimeoutMs: number;
  useLlm: boolean;
  verbose: boolean;
  markdown: boolean;
  ui: Partial<{
    dialogBlocks: boolean;
    showTokenUsage: boolean;
    summaryMode: SummaryMode;
    terminalMode: TerminalMode;
    thinkingDisplay: ThinkingDisplayMode;
  }>;
  contextCompression: ContextCompressionMode;
  headroomBaseUrl: string;
}>;

export function loadRuntimeConfig(overrides: ConfigOverrides = {}): RuntimeConfig {
  loadDotEnv(process.cwd());

  const workspaceRoot = path.resolve(overrides.workspaceRoot ?? process.cwd());
  const fileConfig = loadConfigFiles(workspaceRoot);
  const explicitEndpointOverride =
    overrides.provider !== undefined ||
    overrides.baseUrl !== undefined ||
    overrides.apiKey !== undefined;
  const selectedProfileName = normalizeProfileName(
    overrides.profile ??
      (!explicitEndpointOverride ? process.env["CODE_AGENT_PROFILE"] ?? fileConfig.defaultProfile : undefined)
  );
  const selectedProfile = selectedProfileName ? resolveProfile(fileConfig, selectedProfileName) : undefined;
  const availableProfiles = Object.keys(fileConfig.profiles ?? {}).sort();
  const profileApiKey = selectedProfile ? resolveProfileApiKey(selectedProfile) : undefined;

  const permissionMode = normalizePermissionMode(
    overrides.permissionMode ??
      fileConfig.permissionMode ??
      readPermissionModeEnv() ??
      "workspace-write"
  );
  const outputFormat = normalizeOutputFormat(
    overrides.outputFormat ??
      fileConfig.outputFormat ??
      readOutputFormatEnv() ??
      "text"
  );

  const provider = normalizeProvider(
    overrides.provider ?? selectedProfile?.provider ?? fileConfig.provider ?? process.env["CODE_AGENT_PROVIDER"] ?? inferProvider()
  );
  const providerDefaults = defaultsForProvider(provider);
  const config: RuntimeConfig = {
    workspaceRoot,
    ...(selectedProfileName ? { profile: selectedProfileName } : {}),
    ...(availableProfiles.length ? { availableProfiles } : {}),
    provider,
    model:
      overrides.model ??
      selectedProfile?.model ??
      fileConfig.model ??
      process.env["CODE_AGENT_MODEL"] ??
      providerDefaults.model,
    baseUrl:
      overrides.baseUrl ??
      selectedProfile?.baseUrl ??
      fileConfig.baseUrl ??
      process.env["CODE_AGENT_BASE_URL"] ??
      providerDefaults.baseUrl,
    apiKey:
      overrides.apiKey ??
      profileApiKey ??
      fileConfig.apiKey ??
      process.env["CODE_AGENT_API_KEY"] ??
      providerDefaults.apiKey,
    permissionMode,
    outputFormat,
    maxTurns: positiveInt(overrides.maxTurns ?? fileConfig.maxTurns, 8),
    maxBudgetTokens: positiveInt(overrides.maxBudgetTokens ?? fileConfig.maxBudgetTokens, 8000),
    llmTimeoutMs: positiveInt(
      overrides.llmTimeoutMs ?? fileConfig.llmTimeoutMs ?? readOptionalIntEnv("CODE_AGENT_LLM_TIMEOUT_MS"),
      120000
    ),
    useLlm: overrides.useLlm ?? selectedProfile?.useLlm ?? fileConfig.useLlm ?? false,
    verbose: overrides.verbose ?? fileConfig.verbose ?? readBooleanEnv("CODE_AGENT_VERBOSE"),
    markdown: overrides.markdown ?? fileConfig.markdown ?? readOptionalBooleanEnv("CODE_AGENT_MARKDOWN") ?? true,
    dialogBlocks: overrides.dialogBlocks ?? fileConfig.ui?.dialogBlocks ?? readOptionalBooleanEnv("CODE_AGENT_DIALOG_BLOCKS") ?? true,
    showTokenUsage: overrides.showTokenUsage ?? fileConfig.ui?.showTokenUsage ?? readOptionalBooleanEnv("CODE_AGENT_SHOW_TOKEN_USAGE") ?? true,
    summaryMode: normalizeSummaryMode(
      overrides.summaryMode ?? fileConfig.ui?.summaryMode ?? process.env["CODE_AGENT_SUMMARY_MODE"] ?? "auto"
    ),
    terminalMode: normalizeTerminalMode(
      overrides.terminalMode ?? fileConfig.ui?.terminalMode ?? process.env["CODE_AGENT_TERMINAL_MODE"] ?? "tui"
    ),
    thinkingDisplay: normalizeThinkingDisplayMode(
      overrides.thinkingDisplay ?? fileConfig.ui?.thinkingDisplay ?? process.env["CODE_AGENT_THINKING_DISPLAY"] ?? "summary"
    ),
    contextCompression: normalizeContextCompression(
      overrides.contextCompression ??
        fileConfig.contextCompression ??
        process.env["CODE_AGENT_CONTEXT_COMPRESSION"] ??
        "local"
    ),
    headroomBaseUrl:
      overrides.headroomBaseUrl ??
      fileConfig.headroomBaseUrl ??
      process.env["CODE_AGENT_HEADROOM_BASE_URL"] ??
      "http://localhost:8787"
  };
  if (overrides.sessionId) {
    config.sessionId = overrides.sessionId;
  }
  return config;
}

export function listRuntimeProfiles(workspaceRoot = process.cwd()): RuntimeProfileSummary {
  const root = path.resolve(workspaceRoot);
  loadDotEnv(root);
  const fileConfig = loadConfigFiles(root);
  const profiles = Object.entries(fileConfig.profiles ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, profile]) => ({
      name,
      provider: profile.provider ?? "",
      model: profile.model ?? "",
      baseUrl: profile.baseUrl ?? "",
      apiKeySource: profile.apiKey !== undefined
        ? "inline"
        : profile.apiKeyEnv
          ? `${profile.apiKeyEnv}:${process.env[profile.apiKeyEnv] ? "set" : "unset"}`
          : "unset"
    }));
  return {
    profiles,
    ...(fileConfig.defaultProfile ? { defaultProfile: fileConfig.defaultProfile } : {})
  };
}

function loadConfigFiles(workspaceRoot: string): ConfigFile {
  const candidates = [
    path.join(workspaceRoot, ".code-agent.json"),
    path.join(workspaceRoot, ".code-agent", "settings.json")
  ];
  return candidates.reduce<ConfigFile>((merged, candidate) => {
    if (!existsSync(candidate)) {
      return merged;
    }
    const parsed = JSON.parse(readFileSync(candidate, "utf8")) as ConfigFile;
    return {
      ...merged,
      ...parsed,
      profiles: {
        ...(merged.profiles ?? {}),
        ...(parsed.profiles ?? {})
      }
    };
  }, {});
}

function loadDotEnv(cwd: string): void {
  const envPath = path.join(cwd, ".env");
  if (!existsSync(envPath)) {
    return;
  }
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function normalizePermissionMode(value: string): PermissionMode {
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") {
    return value;
  }
  throw new Error(
    `invalid_permission_mode: expected read-only|workspace-write|danger-full-access, got ${value}`
  );
}

export function normalizeOutputFormat(value: string): OutputFormat {
  const lowered = value.toLowerCase();
  if (lowered === "text" || lowered === "json" || lowered === "markdown") {
    return lowered;
  }
  throw new Error(`invalid_output_format: expected text|json|markdown, got ${value}`);
}

export function normalizeContextCompression(value: string): ContextCompressionMode {
  const lowered = value.toLowerCase();
  if (lowered === "off" || lowered === "none" || lowered === "disabled") {
    return "off";
  }
  if (lowered === "local" || lowered === "ccr") {
    return "local";
  }
  if (lowered === "headroom" || lowered === "headroom-proxy") {
    return "headroom";
  }
  throw new Error(`invalid_context_compression: expected off|local|headroom, got ${value}`);
}

export function normalizeSummaryMode(value: string): SummaryMode {
  const lowered = value.toLowerCase();
  if (lowered === "auto" || lowered === "off" || lowered === "always") {
    return lowered;
  }
  throw new Error(`invalid_summary_mode: expected auto|off|always, got ${value}`);
}

export function normalizeTerminalMode(value: string): TerminalMode {
  const lowered = value.toLowerCase();
  if (lowered === "tui" || lowered === "scrollback") {
    return lowered;
  }
  throw new Error(`invalid_terminal_mode: expected tui|scrollback, got ${value}`);
}

export function normalizeThinkingDisplayMode(value: string): ThinkingDisplayMode {
  const lowered = value.toLowerCase();
  if (lowered === "off" || lowered === "summary" || lowered === "verbose") {
    return lowered;
  }
  throw new Error(`invalid_thinking_display: expected off|summary|verbose, got ${value}`);
}

export function normalizeProvider(value: string): ProviderKind {
  const lowered = value.toLowerCase();
  if (
    lowered === "openai-compatible" ||
    lowered === "openai" ||
    lowered === "openrouter" ||
    lowered === "dashscope" ||
    lowered === "ollama" ||
    lowered === "deepseek" ||
    lowered === "vllm" ||
    lowered === "llama.cpp"
  ) {
    return "openai-compatible";
  }
  if (lowered === "anthropic" || lowered === "claude") {
    return "anthropic";
  }
  throw new Error(`invalid_provider: expected openai-compatible|anthropic, got ${value}`);
}

function inferProvider(): ProviderKind {
  if (process.env["ANTHROPIC_API_KEY"] || process.env["ANTHROPIC_AUTH_TOKEN"]) {
    return "anthropic";
  }
  return "openai-compatible";
}

function defaultsForProvider(provider: ProviderKind): { model: string; baseUrl: string; apiKey: string } {
  if (provider === "anthropic") {
    return {
      model: process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-4-6",
      baseUrl: process.env["ANTHROPIC_BASE_URL"] ?? "https://api.anthropic.com",
      apiKey: process.env["ANTHROPIC_API_KEY"] ?? process.env["ANTHROPIC_AUTH_TOKEN"] ?? ""
    };
  }
  return {
    model:
      process.env["OPENAI_MODEL"] ??
      process.env["DEEPSEEK_MODEL"] ??
      process.env["OLLAMA_MODEL"] ??
      process.env["DASHSCOPE_MODEL"] ??
      "qwen3:8b",
    baseUrl:
      process.env["OPENAI_BASE_URL"] ??
      process.env["DEEPSEEK_BASE_URL"] ??
      process.env["OLLAMA_BASE_URL"] ??
      process.env["DASHSCOPE_BASE_URL"] ??
      "http://localhost:11434/v1",
    apiKey:
      process.env["OPENAI_API_KEY"] ??
      process.env["DEEPSEEK_API_KEY"] ??
      process.env["OLLAMA_API_KEY"] ??
      process.env["DASHSCOPE_API_KEY"] ??
      "ollama"
  };
}

function readPermissionModeEnv(): string | undefined {
  return process.env["CODE_AGENT_PERMISSION_MODE"];
}

function readOutputFormatEnv(): string | undefined {
  return process.env["CODE_AGENT_OUTPUT_FORMAT"];
}

function normalizeProfileName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function resolveProfile(fileConfig: ConfigFile, name: string): RuntimeProfileConfig {
  const profile = fileConfig.profiles?.[name];
  if (!profile) {
    throw new Error(`profile_not_found: ${name}`);
  }
  return profile;
}

function resolveProfileApiKey(profile: RuntimeProfileConfig): string | undefined {
  if (profile.apiKey !== undefined) {
    return profile.apiKey;
  }
  if (profile.apiKeyEnv) {
    return process.env[profile.apiKeyEnv] ?? "";
  }
  return undefined;
}

function readBooleanEnv(name: string): boolean {
  const value = process.env[name];
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "on";
}

function readOptionalBooleanEnv(name: string): boolean | undefined {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "on";
}

function readOptionalIntEnv(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined || !value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`invalid_int_env: ${name} must be an integer, got ${value}`);
  }
  return parsed;
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`invalid_positive_int: expected a positive integer, got ${value}`);
  }
  return value;
}
