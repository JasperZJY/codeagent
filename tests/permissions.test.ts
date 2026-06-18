import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspacePathScope } from "../src/core/pathScope.js";
import { executeTool } from "../src/tools/registry.js";

test("workspace scope denies parent escape", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "code-agent-scope-"));
  const workspace = path.join(root, "workspace");
  await import("node:fs/promises").then((fs) => fs.mkdir(workspace));
  const decision = WorkspacePathScope.fromRoot(workspace).validatePayload("cat ../secret.txt");
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /outside workspace scope/);
});

test("read-only mode denies write_file", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-perm-"));
  const result = await executeTool(
    "write_file",
    { path: "out.txt", content: "hello" },
    { permissionMode: "read-only", workspaceRoot: workspace }
  );
  assert.equal(result.ok, false);
  assert.match(String(result.output), /requires workspace-write/);
});

test("workspace-write mode allows scoped write and read", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-write-"));
  const write = await executeTool(
    "write_file",
    { path: "out.txt", content: "hello" },
    { permissionMode: "workspace-write", workspaceRoot: workspace }
  );
  assert.equal(write.ok, true);
  await writeFile(path.join(workspace, "manual.txt"), "manual", "utf8");
  const read = await executeTool(
    "read_file",
    { path: "manual.txt" },
    { permissionMode: "workspace-write", workspaceRoot: workspace }
  );
  assert.equal(read.ok, true);
});

test("file tools reject paths outside workspace even after permission check", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "code-agent-tool-scope-"));
  const workspace = path.join(root, "workspace");
  await import("node:fs/promises").then((fs) => fs.mkdir(workspace));
  const result = await executeTool(
    "read_file",
    { path: "../secret.txt" },
    { permissionMode: "workspace-write", workspaceRoot: workspace }
  );
  assert.equal(result.ok, false);
  assert.match(String(result.output), /outside workspace scope/);
});
