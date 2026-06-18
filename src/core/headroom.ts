import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ConversationMessage, RuntimeConfig } from "./types.js";
import { redactSensitiveData } from "./security.js";

const MIN_COMPRESS_CHARS = 6000;
const MAX_SUMMARY_CHARS = 2400;

export interface CcrEntry {
  version: 1;
  ref: string;
  createdAt: string;
  kind: "tool_result" | "message";
  original: unknown;
  serialized: string;
}

export async function prepareMessagesForModel(
  config: RuntimeConfig,
  messages: ConversationMessage[]
): Promise<ConversationMessage[]> {
  const mode = config.contextCompression ?? "local";
  if (mode === "off" || mode === "headroom") {
    return messages;
  }
  return await compressLargeToolResults(config, messages);
}

export async function retrieveCcrEntry(
  workspaceRoot: string,
  ref: string,
  query?: string
): Promise<unknown> {
  if (!/^[a-f0-9]{16,64}$/i.test(ref)) {
    throw new Error("invalid_ccr_ref");
  }
  const entryPath = path.join(ccrDir(workspaceRoot), `${ref}.json`);
  const entry = JSON.parse(await readFile(entryPath, "utf8")) as CcrEntry;
  if (!query?.trim()) {
    return {
      ref: entry.ref,
      kind: entry.kind,
      original: entry.original
    };
  }
  return {
    ref: entry.ref,
    kind: entry.kind,
    query,
    matches: searchSerialized(entry.serialized, query).slice(0, 80)
  };
}

async function compressLargeToolResults(
  config: RuntimeConfig,
  messages: ConversationMessage[]
): Promise<ConversationMessage[]> {
  const output: ConversationMessage[] = [];
  for (const message of messages) {
    const blocks = [];
    for (const block of message.blocks) {
      if (block.type !== "tool_result") {
        blocks.push(block);
        continue;
      }
      const safeOutput = redactSensitiveData(block.output);
      const serialized = safeStringify(safeOutput);
      if (serialized.length < MIN_COMPRESS_CHARS) {
        blocks.push(block);
        continue;
      }
      const ref = await storeCcrEntry(config.workspaceRoot, {
        version: 1,
        ref: "",
        createdAt: new Date().toISOString(),
        kind: "tool_result",
        original: safeOutput,
        serialized
      });
      const summary = summarizeLargeOutput(safeOutput, serialized);
      blocks.push({
        ...block,
        output: {
          kind: "ccr_compressed",
          ref,
          originalChars: serialized.length,
          compressedChars: safeStringify(summary).length,
          summary,
          retrieve: {
            tool: "ccr_retrieve",
            input: { ref }
          },
          note: "Original tool output is cached locally. Call ccr_retrieve with this ref if the summary is insufficient."
        }
      });
    }
    output.push({ ...message, blocks });
  }
  return output;
}

async function storeCcrEntry(workspaceRoot: string, entry: CcrEntry): Promise<string> {
  const ref = createHash("sha256").update(entry.serialized).digest("hex").slice(0, 32);
  const completeEntry: CcrEntry = { ...entry, ref };
  const dir = ccrDir(workspaceRoot);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${ref}.json`), JSON.stringify(completeEntry, null, 2), "utf8");
  return ref;
}

function ccrDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".code-agent", "ccr");
}

function summarizeLargeOutput(value: unknown, serialized: string): unknown {
  if (Array.isArray(value)) {
    return summarizeArray(value);
  }
  if (typeof value === "string") {
    return summarizeText(value);
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const compacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(object)) {
      const itemText = safeStringify(item);
      compacted[key] = itemText.length > MAX_SUMMARY_CHARS
        ? summarizeLargeOutput(item, itemText)
        : item;
    }
    return compacted;
  }
  return summarizeText(serialized);
}

function summarizeArray(values: unknown[]): unknown {
  const head = values.slice(0, 8);
  const tail = values.slice(Math.max(8, values.length - 5));
  return {
    type: "array",
    totalItems: values.length,
    retainedItems: head.length + tail.length,
    head,
    tail
  };
}

function summarizeText(value: string): unknown {
  const lines = value.split(/\r?\n/);
  if (lines.length <= 120 && value.length <= MAX_SUMMARY_CHARS) {
    return value;
  }
  const head = lines.slice(0, 50);
  const tail = lines.slice(Math.max(50, lines.length - 40));
  const middle = lines.slice(50, Math.max(50, lines.length - 40));
  const notable = middle.filter((line) => /error|failed|exception|fatal|warning|traceback/i.test(line)).slice(0, 40);
  return {
    type: "text",
    totalLines: lines.length,
    head: head.join("\n"),
    notable: notable.join("\n"),
    omittedLines: Math.max(0, lines.length - head.length - tail.length - notable.length),
    tail: tail.join("\n")
  };
}

function searchSerialized(serialized: string, query: string): string[] {
  const needles = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (needles.length === 0) {
    return [];
  }
  return serialized
    .split(/\r?\n/)
    .filter((line) => {
      const lower = line.toLowerCase();
      return needles.every((needle) => lower.includes(needle));
    });
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
