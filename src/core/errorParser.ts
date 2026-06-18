import path from "node:path";
import type { ParsedError } from "./types.js";

export function parseErrorLog(output: string, command = ""): ParsedError[] {
  const lines = output.split(/\r?\n/);
  const errors: ParsedError[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const ts = parseTypeScriptLine(line);
    if (ts) {
      errors.push(ts);
      continue;
    }
    const node = parseNodeTestLine(line);
    if (node) {
      errors.push(node);
      continue;
    }
    const pythonFile = parsePythonFileLine(line, lines[index + 1]);
    if (pythonFile) {
      errors.push(pythonFile);
      continue;
    }
    const pytest = parsePytestLine(line);
    if (pytest) {
      errors.push(pytest);
      continue;
    }
    if (looksLikeGenericFailure(line)) {
      errors.push({
        type: inferGenericType(line, command),
        message: compact(line),
        raw: line.trim()
      });
    }
  }
  return dedupeErrors(errors).slice(0, 20);
}

export function formatParsedErrors(errors: ParsedError[]): string {
  if (errors.length === 0) {
    return "No structured errors parsed.";
  }
  return errors.map((error) => {
    const location = error.file
      ? `${error.file}${error.line ? `:${error.line}` : ""}${error.column ? `:${error.column}` : ""}`
      : "unknown";
    return `${location} ${error.type}: ${error.message}`;
  }).join("\n");
}

function parseTypeScriptLine(line: string): ParsedError | undefined {
  const paren = line.match(/^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/);
  if (paren) {
    return {
      file: normalizeRequiredPath(paren[1]),
      line: Number(paren[2]),
      column: Number(paren[3]),
      type: paren[4] ?? "typescript",
      message: paren[5] ?? "",
      raw: line.trim()
    };
  }
  const dash = line.match(/^(.+?):(\d+):(\d+)\s+-\s+error\s+(TS\d+):\s+(.+)$/);
  if (dash) {
    return {
      file: normalizeRequiredPath(dash[1]),
      line: Number(dash[2]),
      column: Number(dash[3]),
      type: dash[4] ?? "typescript",
      message: dash[5] ?? "",
      raw: line.trim()
    };
  }
  return undefined;
}

function parseNodeTestLine(line: string): ParsedError | undefined {
  const location = line.match(/(?:^|[\s(])(.+\.(?:test\.)?[cm]?[jt]s):(\d+):(\d+)(?:\)|\s|$)/);
  if (location && /\b(error|failed|failure|assert|expected|actual|not ok)\b/i.test(line)) {
    return {
      file: normalizeRequiredPath(location[1]),
      line: Number(location[2]),
      column: Number(location[3]),
      type: "node-test",
      message: compact(line),
      raw: line.trim()
    };
  }
  if (/^\s*(AssertionError|Error):/.test(line)) {
    return {
      type: "node-test",
      message: compact(line),
      raw: line.trim()
    };
  }
  return undefined;
}

function parsePythonFileLine(line: string, nextLine: string | undefined): ParsedError | undefined {
  const file = line.match(/^\s*File "(.+?)", line (\d+)(?:, in .*)?$/);
  if (!file) {
    return undefined;
  }
  const message = nextLine?.trim() || line.trim();
  return {
    file: normalizeRequiredPath(file[1]),
    line: Number(file[2]),
    type: /syntaxerror/i.test(message) ? "python-syntax" : "python",
    message: compact(message),
    raw: line.trim()
  };
}

function parsePytestLine(line: string): ParsedError | undefined {
  const match = line.match(/^(.+?\.py):(\d+):(?:(\d+):)?\s*(.+)$/);
  if (!match || !/\b(error|failed|assert|syntaxerror|exception|E\s+)/i.test(line)) {
    return undefined;
  }
  return {
    file: normalizeRequiredPath(match[1]),
    line: Number(match[2]),
    ...(match[3] ? { column: Number(match[3]) } : {}),
    type: "python-test",
    message: compact(match[4] ?? line),
    raw: line.trim()
  };
}

function looksLikeGenericFailure(line: string): boolean {
  return /\b(error|failed|failure|exception|traceback|warning|expected|received|assertion)\b/i.test(line);
}

function inferGenericType(line: string, command: string): string {
  if (/tsc|typescript|TS\d+/.test(line) || /tsc|typecheck/i.test(command)) {
    return "typescript";
  }
  if (/pytest|python|traceback|syntaxerror/i.test(line) || /python|pytest/i.test(command)) {
    return "python";
  }
  if (/npm|node|assert/i.test(line) || /npm|node/i.test(command)) {
    return "node-test";
  }
  return "generic";
}

function dedupeErrors(errors: ParsedError[]): ParsedError[] {
  const seen = new Set<string>();
  const unique: ParsedError[] = [];
  for (const error of errors) {
    const key = `${error.file ?? ""}:${error.line ?? ""}:${error.column ?? ""}:${error.type}:${error.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(error);
    }
  }
  return unique;
}

function normalizeRequiredPath(value: string | undefined): string {
  if (!value) {
    return "unknown";
  }
  return value.replace(/\//g, path.sep);
}

function compact(value: string, limit = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
}
