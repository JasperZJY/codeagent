import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspacePathScope } from "./pathScope.js";
import { isSensitivePath, redactSensitiveText } from "./security.js";

export interface PythonRiskReport {
  level: "safe" | "warning" | "blocked";
  blocked: boolean;
  reasons: string[];
}

export interface PythonExecutionResult {
  ok: boolean;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  summary: string;
  artifacts: string[];
  scriptPath?: string;
  errorType?: string;
  file?: string;
  line?: number;
  risk?: PythonRiskReport;
}

export interface PythonRunOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_CODE_BYTES = 1024 * 1024;
const SENSITIVE_CODE_RE = /(\.env|id_rsa|id_ed25519|known_hosts|cookies?\.sqlite|login data|credential|token|secret|password)/i;
const NETWORK_CODE_RE = /\b(import\s+(requests|urllib|socket|http\.client)|from\s+(requests|urllib|socket|http\.client)\s+import|requests\.|urllib\.|socket\.|http\.client)/i;
const SUBPROCESS_CODE_RE = /\b(import\s+subprocess|from\s+subprocess\s+import|subprocess\.|os\.system\s*\(|os\.popen\s*\()/i;

export function analyzePythonRisk(code: string): PythonRiskReport {
  const reasons: string[] = [];
  if (SENSITIVE_CODE_RE.test(code)) {
    reasons.push("sensitive file or credential reference");
  }
  if (NETWORK_CODE_RE.test(code)) {
    reasons.push("network-capable Python module or call");
  }
  if (SUBPROCESS_CODE_RE.test(code)) {
    reasons.push("subprocess or shell execution from Python");
  }
  if (/\bwhile\s+True\s*:/.test(code) && !/\bbreak\b/.test(code)) {
    reasons.push("possible unbounded loop");
  }
  const blocked = reasons.length > 0;
  return {
    level: blocked ? "blocked" : "safe",
    blocked,
    reasons: reasons.length ? reasons : ["no obvious risk"]
  };
}

export async function runPythonCode(
  workspaceRoot: string,
  code: string,
  options: PythonRunOptions = {}
): Promise<PythonExecutionResult> {
  return await writeAndRunPython(workspaceRoot, { code }, options);
}

export async function writeAndRunPython(
  workspaceRoot: string,
  input: { code: string; path?: string },
  options: PythonRunOptions = {}
): Promise<PythonExecutionResult> {
  ensureCodeSize(input.code);
  const risk = analyzePythonRisk(input.code);
  const scriptPath = resolvePythonScriptPath(workspaceRoot, input.path);
  if (risk.blocked) {
    return blockedResult(scriptPath, risk);
  }

  await mkdir(path.dirname(scriptPath), { recursive: true });
  await writeFile(scriptPath, input.code, "utf8");
  const result = await runPythonFile(workspaceRoot, scriptPath, options);
  return {
    ...result,
    scriptPath,
    artifacts: unique([scriptPath, ...result.artifacts])
  };
}

export async function runPythonFile(
  workspaceRoot: string,
  filePath: string,
  options: PythonRunOptions = {}
): Promise<PythonExecutionResult> {
  const absolute = resolveInWorkspace(workspaceRoot, filePath);
  if (isSensitivePath(absolute)) {
    return blockedResult(absolute, {
      level: "blocked",
      blocked: true,
      reasons: ["sensitive Python file path"]
    });
  }
  if (path.extname(absolute).toLowerCase() !== ".py") {
    throw new Error("invalid_python_file: expected a .py file");
  }
  const metadata = await stat(absolute);
  if (!metadata.isFile()) {
    throw new Error(`invalid_python_file: ${filePath} is not a file`);
  }
  const code = await readFile(absolute, "utf8");
  const risk = analyzePythonRisk(code);
  if (risk.blocked) {
    return blockedResult(absolute, risk);
  }
  const startedAt = Date.now();
  const result = await spawnPython(absolute, workspaceRoot, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const analyzed = analyzePythonResult({
    ...result,
    durationMs: Date.now() - startedAt,
    scriptPath: absolute
  });
  await saveLastPythonResult(workspaceRoot, analyzed);
  return analyzed;
}

export function analyzePythonResult(input: {
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  scriptPath?: string;
}): PythonExecutionResult {
  const stdout = redactSensitiveText(input.stdout);
  const stderr = redactSensitiveText(input.stderr);
  const parsed = parsePythonError(stderr);
  const ok = input.exitCode === 0;
  const stdoutLines = countLines(stdout);
  const stderrLines = countLines(stderr);
  const summary = ok
    ? `Python completed successfully with ${stdoutLines} stdout line${stdoutLines === 1 ? "" : "s"}.`
    : parsed.errorType
      ? `${parsed.errorType}${parsed.line ? ` at line ${parsed.line}` : ""}: ${parsed.message}`
      : `Python failed with exit code ${input.exitCode}.`;
  return {
    ok,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    stdout,
    stderr,
    summary: stderrLines > 0 && ok ? `${summary} stderr had ${stderrLines} line${stderrLines === 1 ? "" : "s"}.` : summary,
    artifacts: input.scriptPath ? [input.scriptPath] : [],
    ...(input.scriptPath ? { scriptPath: input.scriptPath } : {}),
    ...(parsed.errorType ? { errorType: parsed.errorType } : {}),
    ...(parsed.file ? { file: parsed.file } : {}),
    ...(parsed.line ? { line: parsed.line } : {})
  };
}

export async function readLastPythonResult(workspaceRoot: string): Promise<PythonExecutionResult | undefined> {
  try {
    return JSON.parse(await readFile(lastResultPath(workspaceRoot), "utf8")) as PythonExecutionResult;
  } catch {
    return undefined;
  }
}

export async function cleanPythonTemp(workspaceRoot: string): Promise<{ path: string; removed: number }> {
  const dir = tmpDir(workspaceRoot);
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!/(\.py|\.json|\.txt)$/i.test(entry.name)) {
      continue;
    }
    await rm(path.join(dir, entry.name), { force: true });
    removed += 1;
  }
  return { path: dir, removed };
}

function resolvePythonScriptPath(workspaceRoot: string, requestedPath?: string): string {
  const relative = requestedPath?.trim() || path.join(".code-agent", "tmp", `python-${Date.now()}-${randomUUID().slice(0, 8)}.py`);
  const absolute = resolveInWorkspace(workspaceRoot, relative);
  if (isSensitivePath(absolute)) {
    throw new Error(`sensitive_path_blocked: ${relative}`);
  }
  if (path.extname(absolute).toLowerCase() !== ".py") {
    throw new Error("invalid_python_file: expected a .py path");
  }
  return absolute;
}

function resolveInWorkspace(workspaceRoot: string, value: string): string {
  const decision = WorkspacePathScope.fromRoot(workspaceRoot).validatePath(value, workspaceRoot);
  if (!decision.allowed) {
    throw new Error(decision.reason);
  }
  return decision.resolved ?? path.resolve(workspaceRoot, value);
}

function ensureCodeSize(code: string): void {
  if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) {
    throw new Error(`python_code_too_large: exceeds ${MAX_CODE_BYTES} bytes`);
  }
}

async function spawnPython(
  scriptPath: string,
  cwd: string,
  timeoutMs: number
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const command = process.env["PYTHON"] ?? (os.platform() === "win32" ? "python" : "python3");
  return await new Promise((resolve) => {
    const child = spawn(command, [scriptPath], { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, stdout, stderr: `${stderr}${stderr ? "\n" : ""}${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? -1 : code ?? 0,
        stdout,
        stderr: timedOut ? `${stderr}${stderr ? "\n" : ""}Python execution timed out after ${timeoutMs}ms` : stderr
      });
    });
  });
}

function parsePythonError(stderr: string): { errorType?: string; message?: string; file?: string; line?: number } {
  const fileLine = [...stderr.matchAll(/File "([^"]+)", line (\d+)/g)].at(-1);
  const lastError = stderr.trim().split(/\r?\n/).reverse().find((line) => /^[A-Za-z_][\w.]*(Error|Exception|Interrupt|Timeout)?\s*:/.test(line.trim()));
  if (!lastError) {
    return {};
  }
  const match = lastError.trim().match(/^([A-Za-z_][\w.]*):\s*(.*)$/);
  if (!match) {
    return {};
  }
  const errorType = match[1];
  if (!errorType) {
    return {};
  }
  return {
    errorType,
    message: match[2] ?? "",
    ...(fileLine?.[1] ? { file: fileLine[1] } : {}),
    ...(fileLine?.[2] ? { line: Number(fileLine[2]) } : {})
  };
}

function blockedResult(scriptPath: string, risk: PythonRiskReport): PythonExecutionResult {
  const summary = `Python execution blocked: ${risk.reasons.join("; ")}`;
  return {
    ok: false,
    exitCode: -1,
    durationMs: 0,
    stdout: "",
    stderr: summary,
    summary,
    artifacts: [],
    scriptPath,
    errorType: "SecurityError",
    risk
  };
}

async function saveLastPythonResult(workspaceRoot: string, result: PythonExecutionResult): Promise<void> {
  const file = lastResultPath(workspaceRoot);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(result, null, 2), "utf8");
}

function lastResultPath(workspaceRoot: string): string {
  return path.join(tmpDir(workspaceRoot), "last-python-result.json");
}

function tmpDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".code-agent", "tmp");
}

function countLines(value: string): number {
  if (!value) {
    return 0;
  }
  return value.split(/\r?\n/).filter((line) => line.length > 0).length;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
