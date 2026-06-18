import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ConversationMessage } from "./types.js";
import { redactSensitiveText } from "./security.js";

export type MemoryType = "preference" | "project_fact" | "lesson" | "failure" | "success";

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  text: string;
  tags: string[];
  createdAt: string;
  source?: string;
}

export class MemoryStore {
  constructor(private readonly workspaceRoot: string) {}

  async append(entry: Omit<MemoryEntry, "id" | "createdAt">): Promise<MemoryEntry> {
    const safeEntry = {
      ...entry,
      text: redactSensitiveText(entry.text)
    };
    const complete: MemoryEntry = {
      ...safeEntry,
      id: stableId(safeEntry.type, safeEntry.text),
      createdAt: new Date().toISOString()
    };
    const existing = await this.list();
    if (existing.some((item) => item.id === complete.id)) {
      return complete;
    }
    await mkdir(path.dirname(this.memoryPath()), { recursive: true });
    const next = [...existing, complete];
    await writeFile(this.memoryPath(), next.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
    return complete;
  }

  async list(limit = 50): Promise<MemoryEntry[]> {
    if (!existsSync(this.memoryPath())) {
      return [];
    }
    const lines = (await readFile(this.memoryPath(), "utf8")).split(/\r?\n/).filter(Boolean);
    return lines
      .map((line) => JSON.parse(line) as MemoryEntry)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async search(query: string, limit = 6): Promise<MemoryEntry[]> {
    const tokens = tokenize(query);
    if (tokens.length === 0) {
      return await this.list(limit);
    }
    const entries = await this.list(500);
    return entries
      .map((entry) => ({ entry, score: scoreMemory(entry, tokens) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt))
      .slice(0, limit)
      .map((item) => item.entry);
  }

  private memoryPath(): string {
    return path.join(this.workspaceRoot, ".code-agent", "memory", "project.jsonl");
  }
}

export function buildMemoryContext(entries: MemoryEntry[]): string {
  if (entries.length === 0) {
    return "";
  }
  return [
    "Relevant project memory:",
    ...entries.map((entry) => `- ${entry.type}: ${entry.text}`)
  ].join("\n");
}

export function deriveMemoryFromTurn(
  prompt: string,
  toolResults: ConversationMessage[],
  reflectionLessons: string[]
): Array<Omit<MemoryEntry, "id" | "createdAt">> {
  const entries: Array<Omit<MemoryEntry, "id" | "createdAt">> = [];
  const lowerPrompt = prompt.toLowerCase();
  if (lowerPrompt.includes("以后") || lowerPrompt.includes("记住") || lowerPrompt.includes("prefer")) {
    entries.push({
      type: "preference",
      text: redactSensitiveText(prompt),
      tags: ["user_preference"],
      source: "user_prompt"
    });
  }
  for (const lesson of reflectionLessons) {
    entries.push({
      type: "lesson",
      text: redactSensitiveText(lesson),
      tags: ["reflection"],
      source: "reflection"
    });
  }
  for (const result of toolResults) {
    const block = result.blocks.find((item) => item.type === "tool_result");
    if (!block || block.type !== "tool_result" || !block.isError) {
      continue;
    }
    entries.push({
      type: "failure",
      text: redactSensitiveText(`${block.toolName} failed: ${shorten(safeStringify(block.output), 240)}`),
      tags: ["tool_failure", block.toolName],
      source: "tool_result"
    });
  }
  return entries;
}

function scoreMemory(entry: MemoryEntry, queryTokens: string[]): number {
  const haystack = tokenize(`${entry.type} ${entry.text} ${entry.tags.join(" ")}`);
  const set = new Set(haystack);
  return queryTokens.reduce((score, token) => score + (set.has(token) ? 2 : haystack.some((item) => item.includes(token)) ? 1 : 0), 0);
}

function stableId(type: MemoryType, text: string): string {
  const digest = createHash("sha256").update(`${type}:${text}`).digest("hex").slice(0, 16);
  return digest || randomUUID();
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function shorten(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}
