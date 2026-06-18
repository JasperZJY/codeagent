import {
  analyzePythonResult,
  analyzePythonRisk,
  cleanPythonTemp,
  readLastPythonResult,
  runPythonCode,
  runPythonFile,
  writeAndRunPython
} from "../core/pythonRunner.js";

export async function pythonExecTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const code = requireString(input, "code");
  return await runPythonCode(workspaceRoot, code, timeoutOptions(input));
}

export async function pythonRunFileTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const file = requireString(input, "path");
  return await runPythonFile(workspaceRoot, file, timeoutOptions(input));
}

export async function pythonWriteAndRunTool(input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const code = requireString(input, "code");
  const targetPath = typeof input["path"] === "string" && input["path"].trim() ? input["path"] : undefined;
  return await writeAndRunPython(
    workspaceRoot,
    { code, ...(targetPath ? { path: targetPath } : {}) },
    timeoutOptions(input)
  );
}

export async function pythonAnalyzeResultTool(input: Record<string, unknown>): Promise<unknown> {
  return analyzePythonResult({
    exitCode: optionalNumber(input, "exitCode") ?? 0,
    durationMs: optionalNumber(input, "durationMs") ?? 0,
    stdout: typeof input["stdout"] === "string" ? input["stdout"] : "",
    stderr: typeof input["stderr"] === "string" ? input["stderr"] : "",
    ...(typeof input["scriptPath"] === "string" ? { scriptPath: input["scriptPath"] } : {})
  });
}

export async function pythonLastResultTool(_input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  const result = await readLastPythonResult(workspaceRoot);
  return result ?? { ok: false, message: "No Python execution result recorded yet." };
}

export async function pythonCleanTool(_input: Record<string, unknown>, workspaceRoot: string): Promise<unknown> {
  return await cleanPythonTemp(workspaceRoot);
}

export async function pythonRiskTool(input: Record<string, unknown>): Promise<unknown> {
  return analyzePythonRisk(requireString(input, "code"));
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
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

function timeoutOptions(input: Record<string, unknown>): { timeoutMs?: number } {
  const timeoutMs = optionalNumber(input, "timeoutMs");
  return timeoutMs === undefined ? {} : { timeoutMs };
}
