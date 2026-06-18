import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspacePathScope } from "../core/pathScope.js";
import { isSensitivePath } from "../core/security.js";

const MAX_READ_BYTES = 1024 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;
const MAX_GREP_LINES = 200;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "__pycache__", "target", ".code-agent"]);

export async function readFileTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const filePath = requireString(input, "path");
  if (isSensitivePath(filePath)) {
    throw new Error(`sensitive_path_blocked: ${filePath}`);
  }
  const offset = optionalNumber(input, "offset") ?? 0;
  const limit = optionalNumber(input, "limit");
  const absolute = resolveInWorkspace(workspaceRoot, filePath);
  const metadata = await stat(absolute);
  if (metadata.size > MAX_READ_BYTES) {
    throw new Error(`file too large: ${metadata.size} bytes exceeds ${MAX_READ_BYTES}`);
  }
  const buffer = await readFile(absolute);
  if (buffer.includes(0)) {
    throw new Error("file appears to be binary");
  }
  const lines = buffer.toString("utf8").split(/\r?\n/);
  const selected = lines.slice(offset, limit === undefined ? undefined : offset + limit);
  return {
    kind: "text",
    path: absolute,
    startLine: offset + 1,
    numLines: selected.length,
    totalLines: lines.length,
    content: selected.join("\n")
  };
}

export async function writeFileTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const filePath = requireString(input, "path");
  const content = requireString(input, "content");
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) {
    throw new Error(`content too large: exceeds ${MAX_WRITE_BYTES} bytes`);
  }
  const absolute = resolveInWorkspace(workspaceRoot, filePath);
  const existed = await exists(absolute);
  await mkdir(path.dirname(absolute), { recursive: true });
  const original = existed ? await readFile(absolute, "utf8") : "";
  await writeFile(absolute, content, "utf8");
  return {
    kind: existed ? "update" : "create",
    path: absolute,
    bytes: Buffer.byteLength(content, "utf8"),
    diff: makeLineDiff(original, content)
  };
}

export async function editFileTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const filePath = requireString(input, "path");
  const oldString = requireString(input, "oldString");
  const newString = requireString(input, "newString");
  const replaceAll = Boolean(input["replaceAll"]);
  if (oldString === newString) {
    throw new Error("oldString and newString must differ");
  }
  const absolute = resolveInWorkspace(workspaceRoot, filePath);
  const original = await readFile(absolute, "utf8");
  if (!original.includes(oldString)) {
    throw new Error("oldString not found in file");
  }
  const updated = replaceAll
    ? original.split(oldString).join(newString)
    : original.replace(oldString, newString);
  await writeFile(absolute, updated, "utf8");
  return {
    kind: "edit",
    path: absolute,
    replaceAll,
    diff: makeLineDiff(original, updated)
  };
}

export async function listDirTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const dirPath = typeof input["path"] === "string" ? input["path"] : ".";
  const absolute = resolveInWorkspace(workspaceRoot, dirPath);
  const entries = await readdir(absolute, { withFileTypes: true });
  return {
    path: absolute,
    entries: entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other"
      }))
  };
}

export async function globSearchTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const pattern = requireString(input, "pattern");
  const root = resolveInWorkspace(workspaceRoot, typeof input["path"] === "string" ? input["path"] : ".");
  const matcher = globToRegExp(pattern);
  const files = await collectFiles(root);
  const rootNormalized = normalizeSlashes(root);
  const matches = files
    .filter((file) => {
      const relative = normalizeSlashes(path.relative(root, file));
      const absolute = normalizeSlashes(file);
      return matcher.test(relative) || matcher.test(absolute) || matcher.test(absolute.replace(rootNormalized + "/", ""));
    })
    .slice(0, 200);
  return {
    pattern,
    root,
    numFiles: matches.length,
    files: matches
  };
}

export async function grepSearchTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const pattern = requireString(input, "pattern");
  const root = resolveInWorkspace(workspaceRoot, typeof input["path"] === "string" ? input["path"] : ".");
  const glob = typeof input["glob"] === "string" ? globToRegExp(input["glob"]) : undefined;
  const flags = input["caseInsensitive"] === true ? "i" : "";
  const regex = new RegExp(pattern, flags);
  const files = await collectFiles(root);
  const lines: string[] = [];
  let numMatches = 0;
  for (const file of files) {
    const relative = normalizeSlashes(path.relative(root, file));
    if (glob && !glob.test(relative)) {
      continue;
    }
    const metadata = await stat(file);
    if (metadata.size > MAX_READ_BYTES) {
      continue;
    }
    const buffer = await readFile(file);
    if (buffer.includes(0)) {
      continue;
    }
    const contentLines = buffer.toString("utf8").split(/\r?\n/);
    for (let index = 0; index < contentLines.length; index += 1) {
      const line = contentLines[index] ?? "";
      if (regex.test(line)) {
        numMatches += 1;
        if (lines.length < MAX_GREP_LINES) {
          lines.push(`${relative}:${index + 1}:${line}`);
        }
      }
    }
  }
  return {
    pattern,
    root,
    numMatches,
    numLines: lines.length,
    truncated: numMatches > lines.length,
    content: lines.join("\n")
  };
}

export async function shellTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const command = requireString(input, "command");
  const timeoutMs = optionalNumber(input, "timeoutMs") ?? 30000;
  const shell = os.platform() === "win32" ? "powershell.exe" : "/bin/sh";
  const args = os.platform() === "win32"
    ? ["-NoProfile", "-NonInteractive", "-Command", command]
    : ["-lc", command];

  return await new Promise((resolve, reject) => {
    const child = spawn(shell, args, { cwd: workspaceRoot, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`shell command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout,
        stderr
      });
    });
  });
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`invalid_tool_input: '${key}' must be a non-empty string`);
  }
  return value;
}

function optionalNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid_tool_input: '${key}' must be a non-negative number`);
  }
  return value;
}

function resolveInWorkspace(workspaceRoot: string, value: string): string {
  const decision = WorkspacePathScope.fromRoot(workspaceRoot).validatePath(value, workspaceRoot);
  if (!decision.allowed) {
    throw new Error(decision.reason);
  }
  return decision.resolved ?? path.resolve(workspaceRoot, value);
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

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizeSlashes(pattern);
  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += ".";
    } else {
      source += escapeRegExp(char ?? "");
    }
  }
  return new RegExp(`^${source}$`);
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function exists(value: string): Promise<boolean> {
  try {
    await access(value, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function makeLineDiff(before: string, after: string): string {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const lines: string[] = [];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < max; index += 1) {
    const oldLine = beforeLines[index];
    const newLine = afterLines[index];
    if (oldLine === newLine) {
      continue;
    }
    if (oldLine !== undefined) {
      lines.push(`-${oldLine}`);
    }
    if (newLine !== undefined) {
      lines.push(`+${newLine}`);
    }
    if (lines.length >= 80) {
      lines.push("...[diff truncated]");
      break;
    }
  }
  return lines.join("\n");
}
