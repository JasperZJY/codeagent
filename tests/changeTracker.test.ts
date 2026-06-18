import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChangeTracker } from "../src/core/changeTracker.js";
import { executeTool } from "../src/tools/registry.js";

test("checkpoint revert restores only agent-modified existing files", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-revert-existing-"));
  await writeFile(path.join(workspace, "note.txt"), "user baseline\n", "utf8");
  const tracker = new ChangeTracker(workspace);
  const checkpoint = await tracker.createCheckpoint({ reason: "test" });

  const write = await executeTool(
    "write_file",
    { path: "note.txt", content: "agent edit\n" },
    { permissionMode: "workspace-write", workspaceRoot: workspace, checkpointId: checkpoint.id }
  );
  assert.equal(write.ok, true);

  const summary = await tracker.summarizeLatest();
  assert.equal(summary.checkpointId, checkpoint.id);
  assert.deepEqual(summary.files.map((file) => [file.path, file.status]), [["note.txt", "modified"]]);

  const reverted = await tracker.revertLatest();
  assert.deepEqual(reverted.reverted, ["note.txt"]);
  assert.equal(await readFile(path.join(workspace, "note.txt"), "utf8"), "user baseline\n");
});

test("checkpoint revert deletes agent-created files", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-revert-created-"));
  const tracker = new ChangeTracker(workspace);
  const checkpoint = await tracker.createCheckpoint({ reason: "test" });

  const write = await executeTool(
    "write_file",
    { path: "created.txt", content: "new file\n" },
    { permissionMode: "workspace-write", workspaceRoot: workspace, checkpointId: checkpoint.id }
  );
  assert.equal(write.ok, true);

  const reverted = await tracker.revertLatest();
  assert.deepEqual(reverted.reverted, ["created.txt"]);
  await assert.rejects(() => readFile(path.join(workspace, "created.txt"), "utf8"));
});

test("checkpoint revert skips files changed after agent write", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-revert-skip-"));
  await writeFile(path.join(workspace, "note.txt"), "before\n", "utf8");
  const tracker = new ChangeTracker(workspace);
  const checkpoint = await tracker.createCheckpoint({ reason: "test" });

  const write = await executeTool(
    "write_file",
    { path: "note.txt", content: "agent\n" },
    { permissionMode: "workspace-write", workspaceRoot: workspace, checkpointId: checkpoint.id }
  );
  assert.equal(write.ok, true);
  await writeFile(path.join(workspace, "note.txt"), "user after agent\n", "utf8");

  const reverted = await tracker.revertLatest();
  assert.deepEqual(reverted.reverted, []);
  assert.equal(reverted.skipped[0]?.reason, "file changed after agent write; keeping user changes");
  assert.equal(await readFile(path.join(workspace, "note.txt"), "utf8"), "user after agent\n");
});

test("registry changes and revert tools use latest checkpoint", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-revert-tool-"));
  const checkpoint = await executeTool(
    "checkpoint_create",
    { reason: "test" },
    { permissionMode: "workspace-write", workspaceRoot: workspace }
  );
  assert.equal(checkpoint.ok, true);
  const checkpointId = (checkpoint.output as { checkpointId?: string }).checkpointId;
  assert.ok(checkpointId);

  const write = await executeTool(
    "write_file",
    { path: "tool.txt", content: "tool\n" },
    { permissionMode: "workspace-write", workspaceRoot: workspace, checkpointId }
  );
  assert.equal(write.ok, true);

  const changes = await executeTool(
    "changes_summary",
    {},
    { permissionMode: "read-only", workspaceRoot: workspace }
  );
  assert.equal(changes.ok, true);
  assert.match(JSON.stringify(changes.output), /tool\.txt/);

  const reverted = await executeTool(
    "revert_changes",
    {},
    { permissionMode: "workspace-write", workspaceRoot: workspace }
  );
  assert.equal(reverted.ok, true);
  assert.match(JSON.stringify(reverted.output), /tool\.txt/);
});
