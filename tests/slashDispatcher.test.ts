import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dispatchSlashCommand } from "../src/cli/slashDispatcher.js";
import { parseSlashCommand } from "../src/cli/slash.js";
import { TranscriptBuffer } from "../src/cli/transcript.js";
import { AgentRuntime } from "../src/core/runtime.js";
import type { RuntimeConfig } from "../src/core/types.js";

test("dispatcher returns clear fallback for empty and unknown slash commands", async () => {
  const context = await slashContext();
  const empty = await dispatchSlashCommand(requiredSlash("/"), context);
  assert.match(empty.output ?? "", /No slash command entered/);

  const unknown = await dispatchSlashCommand(requiredSlash("/does-not-exist"), context);
  assert.match(unknown.output ?? "", /Unknown command: \/does-not-exist/);
});

test("/resume without selector shows available sessions", async () => {
  const context = await slashContext();
  await context.runtime.runTurn("hello", 5);

  const result = await dispatchSlashCommand(requiredSlash("/resume"), context);
  assert.match(result.output ?? "", /Available sessions/);
  assert.match(result.output ?? "", /Use:/);
});

test("/resume accepts a unique session id prefix", async () => {
  const context = await slashContext();
  const turn = await context.runtime.runTurn("hello", 5);
  const prefix = turn.sessionId.slice(0, 8);

  const result = await dispatchSlashCommand(requiredSlash(`/resume ${prefix}`), context);
  assert.match(result.output ?? "", /Session resumed:/);
  assert.equal(result.config.sessionId, turn.sessionId);
});

test("/permissions accepts bracketed menu placeholder values", async () => {
  const context = await slashContext();
  const result = await dispatchSlashCommand(requiredSlash("/permission [danger-full-access]"), context);
  assert.match(result.output ?? "", /Permissions set to danger-full-access/);
  assert.equal(result.config.permissionMode, "danger-full-access");
});

test("/revert reports no tracked changes instead of appearing silent", async () => {
  const context = await slashContext();
  const result = await dispatchSlashCommand(requiredSlash("/revert"), context);
  assert.match(result.output ?? "", /No agent-tracked changes to revert/);
});

test("/revert restores agent file edits through the tool pipeline", async () => {
  const context = await slashContext();
  const target = path.join(context.config.workspaceRoot, "note.txt");
  await writeFile(target, "before\n", "utf8");

  await context.runtime.execTool("write_file", { path: "note.txt", content: "after\n" });
  assert.equal(await readFile(target, "utf8"), "after\n");

  const result = await dispatchSlashCommand(requiredSlash("/revert"), context);
  assert.match(result.output ?? "", /Reverted agent changes|reverted note\.txt/);
  assert.equal(await readFile(target, "utf8"), "before\n");
});

async function slashContext() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-slash-dispatcher-"));
  const config: RuntimeConfig = {
    workspaceRoot: workspace,
    provider: "openai-compatible",
    model: "qwen3:8b",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    permissionMode: "workspace-write",
    outputFormat: "json",
    maxTurns: 4,
    maxBudgetTokens: 2000,
    useLlm: false
  };
  return {
    config,
    runtime: new AgentRuntime(config),
    transcripts: new TranscriptBuffer(),
    runtimeOptions: {}
  };
}

function requiredSlash(input: string) {
  const parsed = parseSlashCommand(input);
  assert.ok(parsed);
  return parsed;
}
