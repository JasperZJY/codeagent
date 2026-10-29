import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateSessionSummary, firstText, lastText } from "./sessionSummary.js";
import { generateSessionTitleFallback, isTemporarySessionTitle, normalizeSessionText, redactSessionText, temporarySessionTitle } from "./sessionTitle.js";
import type { AgentGoal, ConversationMessage, ProviderKind, TokenUsage } from "./types.js";
import { redactSensitiveData, redactSensitiveText } from "./security.js";

export interface PersistedSession {
  version: 1;
  sessionId: string;
  title?: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
  workspaceRoot: string;
  model: string;
  provider?: ProviderKind;
  profile?: string;
  lastUserMessagePreview?: string;
  messages: ConversationMessage[];
  promptHistory: string[];
  usage: TokenUsage;
  goals?: AgentGoal[];
}

export interface SessionRuntimeMetadata {
  model?: string;
  provider?: ProviderKind;
  profile?: string;
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

  async save(session: PersistedSession, runtime?: SessionRuntimeMetadata): Promise<string> {
    const dir = this.sessionDir();
    await mkdir(dir, { recursive: true });
    session.updatedAt = new Date().toISOString();
    refreshSessionMetadata(session, runtime);
    const target = path.join(dir, `${session.sessionId}.json`);
    await writeFile(target, JSON.stringify(session, null, 2), "utf8");
    return target;
  }

  async load(sessionId: string): Promise<PersistedSession | undefined> {
    const resolved = await this.resolveSessionPath(sessionId);
    if (!resolved) {
      return undefined;
    }
    const payload = await this.readSession(resolved);
    this.assertWorkspace(payload);
    return payload;
  }

  async list(): Promise<PersistedSession[]> {
    return (await this.listAll()).filter((session) => this.belongsToWorkspace(session));
  }

  async listAll(): Promise<PersistedSession[]> {
    const sessions: PersistedSession[] = [];
    for (const dir of [this.sessionDir(), this.legacySessionDir()]) {
      if (!existsSync(dir)) {
        continue;
      }
      const entries = await readdir(dir);
      for (const entry of entries.filter((value) => value.endsWith(".json"))) {
        const payload = await this.readSession(path.join(dir, entry));
        sessions.push(payload);
      }
    }
    return dedupeSessions(sessions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  sessionsDirectory(): string {
    return this.sessionDir();
  }

  workspaceFingerprint(): string {
    return workspaceFingerprint(this.workspaceRoot);
  }

  private async resolveSessionPath(sessionId: string): Promise<string | undefined> {
    const normalized = sessionId.trim();
    if (isLatestAlias(normalized)) {
      const latest = (await this.list())[0];
      if (!latest) {
        return undefined;
      }
      for (const dir of [this.sessionDir(), this.legacySessionDir()]) {
        const candidate = path.join(dir, `${latest.sessionId}.json`);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
      return undefined;
    }
    for (const dir of [this.sessionDir(), this.legacySessionDir()]) {
      const candidate = path.join(dir, `${normalized}.json`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  private async readSession(filePath: string): Promise<PersistedSession> {
    const payload = JSON.parse(await readFile(filePath, "utf8")) as PersistedSession;
    return hydrateSession(payload);
  }

  private assertWorkspace(session: PersistedSession): void {
    if (!this.belongsToWorkspace(session)) {
      throw new Error(
        `session_workspace_mismatch: session belongs to ${session.workspaceRoot}, current workspace is ${this.workspaceRoot}`
      );
    }
  }

  private belongsToWorkspace(session: PersistedSession): boolean {
    return path.resolve(session.workspaceRoot) === path.resolve(this.workspaceRoot);
  }

  private sessionDir(): string {
    return path.join(this.workspaceRoot, ".code-agent", "sessions", workspaceFingerprint(this.workspaceRoot));
  }

  private legacySessionDir(): string {
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
  refreshSessionMetadata(session);
}

export function hydrateSession(session: PersistedSession): PersistedSession {
  session.goals ??= [];
  session.promptHistory ??= [];
  session.usage ??= { inputTokens: 0, outputTokens: 0 };
  session.messages ??= [];
  refreshSessionMetadata(session);
  return session;
}

export function refreshSessionMetadata(
  session: PersistedSession,
  runtime?: SessionRuntimeMetadata,
  options: { forceTitle?: boolean; forceSummary?: boolean } = {}
): void {
  if (runtime?.model) {
    session.model = runtime.model;
  }
  if (runtime?.provider) {
    session.provider = runtime.provider;
  }
  if (runtime && "profile" in runtime) {
    if (runtime.profile) {
      session.profile = runtime.profile;
    } else {
      delete session.profile;
    }
  }

  const firstUserMessage = firstText(session.messages, "user");
  if (options.forceTitle || isTemporarySessionTitle(session.title)) {
    session.title = firstUserMessage
      ? generateSessionTitleFallback(firstUserMessage, session.createdAt)
      : temporarySessionTitle(session.createdAt);
  } else {
    session.title = redactSessionText(session.title ?? temporarySessionTitle(session.createdAt));
  }

  const generatedSummary = generateSessionSummary({ messages: session.messages });
  if (options.forceSummary || (!session.summary && generatedSummary)) {
    if (generatedSummary) {
      session.summary = generatedSummary;
    } else {
      delete session.summary;
    }
  } else if (session.summary) {
    session.summary = redactSessionText(session.summary);
  }

  const lastUserMessage = lastText(session.messages, "user");
  if (lastUserMessage) {
    session.lastUserMessagePreview = normalizeSessionText(lastUserMessage).slice(0, 160);
  }
}

export function sessionHasMeaningfulContent(session: PersistedSession): boolean {
  return session.messages.some((message) =>
    message.blocks.some((block) => block.type === "text" && block.text.trim().length > 0)
  );
}

export function estimateUsage(input: string, output: string): TokenUsage {
  return {
    inputTokens: countTokens(input),
    outputTokens: countTokens(output)
  };
}

export function workspaceFingerprint(workspaceRoot: string): string {
  return createHash("sha256").update(path.resolve(workspaceRoot)).digest("hex").slice(0, 16);
}

function newSession(workspaceRoot: string, model: string): PersistedSession {
  const now = new Date().toISOString();
  return {
    version: 1,
    sessionId: randomUUID(),
    title: temporarySessionTitle(now),
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

function dedupeSessions(sessions: PersistedSession[]): PersistedSession[] {
  const seen = new Set<string>();
  const output: PersistedSession[] = [];
  for (const session of sessions) {
    if (seen.has(session.sessionId)) {
      continue;
    }
    seen.add(session.sessionId);
    output.push(session);
  }
  return output;
}

function isLatestAlias(value: string): boolean {
  return value === "latest" || value === "last" || value === "recent";
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
