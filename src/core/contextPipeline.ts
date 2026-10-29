import path from "node:path";
import { prepareMessagesForModel } from "./headroom.js";
import { buildMemoryContext, MemoryStore, type MemoryEntry } from "./memory.js";
import { buildRagContext, searchRag, type RagSearchResult } from "./rag.js";
import { matchSkillsForPrompt, type SkillMatch } from "./skills.js";
import type { ConversationMessage, RuntimeConfig } from "./types.js";

export interface PreparedTurnContext {
  systemPrompt: string;
  runtimeContext: string;
  messages: ConversationMessage[];
  memoryMatches: MemoryEntry[];
  ragMatches: RagSearchResult[];
  skillMatches: SkillMatch[];
}

export class ContextPipeline {
  constructor(private readonly config: RuntimeConfig) {}

  async prepareTurnContext(prompt: string, messages: ConversationMessage[] = []): Promise<PreparedTurnContext> {
    const memoryStore = new MemoryStore(this.config.workspaceRoot);
    const memoryMatches = await memoryStore.search(prompt, 6);
    const ragMatches = await safeRagSearch(this.config.workspaceRoot, prompt, 6);
    const skillMatches = await safeSkillMatch(this.config.workspaceRoot, prompt, 3);
    const runtimeContext = buildRuntimeContext(memoryMatches, ragMatches, skillMatches);
    const preparedMessages = await prepareMessagesForModel(this.config, messages);
    return {
      systemPrompt: buildRuntimeSystemPrompt(this.config, runtimeContext),
      runtimeContext,
      messages: preparedMessages,
      memoryMatches,
      ragMatches,
      skillMatches
    };
  }

  buildSystemPrompt(runtimeContext = ""): string {
    return buildRuntimeSystemPrompt(this.config, runtimeContext);
  }
}

export function buildRuntimeContext(
  memoryEntries: MemoryEntry[],
  ragMatches: RagSearchResult[],
  skillMatches: SkillMatch[] = []
): string {
  return [
    buildMemoryContext(memoryEntries),
    buildRagContext(ragMatches),
    buildSkillCatalogContext(skillMatches)
  ].filter(Boolean).join("\n\n");
}

export function buildSkillCatalogContext(matches: SkillMatch[]): string {
  if (matches.length === 0) {
    return "";
  }
  return [
    "Available relevant skills (catalog only; use skill_read or skill_use to load full workflow):",
    ...matches.map((match) => {
      const tools = match.skill.tools.length ? match.skill.tools.join(", ") : "none";
      return [
        `- ${match.skill.name}: ${match.skill.description}`,
        `  triggers: ${match.skill.triggers.join(", ") || "none"}`,
        `  tools: ${tools}`,
        `  risk: ${match.skill.risk}`,
        `  reason: ${match.reason}`
      ].join("\n");
    })
  ].join("\n");
}

export function buildRuntimeSystemPrompt(config: RuntimeConfig, runtimeContext = ""): string {
  return [
    "You are a pragmatic code agent runtime.",
    "Use concise, actionable engineering output.",
    "The model is the agent; this project code is the harness that provides tools, context, and boundaries.",
    "You are running inside a local project workspace and can inspect workspace files through tool observations provided by the runtime.",
    `If the user asks what model or big model you are, answer with the configured provider and model exactly: ${config.provider}:${config.model}.`,
    "Do not claim you cannot read local files. Instead, explain that you can read, list, and search files inside the configured workspace when a path or file task is provided.",
    "You cannot access files outside the workspace unless the configured tools and permissions explicitly allow it.",
    "When tool results are present in the conversation, treat them as the source of truth and summarize them for the user.",
    "Do not expose hidden chain-of-thought. Describe only observable actions and results.",
    `Workspace: ${path.resolve(config.workspaceRoot)}`,
    `Permission mode: ${config.permissionMode}`,
    "Available local tools are provided by the registry and may include file, shell, Python, Git, task, skill, code intelligence, web, memory, RAG, and CCR tools depending on permissions.",
    runtimeContext ? `Runtime context:\n${runtimeContext}` : "Runtime context: none"
  ].join("\n");
}

async function safeRagSearch(workspaceRoot: string, prompt: string, limit: number): Promise<RagSearchResult[]> {
  try {
    return await searchRag(workspaceRoot, prompt, limit);
  } catch {
    return [];
  }
}

async function safeSkillMatch(workspaceRoot: string, prompt: string, limit: number): Promise<SkillMatch[]> {
  try {
    return await matchSkillsForPrompt(workspaceRoot, prompt, limit);
  } catch {
    return [];
  }
}
