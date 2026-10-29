import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendMessage, refreshSessionMetadata, SessionStore } from "../src/core/session.js";
import { generateSessionTitleFallback } from "../src/core/sessionTitle.js";
import type { ConversationMessage } from "../src/core/types.js";

test("new session title is generated from first user message", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-session-title-"));
  const store = new SessionStore(workspace);
  const session = await store.loadOrCreate(undefined, "qwen3:8b");
  appendMessage(session, text("user", "请帮我修复 Slash 命令无响应的问题"));
  appendMessage(session, text("assistant", "我会检查 slash handler。"));
  await store.save(session);

  const loaded = await store.load(session.sessionId);
  assert.ok(loaded?.title);
  assert.match(loaded.title ?? "", /修复|命令|响应/);
  assert.match(loaded?.summary ?? "", /本会话主要处理/);
});

test("long user messages produce short deterministic titles", () => {
  const title = generateSessionTitleFallback(
    "请你仔细阅读这个非常长的需求文档，然后帮我修改当前 Agent 的 resume 和 session 管理逻辑，避免历史消息追加到当前会话里"
  );
  assert.equal([...title].length <= 18, true);
  assert.equal(title.includes("\n"), false);
});

test("session metadata redacts secrets before saving", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-session-redact-"));
  const store = new SessionStore(workspace);
  const session = await store.loadOrCreate(undefined, "qwen3:8b");
  appendMessage(session, text("user", "请保存 api_key=sk-1234567890abcdef 和 password=hunter2 的排查记录"));
  session.title = "api_key=sk-1234567890abcdef password=hunter2";
  session.summary = "Authorization: Bearer verysecretbearertoken";
  refreshSessionMetadata(session, undefined);
  await store.save(session);

  const serialized = JSON.stringify(await store.load(session.sessionId));
  assert.equal(serialized.includes("sk-1234567890abcdef"), false);
  assert.equal(serialized.includes("hunter2"), false);
  assert.equal(serialized.includes("verysecretbearertoken"), false);
});

function text(role: ConversationMessage["role"], value: string): ConversationMessage {
  return {
    role,
    blocks: [{ type: "text", text: value }]
  };
}
