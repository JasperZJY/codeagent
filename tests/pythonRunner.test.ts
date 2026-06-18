import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzePythonRisk } from "../src/core/pythonRunner.js";
import { executeTool } from "../src/tools/registry.js";

test("python_exec runs a short snippet and stores structured output", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-python-"));
  const result = await executeTool(
    "python_exec",
    { code: "print('hello from python')" },
    { permissionMode: "workspace-write", workspaceRoot: workspace }
  );
  assert.equal(result.ok, true);
  const output = result.output as { ok: boolean; stdout: string; scriptPath: string };
  assert.equal(output.ok, true);
  assert.match(output.stdout, /hello from python/);
  assert.match(output.scriptPath, /\.code-agent[\\/]+tmp[\\/]+python-/);

  const last = await executeTool("python_last_result", {}, { permissionMode: "workspace-write", workspaceRoot: workspace });
  assert.equal((last.output as { ok: boolean }).ok, true);
});

test("python_run_file extracts syntax errors without crashing the tool", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-python-error-"));
  await writeFile(path.join(workspace, "bad.py"), "def nope(:\n    pass\n", "utf8");

  const result = await executeTool(
    "python_run_file",
    { path: "bad.py" },
    { permissionMode: "workspace-write", workspaceRoot: workspace }
  );
  assert.equal(result.ok, true);
  const output = result.output as { ok: boolean; errorType?: string; line?: number; summary: string };
  assert.equal(output.ok, false);
  assert.equal(output.errorType, "SyntaxError");
  assert.equal(output.line, 1);
  assert.match(output.summary, /SyntaxError/);
});

test("python risk blocks sensitive paths and network/subprocess code", async () => {
  const risk = analyzePythonRisk("import requests\nprint(requests.get('https://example.com').text)");
  assert.equal(risk.blocked, true);
  assert.match(risk.reasons.join("\n"), /network/);

  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-python-risk-"));
  const result = await executeTool(
    "python_exec",
    { code: "open('.env').read()" },
    { permissionMode: "workspace-write", workspaceRoot: workspace }
  );
  const output = result.output as { ok: boolean; errorType?: string; summary: string };
  assert.equal(output.ok, false);
  assert.equal(output.errorType, "SecurityError");
  assert.match(output.summary, /blocked/);
});

test("python_clean_tmp removes temporary scripts", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-python-clean-"));
  await executeTool(
    "python_exec",
    { code: "print(1)" },
    { permissionMode: "workspace-write", workspaceRoot: workspace }
  );
  const result = await executeTool("python_clean_tmp", {}, { permissionMode: "workspace-write", workspaceRoot: workspace });
  assert.equal(result.ok, true);
  assert.equal((result.output as { removed: number }).removed >= 1, true);
});
