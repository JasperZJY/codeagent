import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultToolRegistry, executeTool, toolCatalog } from "../src/tools/registry.js";

test("default registry exposes every catalog tool with harness metadata", () => {
  assert.ok(toolCatalog.length > 20);
  for (const tool of toolCatalog) {
    assert.ok(tool.permission);
    assert.ok(tool.risk);
    assert.ok(defaultToolRegistry.getTool(tool.name)?.handler);
  }
});

test("compatible executeTool still uses the registry pipeline", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-registry-"));
  const result = await executeTool(
    "structured_output",
    { hello: "world" },
    { permissionMode: "read-only", workspaceRoot: workspace }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.output, { ok: true, data: { hello: "world" } });
});

test("file operation tools are registered and execute through compatible pipeline", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-file-tools-"));
  await writeFile(path.join(workspace, "source.txt"), "hello", "utf8");

  const exists = await executeTool(
    "file_exists",
    { path: "source.txt" },
    { permissionMode: "workspace-write", workspaceRoot: workspace }
  );
  assert.equal(exists.ok, true);
  assert.equal((exists.output as { exists?: boolean }).exists, true);

  const moved = await executeTool(
    "move_file",
    { path: "source.txt", newPath: "nested/renamed.txt" },
    { permissionMode: "workspace-write", workspaceRoot: workspace }
  );
  assert.equal(moved.ok, true);
  assert.equal(await readFile(path.join(workspace, "nested", "renamed.txt"), "utf8"), "hello");

  const deleted = await executeTool(
    "delete_file",
    { path: "nested/renamed.txt" },
    { permissionMode: "workspace-write", workspaceRoot: workspace }
  );
  assert.equal(deleted.ok, true);
  await assert.rejects(() => access(path.join(workspace, "nested", "renamed.txt"), constants.F_OK));
});
