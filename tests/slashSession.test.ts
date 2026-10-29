import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dispatchSlashCommand } from "../src/cli/slashDispatcher.js";
import { parseSlashCommand } from "../src/cli/slash.js";
import { TranscriptBuffer } from "../src/cli/transcript.js";
import { AgentRuntime } from "../src/core/runtime.js";
import { SessionStore } from "../src/core/session.js";
import type { RuntimeConfig } from "../src/core/types.js";

test("/resume without selector lists readable session titles", async () => {
  const context = await slashContext();
  await context.runtime.runTurn("修复 Slash 命令无响应", 5);

  const result = await dispatchSlashCommand(requiredSlash("/resume"), context);
  assert.match(result.output ?? "", /Available sessions/);
  assert.match(result.output ?? "", /修复|命令|响应/);
  assert.doesNotMatch(result.output ?? "", /usage: \/resume <session-id/);
});

test("/resume number switches to the listed active session", async () => {
  const context = await slashContext();
  await context.runtime.runTurn("第一个会话：修复 Slash 命令", 5);
  const secondRuntime = new AgentRuntime(context.config);
  await secondRuntime.runTurn("第二个会话：Ollama 远程模型连接排查", 5);
  const listed = await context.runtime.listSessions();
  const target = listed[0];
  assert.ok(target);

  const result = await dispatchSlashCommand(requiredSlash("/resume 1"), context);
  assert.equal(result.config.sessionId, target.sessionId);
  assert.match(result.output ?? "", /Session resumed:/);
});

test("/resume title keyword switches sessions without appending histories", async () => {
  const context = await slashContext();
  const turnA = await context.runtime.runTurn("修复 Slash 命令无响应", 5);
  const runtimeB = new AgentRuntime(context.config);
  const turnB = await runtimeB.runTurn("Ollama 远程模型连接排查", 5);
  const beforeB = await runtimeB.loadSession(turnB.sessionId);
  assert.ok(beforeB);

  const result = await dispatchSlashCommand(requiredSlash("/resume Ollama"), context);
  assert.equal(result.config.sessionId, turnB.sessionId);
  const resumed = await result.runtime.getCurrentSession();
  assert.equal(resumed.sessionId, turnB.sessionId);
  assert.equal(resumed.messages.length, beforeB.messages.length);
  assert.equal(JSON.stringify(resumed.messages).includes("/resume"), false);

  await result.runtime.runTurn("继续这个会话", 5);
  const afterA = await result.runtime.loadSession(turnA.sessionId);
  const afterB = await result.runtime.loadSession(turnB.sessionId);
  assert.ok(afterA);
  assert.ok(afterB);
  assert.equal(JSON.stringify(afterA.messages).includes("Ollama 远程模型连接排查"), false);
  assert.equal(JSON.stringify(afterB.messages).includes("/resume"), false);
  assert.equal(JSON.stringify(afterB.messages).includes("继续这个会话"), true);
});

test("/resume ambiguous title lists candidates and does not switch", async () => {
  const context = await slashContext();
  const first = await context.runtime.runTurn("修复 Slash 命令无响应", 5);
  const secondRuntime = new AgentRuntime(context.config);
  await secondRuntime.runTurn("修复 Slash 菜单过滤", 5);

  const result = await dispatchSlashCommand(requiredSlash("/resume 修复"), context);
  assert.match(result.output ?? "", /Multiple sessions matched/);
  assert.equal(result.config.sessionId, context.config.sessionId);
  const active = await context.runtime.getCurrentSession();
  assert.equal(active.sessionId, first.sessionId);
});

test("/resume session id still works", async () => {
  const context = await slashContext();
  const turn = await context.runtime.runTurn("测试 Agent Harness 功能", 5);

  const result = await dispatchSlashCommand(requiredSlash(`/resume ${turn.sessionId}`), context);
  assert.equal(result.config.sessionId, turn.sessionId);
  assert.match(result.output ?? "", /Session resumed:/);
});

test("/session shows title and supports rename", async () => {
  const context = await slashContext();
  await context.runtime.runTurn("查看 Linux 显存占用", 5);

  const renamed = await dispatchSlashCommand(requiredSlash("/session rename 显存排查"), context);
  assert.match(renamed.output ?? "", /显存排查/);

  const shown = await dispatchSlashCommand(requiredSlash("/session"), context);
  assert.match(shown.output ?? "", /Title\s+显存排查/);
  assert.match(shown.output ?? "", /Summary/);
});

test("/resume rejects cross-workspace sessions by default", async () => {
  const context = await slashContext();
  const otherWorkspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-slash-session-other-"));
  const otherStore = new SessionStore(otherWorkspace);
  const other = await otherStore.loadOrCreate(undefined, "qwen3:8b");
  await otherStore.save(other);

  const currentLegacyDir = path.join(context.config.workspaceRoot, ".code-agent", "sessions");
  await mkdir(currentLegacyDir, { recursive: true });
  const otherPath = path.join(otherStore.sessionsDirectory(), `${other.sessionId}.json`);
  await writeFile(path.join(currentLegacyDir, `${other.sessionId}.json`), await readFile(otherPath, "utf8"), "utf8");

  const result = await dispatchSlashCommand(requiredSlash(`/resume ${other.sessionId}`), context);
  assert.match(result.output ?? "", /different workspace/);
  assert.equal(result.config.sessionId, context.config.sessionId);
});

async function slashContext() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-slash-session-"));
  const config: RuntimeConfig = {
    workspaceRoot: workspace,
    provider: "openai-compatible",
    model: "qwen3:8b",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    permissionMode: "workspace-write",
    outputFormat: "json",
    maxTurns: 10,
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
