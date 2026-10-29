import type { ConversationMessage } from "./types.js";
import { normalizeSessionText, redactSessionText } from "./sessionTitle.js";

export function generateSessionSummary(input: { messages: ConversationMessage[]; maxLength?: number }): string | undefined {
  const maxLength = input.maxLength ?? 180;
  const firstUser = firstText(input.messages, "user");
  if (!firstUser) {
    return undefined;
  }
  const firstAssistant = firstText(input.messages, "assistant");
  const userPreview = shorten(normalizeSessionText(firstUser), 90);
  const assistantPreview = firstAssistant ? shorten(normalizeSessionText(firstAssistant), 80) : "";
  const summary = assistantPreview
    ? `本会话主要处理：${userPreview}。助手已回应：${assistantPreview}。`
    : `本会话主要处理：${userPreview}。`;
  return shorten(redactSessionText(summary), maxLength);
}

export function firstText(messages: ConversationMessage[], role: ConversationMessage["role"]): string | undefined {
  for (const message of messages) {
    if (message.role !== role) {
      continue;
    }
    const text = message.blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

export function lastText(messages: ConversationMessage[], role: ConversationMessage["role"]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== role) {
      continue;
    }
    const text = message.blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

function shorten(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, Math.max(0, limit - 3)).trim()}...`;
}
