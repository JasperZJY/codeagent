const DEFAULT_FETCH_BYTES = 20000;

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

export async function webSearchTool(input: Record<string, unknown>): Promise<unknown> {
  const query = requireString(input, "query");
  const provider = String(input["provider"] ?? process.env["CODE_AGENT_WEB_SEARCH_PROVIDER"] ?? "baidu-ai");
  if (provider !== "baidu-ai") {
    throw new Error(`unsupported_web_search_provider: ${provider}`);
  }
  return await baiduAiSearch(query);
}

async function baiduAiSearch(query: string): Promise<unknown> {
  const apiKey =
    process.env["BAIDU_AI_SEARCH_API_KEY"] ??
    process.env["CODE_AGENT_WEB_SEARCH_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "web_search_unconfigured: set BAIDU_AI_SEARCH_API_KEY or CODE_AGENT_WEB_SEARCH_API_KEY"
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
