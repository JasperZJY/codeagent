import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentGoal, ConversationMessage, TokenUsage } from "./types.js";
import { redactSensitiveData, redactSensitiveText } from "./security.js";

export interface PersistedSession {
  version: 1;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  workspaceRoot: string;
  model: string;
  messages: ConversationMessage[];
  promptHistory: string[];
  usage: TokenUsage;
  goals?: AgentGoal[];
}

export class SessionStore {
  constructor(private readonly workspaceRoot: string) {}

  async loadOrCreate(sessionId: string | undefined, model: string): Promise<PersistedSession> {
    if (sessionId) {
      const loaded = await this.load(sessionId);
      if (loaded) {
        return loaded;
      }
    }
    return newSession(this.workspaceRoot, model);
  }

  async save(session: PersistedSession): Promise<string> {
    const dir = this.sessionDir();
    await mkdir(dir, { recursive: true });
    session.updatedAt = new Date().toISOString();
    const target = path.join(dir, `${session.sessionId}.json`);
    await writeFile(target, JSON.stringify(session, null, 2), "utf8");
    return target;
  }

  async load(sessionId: string): Promise<PersistedSession | undefined> {
    const target = path.join(this.sessionDir(), `${sessionId}.json`);
    if (!existsSync(target)) {
      return undefined;
    }
    const payload = JSON.parse(await readFile(target, "utf8")) as PersistedSession;
    if (payload.workspaceRoot !== this.workspaceRoot) {
      throw new Error(
        `session_workspace_mismatch: session belongs to ${payload.workspaceRoot}, current workspace is ${this.workspaceRoot}`
      );
    }
    payload.goals ??= [];
    return payload;
  }

  async list(): Promise<PersistedSession[]> {
    const dir = this.sessionDir();
    if (!existsSync(dir)) {
      return [];
    }
    const entries = await readdir(dir);
    const sessions: PersistedSession[] = [];
    for (const entry of entries.filter((value) => value.endsWith(".json"))) {
      const payload = JSON.parse(await readFile(path.join(dir, entry), "utf8")) as PersistedSession;
      payload.goals ??= [];
      sessions.push(payload);
    }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private sessionDir(): string {
    return path.join(this.workspaceRoot, ".code-agent", "sessions");
  }
}

export function appendMessage(session: PersistedSession, message: ConversationMessage): void {
  const redacted = redactMessage(message);
  session.messages.push(redacted);
  if (redacted.role === "user") {
    const text = redacted.blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    session.promptHistory.push(text);
  }
  if (redacted.usage) {
    session.usage = addUsage(session.usage, redacted.usage);
  }
}

export function estimateUsage(input: string, output: string): TokenUsage {
  return {
    inputTokens: countTokens(input),
    outputTokens: countTokens(output)
  };
}

function newSession(workspaceRoot: string, model: string): PersistedSession {
  const now = new Date().toISOString();
  return {
    version: 1,
    sessionId: randomUUID(),
    createdAt: now,
    updatedAt: now,
    workspaceRoot,
    model,
    messages: [],
    promptHistory: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    goals: []
  };
}

function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens
  };
}

function countTokens(value: string): number {
  const normalized = value.trim();
  if (!normalized) {
    return 0;
  }
  const cjkChars = [...normalized].filter((char) => /[\u3400-\u9fff]/u.test(char)).length;
  const nonCjk = normalized.replace(/[\u3400-\u9fff]/gu, "");
  const asciiTokens = Math.ceil(nonCjk.replace(/\s+/g, " ").trim().length / 4);
  const cjkTokens = Math.ceil(cjkChars / 1.7);
  return Math.max(1, asciiTokens + cjkTokens);
}

function redactMessage(message: ConversationMessage): ConversationMessage {
  return {
    ...message,
    blocks: message.blocks.map((block) => {
      if (block.type === "text") {
        return { ...block, text: redactSensitiveText(block.text) };
      }
      if (block.type === "tool_use") {
        return { ...block, input: redactSensitiveData(block.input) };
      }
      return { ...block, output: redactSensitiveData(block.output) };
    })
  };
}
