import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChangeTracker } from "../src/core/changeTracker.js";
import { buildResumeState } from "../src/core/resumeState.js";
import { appendMessage, SessionStore } from "../src/core/session.js";
import { TaskStore } from "../src/core/tasks.js";

test("/resume state restores plan, changed files, commands, and validation status", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-resume-"));
  const store = new SessionStore(workspace);
  const session = await store.loadOrCreate(undefined, "qwen3:8b");
  appendMessage(session, { role: "user", blocks: [{ type: "text", text: "implement feature and run tests" }] });
  appendMessage(session, {
    role: "assistant",
    blocks: [{ type: "tool_use", id: "shell-1", name: "shell", input: { command: "npm test" } }]
  });
  appendMessage(session, {
    role: "tool",
    blocks: [{
      type: "tool_result",
      toolUseId: "shell-1",
      toolName: "shell",
      output: { code: 0, stdout: "ok", stderr: "" },
      isError: false
    }]
  });
  await store.save(session);

  await new TaskStore(workspace).createPlan("implement feature and run tests", session.sessionId);

  const tracker = new ChangeTracker(workspace);
  const checkpoint = await tracker.createCheckpoint({ reason: "test", sessionId: session.sessionId });
  const snapshot = await tracker.snapshotBeforeMutation(checkpoint.id, "src/feature.ts", "write_file");
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await writeFile(path.join(workspace, "src", "feature.ts"), "export const value = 1;\n", "utf8");
  await tracker.recordAfterMutation(snapshot);

  const state = await buildResumeState(workspace, session);

  assert.equal(state.sessionId, session.sessionId);
  assert.equal(state.taskPlan?.prompt, "implement feature and run tests");
  assert.equal(state.changedFiles.some((file) => file.path === "src/feature.ts" && file.status === "created"), true);
  assert.deepEqual(state.executedCommands, ["npm test"]);
  assert.equal(state.validationStatus, "passed");
  assert.equal(state.nextSteps.length > 0, true);
});
