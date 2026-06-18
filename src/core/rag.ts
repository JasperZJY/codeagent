import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkspacePathScope } from "./pathScope.js";
import { isSensitivePath, redactSensitiveText } from "./security.js";

const INDEX_VERSION = 1;
const MAX_FILE_BYTES = 512 * 1024;
const CHUNK_LINES = 80;
const MAX_CHUNK_CHARS = 6000;
const DEFAULT_EXTENSIONS = new Set([".md", ".txt", ".ts", ".tsx", ".js", ".json", ".py", ".rs", ".toml", ".yaml", ".yml"]);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "target", "__pycache__", ".code-agent"]);

export interface RagChunk {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface RagIndex {
  version: 1;
  createdAt: string;
  workspaceRoot: string;
  chunks: RagChunk[];
}

export interface RagSearchResult extends RagChunk {
  score: number;
}

export async function indexWorkspace(workspaceRoot: string, input: Record<string, unknown> = {}): Promise<unknown> {
  const scopePath = typeof input["path"] === "string" ? input["path"] : ".";
  const root = resolveInWorkspace(workspaceRoot, scopePath);
  const files = await collectFiles(root);
  const chunks: RagChunk[] = [];
  for (const file of files) {
    if (isSensitivePath(file)) {
      continue;
    }
    const metadata = await stat(file);
    if (metadata.size > MAX_FILE_BYTES || !DEFAULT_EXTENSIONS.has(path.extname(file).toLowerCase())) {
      continue;
    }
    const buffer = await readFile(file);
    if (buffer.includes(0)) {
      continue;
    }
    chunks.push(...chunkFile(workspaceRoot, file, redactSensitiveText(buffer.toString("utf8"))));
  }
  const index: RagIndex = {
    version: INDEX_VERSION,
    createdAt: new Date().toISOString(),
    workspaceRoot,
    chunks
  };
  await mkdir(path.dirname(indexPath(workspaceRoot)), { recursive: true });
  await writeFile(indexPath(workspaceRoot), JSON.stringify(index, null, 2), "utf8");
  return {
    kind: "rag_index",
    path: indexPath(workspaceRoot),
    files: files.length,
    chunks: chunks.length
  };
}

export async function searchRag(workspaceRoot: string, query: string, limit = 6): Promise<RagSearchResult[]> {
  if (!existsSync(indexPath(workspaceRoot))) {
    return [];
  }
  const index = JSON.parse(await readFile(indexPath(workspaceRoot), "utf8")) as RagIndex;
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return [];
  }
  return index.chunks
    .map((chunk) => ({ ...chunk, score: scoreChunk(chunk, queryTokens) }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
}

export async function searchRagTool(workspaceRoot: string, input: Record<string, unknown>): Promise<unknown> {
  const query = requireString(input, "query");
  const limit = typeof input["limit"] === "number" ? Math.max(1, Math.min(20, Math.floor(input["limit"]))) : 6;
  return {
    kind: "rag_search",
    query,
    matches: await searchRag(workspaceRoot, query, limit)
  };
}

export function buildRagContext(matches: RagSearchResult[]): string {
  if (matches.length === 0) {
    return "";
  }
  return [
    "Relevant project RAG snippets:",
    ...matches.map((match) => [
      `- ${match.path}:${match.startLine}-${match.endLine} score=${match.score}`,
      indent(shorten(match.text, 1200))
    ].join("\n"))
  ].join("\n");
}

function chunkFile(workspaceRoot: string, file: string, text: string): RagChunk[] {
  const lines = text.split(/\r?\n/);
  const chunks: RagChunk[] = [];
  for (let offset = 0; offset < lines.length; offset += CHUNK_LINES) {
    const selected = lines.slice(offset, offset + CHUNK_LINES);
    let chunkText = selected.join("\n");
    if (chunkText.length > MAX_CHUNK_CHARS) {
      chunkText = chunkText.slice(0, MAX_CHUNK_CHARS);
    }
    chunks.push({
      id: `${normalizeSlashes(path.relative(workspaceRoot, file))}:${offset + 1}`,
      path: normalizeSlashes(path.relative(workspaceRoot, file)),
      startLine: offset + 1,
      endLine: Math.min(lines.length, offset + selected.length),
      text: chunkText
    });
  }
  return chunks;
}

async function collectFiles(root: string): Promise<string[]> {
  const metadata = await stat(root);
  if (metadata.isFile()) {
    return isSensitivePath(root) ? [] : [root];
  }
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          stack.push(path.join(current, entry.name));
        }
      } else if (entry.isFile()) {
        const filePath = path.join(current, entry.name);
        if (!isSensitivePath(filePath)) {
          files.push(filePath);
        }
      }
    }
  }
  return files;
}

function scoreChunk(chunk: RagChunk, queryTokens: string[]): number {
  const chunkTokens = tokenize(`${chunk.path} ${chunk.text}`);
  const set = new Set(chunkTokens);
  return queryTokens.reduce((score, token) => score + (set.has(token) ? 3 : chunkTokens.some((item) => item.includes(token)) ? 1 : 0), 0);
}

function resolveInWorkspace(workspaceRoot: string, value: string): string {
  const decision = WorkspacePathScope.fromRoot(workspaceRoot).validatePath(value, workspaceRoot);
  if (!decision.allowed) {
    throw new Error(decision.reason);
  }
  return decision.resolved ?? path.resolve(workspaceRoot, value);
}

function indexPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".code-agent", "rag", "index.json");
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`invalid_tool_input: '${key}' must be a non-empty string`);
  }
  return value.trim();
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function indent(value: string): string {
  return value.split(/\r?\n/).map((line) => `  ${line}`).join("\n");
}

function shorten(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}
