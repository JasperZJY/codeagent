import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_FETCH_BYTES = 20000;
const WEB_SEARCH_ENV_KEYS = new Set([
  "BAIDU_AI_SEARCH_API_KEY",
  "CODE_AGENT_WEB_SEARCH_API_KEY",
  "CODE_AGENT_WEB_SEARCH_PROVIDER"
]);

export async function fetchUrlTool(input: Record<string, unknown>): Promise<unknown> {
  const url = requireString(input, "url");
  const maxBytes = optionalNumber(input, "maxBytes") ?? DEFAULT_FETCH_BYTES;
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("invalid_url_protocol: expected http or https");
  }
  const response = await fetch(parsed);
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  return {
    url,
    status: response.status,
    ok: response.ok,
    contentType,
    truncated: Buffer.byteLength(text, "utf8") > maxBytes,
    content: truncateBytes(text, maxBytes)
  };
}

export async function webSearchTool(input: Record<string, unknown>, workspaceRoot?: string): Promise<unknown> {
  const query = requireString(input, "query");
  const env = webSearchEnv(workspaceRoot);
  const provider = String(input["provider"] ?? envValue(env, "CODE_AGENT_WEB_SEARCH_PROVIDER") ?? "baidu-ai");
  if (provider === "mock") {
    return { provider: "mock", query, result: `Mock search result for ${query}` };
  }
  if (provider !== "baidu-ai") {
    throw new Error(`unsupported_web_search_provider: ${provider}`);
  }
  return await baiduAiSearch(query, env);
}

async function baiduAiSearch(query: string, env: WebSearchEnv): Promise<unknown> {
  const apiKey = firstNonEmpty(
    envValue(env, "BAIDU_AI_SEARCH_API_KEY"),
    envValue(env, "CODE_AGENT_WEB_SEARCH_API_KEY")
  );
  if (!apiKey) {
    throw new Error(
      "web_search_unconfigured: set BAIDU_AI_SEARCH_API_KEY or CODE_AGENT_WEB_SEARCH_API_KEY in the current workspace .env"
    );
  }
  const response = await fetch("https://qianfan.baidubce.com/v2/ai_search/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: query }],
      stream: false
    })
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(`web_search_failed: HTTP ${response.status} ${JSON.stringify(payload)}`);
  }
  return {
    provider: "baidu-ai",
    query,
    result: payload
  };
}

interface WebSearchEnv {
  process: NodeJS.ProcessEnv;
  project: Partial<Record<string, string>>;
  workspace: Partial<Record<string, string>>;
}

function webSearchEnv(workspaceRoot: string | undefined): WebSearchEnv {
  return {
    process: process.env,
    project: loadWorkspaceWebSearchEnv(projectRoot()),
    workspace: loadWorkspaceWebSearchEnv(workspaceRoot)
  };
}

function loadWorkspaceWebSearchEnv(workspaceRoot: string | undefined): Partial<Record<string, string>> {
  if (!workspaceRoot) {
    return {};
  }
  const envPath = path.join(workspaceRoot, ".env");
  if (!existsSync(envPath)) {
    return {};
  }
  const values: Partial<Record<string, string>> = {};
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
    if (!WEB_SEARCH_ENV_KEYS.has(key)) {
      continue;
    }
    values[key] = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
  }
  return values;
}

function projectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function envValue(env: WebSearchEnv, key: string): string | undefined {
  return env.workspace[key] ?? env.project[key] ?? env.process[key];
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim() !== "");
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`invalid_tool_input: '${key}' must be a non-empty string`);
  }
  return value.trim();
}

function optionalNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`invalid_tool_input: '${key}' must be a positive number`);
  }
  return Math.floor(value);
}

function truncateBytes(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) {
    return value;
  }
  return `${buffer.subarray(0, maxBytes).toString("utf8")}\n...[truncated]`;
}
