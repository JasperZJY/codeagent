import type { ConversationMessage, RuntimeConfig, ThinkingTrace, TokenUsage } from "./types.js";
import { prepareMessagesForModel } from "./headroom.js";

const DEFAULT_LLM_TIMEOUT_MS = 300000;

/** Marker appended to fallback answers when the provider call fails. */
export const LLM_UNAVAILABLE_MARKER = "LLM unavailable:";

/**
 * Extract the failure detail from an assistant answer that fell back because the
 * provider was unreachable. Returns undefined for ordinary answers.
 */
export function llmUnavailableReason(text: string): string | undefined {
  const match = text.match(/LLM unavailable:\s*([^\r\n]+)/);
  const reason = match?.[1]?.trim();
  return reason || undefined;
}

function unavailableText(fallbackText: string, detail: string): string {
  return `${fallbackText}\n\n${LLM_UNAVAILABLE_MARKER} ${detail}`;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: ChatCompletionMessage;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface ChatCompletionMessage {
  content?: string;
  reasoning_content?: string;
  reasoning?: string;
  thinking?: string | { content?: string };
}

export interface AssistantGenerationResult {
  text: string;
  usage?: TokenUsage;
  thinking?: ThinkingTrace[];
}

export interface AssistantStreamCallbacks {
  onTextDelta?: (delta: string) => void;
  onThinkingDelta?: (event: ThinkingTrace) => void;
}

export async function generateAssistantText(
  config: RuntimeConfig,
  systemPrompt: string,
  messages: ConversationMessage[],
  fallbackText: string,
  onTextDelta?: (delta: string) => void
): Promise<string> {
  return (await generateAssistantResult(
    config,
    systemPrompt,
    messages,
    fallbackText,
    onTextDelta ? { onTextDelta } : {}
  )).text;
}

export async function generateAssistantResult(
  config: RuntimeConfig,
  systemPrompt: string,
  messages: ConversationMessage[],
  fallbackText: string,
  callbacks: AssistantStreamCallbacks | ((delta: string) => void) = {}
): Promise<AssistantGenerationResult> {
  const streamCallbacks = typeof callbacks === "function" ? { onTextDelta: callbacks } : callbacks;
  if (!config.useLlm) {
    return { text: fallbackText };
  }
  try {
    const preparedMessages = await prepareMessagesForModel(config, messages);
    if (config.provider === "anthropic") {
      return await anthropicCompletion(config, systemPrompt, preparedMessages, fallbackText);
    }
    return await openAiCompatibleCompletion(config, systemPrompt, preparedMessages, fallbackText, streamCallbacks);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { text: unavailableText(fallbackText, message) };
  }
}

async function openAiCompatibleCompletion(
  config: RuntimeConfig,
  systemPrompt: string,
  messages: ConversationMessage[],
  fallbackText: string,
  callbacks: AssistantStreamCallbacks
): Promise<AssistantGenerationResult> {
  const timeout = createLlmTimeout(config);
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: timeout.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        stream: Boolean(callbacks.onTextDelta),
        ...(callbacks.onTextDelta ? { stream_options: { include_usage: true } } : {}),
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((message) => ({
            role: message.role === "tool" ? "user" : message.role,
            content: message.blocks.map((block) => blockToText(block)).join("\n")
          }))
        ]
      })
    });
    if (!response.ok) {
      return { text: unavailableText(fallbackText, `HTTP ${response.status}`) };
    }
    timeout.refresh();
    if (callbacks.onTextDelta) {
      return await readOpenAiCompatibleStream(response, callbacks, fallbackText, timeout);
    }
    const payload = (await response.json()) as ChatCompletionResponse;
    const message = payload.choices?.[0]?.message;
    const messageText = message?.content ?? "";
    const stripped = stripThinkTags(messageText);
    const thinking = [
      ...thinkingFromMessage(message),
      ...(stripped.hiddenChars > 0 ? [{ source: "think_tag" as const, chars: stripped.hiddenChars }] : [])
    ];
    return {
      text: stripped.text.trim() || fallbackText,
      ...usageFromOpenAi(payload.usage),
      ...(thinking.length ? { thinking: mergeThinkingTrace(thinking) } : {})
    };
  } catch (error) {
    if (timeout.isAborted()) {
      throw new Error(timeout.errorMessage());
    }
    throw error;
  } finally {
    timeout.clear();
  }
}

async function readOpenAiCompatibleStream(
  response: Response,
  callbacks: AssistantStreamCallbacks,
  fallbackText: string,
  timeout: LlmTimeout
): Promise<AssistantGenerationResult> {
  if (!response.body) {
    return { text: fallbackText };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage: TokenUsage | undefined;
  const thinking: ThinkingTrace[] = [];
  const thinkTagFilter = new ThinkTagStreamFilter((chars) => {
    const event = { source: "think_tag" as const, chars };
    thinking.push(event);
    callbacks.onThinkingDelta?.(event);
  });

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    timeout.refresh();
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) {
        continue;
      }
      const payload = trimmed.startsWith("data:") ? trimmed.slice("data:".length).trim() : trimmed;
      if (payload === "[DONE]") {
        continue;
      }
      usage = usageFromOpenAiPayload(payload) ?? usage;
      const parsed = parseOpenAiDelta(payload);
      for (const event of parsed.thinking) {
        thinking.push(event);
        callbacks.onThinkingDelta?.(event);
      }
      if (parsed.text) {
        const visible = thinkTagFilter.push(parsed.text);
        if (visible) {
          text += visible;
          callbacks.onTextDelta?.(visible);
        }
      }
    }
  }

  if (buffer.trim()) {
    const payload = buffer.trim().startsWith("data:")
      ? buffer.trim().slice("data:".length).trim()
      : buffer.trim();
    if (payload !== "[DONE]") {
      usage = usageFromOpenAiPayload(payload) ?? usage;
      const parsed = parseOpenAiDelta(payload);
      for (const event of parsed.thinking) {
        thinking.push(event);
        callbacks.onThinkingDelta?.(event);
      }
      if (parsed.text) {
        const visible = thinkTagFilter.push(parsed.text);
        if (visible) {
          text += visible;
          callbacks.onTextDelta?.(visible);
        }
      }
    }
  }
  const flushed = thinkTagFilter.flush();
  if (flushed) {
    text += flushed;
    callbacks.onTextDelta?.(flushed);
  }

  return {
    text: text.trim() || fallbackText,
    ...(usage ? { usage } : {}),
    ...(thinking.length ? { thinking: mergeThinkingTrace(thinking) } : {})
  };
}

function parseOpenAiDelta(payload: string): { text: string; thinking: ThinkingTrace[] } {
  try {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{
        delta?: {
          content?: string;
          reasoning_content?: string;
          reasoning?: string;
          thinking?: string | { content?: string };
        };
        message?: {
          content?: string;
          reasoning_content?: string;
          reasoning?: string;
          thinking?: string | { content?: string };
        };
      }>;
    };
    const thinking: ThinkingTrace[] = [];
    const text = parsed.choices?.map((choice) => {
      const source = choice.delta ?? choice.message;
      if (!source) {
        return "";
      }
      for (const key of ["reasoning_content", "reasoning", "thinking"] as const) {
        const value = source[key];
        const content = typeof value === "string" ? value : value?.content;
        if (content) {
          thinking.push({
            source: key === "thinking" ? "thinking" : key,
            chars: [...content].length
          });
        }
      }
      return source.content ?? "";
    }).join("") ?? "";
    return { text, thinking };
  } catch {
    return { text: "", thinking: [] };
  }
}

function stripThinkTags(value: string): { text: string; hiddenChars: number } {
  let hiddenChars = 0;
  const text = value.replace(/<think\b[^>]*>([\s\S]*?)<\/think>/gi, (_match, hidden: string) => {
    hiddenChars += [...hidden].length;
    return "";
  });
  return { text, hiddenChars };
}

function thinkingFromMessage(source: ChatCompletionMessage | undefined): ThinkingTrace[] {
  if (!source) {
    return [];
  }
  const events: ThinkingTrace[] = [];
  for (const key of ["reasoning_content", "reasoning", "thinking"] as const) {
    const value = source[key];
    const content = typeof value === "string" ? value : value?.content;
    if (content) {
      events.push({
        source: key === "thinking" ? "thinking" : key,
        chars: [...content].length
      });
    }
  }
  return events;
}

class ThinkTagStreamFilter {
  private mode: "text" | "thinking" = "text";
  private pending = "";

  constructor(private readonly onHidden: (chars: number) => void) {}

  push(delta: string): string {
    this.pending += delta;
    let visible = "";
    while (this.pending) {
      if (this.mode === "text") {
        const open = this.pending.toLowerCase().indexOf("<think>");
        if (open === -1) {
          const emitLength = Math.max(0, this.pending.length - "<think>".length);
          visible += this.pending.slice(0, emitLength);
          this.pending = this.pending.slice(emitLength);
          break;
        }
        visible += this.pending.slice(0, open);
        this.pending = this.pending.slice(open + "<think>".length);
        this.mode = "thinking";
        continue;
      }
      const close = this.pending.toLowerCase().indexOf("</think>");
      if (close === -1) {
        const hideLength = Math.max(0, this.pending.length - "</think>".length);
        if (hideLength > 0) {
          this.onHidden([...this.pending.slice(0, hideLength)].length);
        }
        this.pending = this.pending.slice(hideLength);
        break;
      }
      if (close > 0) {
        this.onHidden([...this.pending.slice(0, close)].length);
      }
      this.pending = this.pending.slice(close + "</think>".length);
      this.mode = "text";
    }
    return visible;
  }

  flush(): string {
    if (this.mode === "thinking") {
      if (this.pending) {
        this.onHidden([...this.pending].length);
      }
      this.pending = "";
      return "";
    }
    const visible = this.pending;
    this.pending = "";
    return visible;
  }
}

function mergeThinkingTrace(events: ThinkingTrace[]): ThinkingTrace[] {
  const totals = new Map<ThinkingTrace["source"], number>();
  for (const event of events) {
    totals.set(event.source, (totals.get(event.source) ?? 0) + event.chars);
  }
  return [...totals.entries()].map(([source, chars]) => ({ source, chars }));
}

async function anthropicCompletion(
  config: RuntimeConfig,
  systemPrompt: string,
  messages: ConversationMessage[],
  fallbackText: string
): Promise<AssistantGenerationResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01"
  };
  if (process.env["ANTHROPIC_AUTH_TOKEN"] && !process.env["ANTHROPIC_API_KEY"]) {
    headers["authorization"] = `Bearer ${config.apiKey}`;
  } else {
    headers["x-api-key"] = config.apiKey;
  }
  const timeout = createLlmTimeout(config);
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      signal: timeout.signal,
      headers,
      body: JSON.stringify({
        model: config.model,
        max_tokens: 2048,
        temperature: 0,
        system: systemPrompt,
        messages: messages
          .filter((message) => message.role !== "system")
          .map((message) => ({
            role: message.role === "assistant" ? "assistant" : "user",
            content: message.blocks.map((block) => blockToText(block)).join("\n")
          }))
      })
    });
    if (!response.ok) {
      return { text: unavailableText(fallbackText, `HTTP ${response.status}`) };
    }
    timeout.refresh();
    const payload = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const usage = payload.usage
      ? {
        usage: {
          inputTokens: Number(payload.usage.input_tokens ?? 0),
          outputTokens: Number(payload.usage.output_tokens ?? 0),
          source: "api" as const
        }
      }
      : {};
    return {
      text: payload.content?.map((block) => block.text ?? "").join("").trim() || fallbackText,
      ...usage
    };
  } catch (error) {
    if (timeout.isAborted()) {
      throw new Error(timeout.errorMessage());
    }
    throw error;
  } finally {
    timeout.clear();
  }
}

function usageFromOpenAiPayload(payload: string): TokenUsage | undefined {
  try {
    const parsed = JSON.parse(payload) as { usage?: ChatCompletionResponse["usage"] };
    return usageFromOpenAi(parsed.usage).usage;
  } catch {
    return undefined;
  }
}

function usageFromOpenAi(usage: ChatCompletionResponse["usage"] | undefined): { usage?: TokenUsage } {
  if (!usage) {
    return {};
  }
  const inputTokens = Number(usage.prompt_tokens ?? 0);
  const outputTokens = Number(usage.completion_tokens ?? 0);
  if (!inputTokens && !outputTokens && !usage.total_tokens) {
    return {};
  }
  return {
    usage: {
      inputTokens,
      outputTokens,
      source: "api"
    }
  };
}

interface LlmTimeout {
  signal: AbortSignal;
  ms: number;
  totalMs: number;
  isAborted: () => boolean;
  refresh: () => void;
  errorMessage: () => string;
  clear: () => void;
}

function createLlmTimeout(config: RuntimeConfig): LlmTimeout {
  const ms = Math.max(1, Math.floor(config.llmTimeoutMs ?? DEFAULT_LLM_TIMEOUT_MS));
  const totalMs = Math.max(ms, Math.min(ms * 3, DEFAULT_LLM_TIMEOUT_MS));
  const controller = new AbortController();
  let abortedBy: "idle" | "total" | undefined;
  const abort = (reason: "idle" | "total") => {
    if (controller.signal.aborted) {
      return;
    }
    abortedBy = reason;
    controller.abort();
  };
  let timer = setTimeout(() => abort("idle"), ms);
  const totalTimer = setTimeout(() => abort("total"), totalMs);
  const refresh = () => {
    if (controller.signal.aborted) {
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => abort("idle"), ms);
  };
  return {
    signal: controller.signal,
    ms,
    totalMs,
    isAborted: () => controller.signal.aborted,
    refresh,
    errorMessage: () => abortedBy === "total"
      ? `request exceeded maximum duration after ${totalMs}ms`
      : `request timed out after ${ms}ms`,
    clear: () => {
      clearTimeout(timer);
      clearTimeout(totalTimer);
    }
  };
}

function blockToText(block: ConversationMessage["blocks"][number]): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "tool_use":
      return `Tool use ${block.name}: ${JSON.stringify(block.input)}`;
    case "tool_result":
      return `Tool result ${block.toolName}: ${JSON.stringify(block.output)}`;
  }
}
