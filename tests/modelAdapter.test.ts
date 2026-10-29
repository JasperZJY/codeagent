import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAssistantText } from "../src/core/modelAdapter.js";

test("normalizes JSON array tool calls", () => {
  const normalized = normalizeAssistantText('[{"name":"web_search","arguments":{"query":"今天有什么新闻"}}]', { idPrefix: "test" });
  assert.equal(normalized.text, "");
  assert.equal(normalized.toolUses[0]?.id, "test-1");
  assert.equal(normalized.toolUses[0]?.name, "web_search");
  assert.deepEqual(normalized.toolUses[0]?.input, { query: "今天有什么新闻" });
});

test("normalizes function-style tool calls", () => {
  const normalized = normalizeAssistantText('web_search(query="今日热点新闻")');
  assert.equal(normalized.toolUses[0]?.name, "web_search");
  assert.deepEqual(normalized.toolUses[0]?.input, { query: "今日热点新闻" });
});

test("normalizes non-empty tool_code wrappers", () => {
  const normalized = normalizeAssistantText('<tool_code>web_search(query="今日新闻")</tool_code>');
  assert.equal(normalized.toolUses[0]?.name, "web_search");
  assert.deepEqual(normalized.toolUses[0]?.input, { query: "今日新闻" });
});

test("normalizes labeled tool use text and file_path aliases", () => {
  const normalized = normalizeAssistantText('Tool use write_file: {"file_path":"demo01.py","content":"print(1)\\n"}');
  assert.equal(normalized.text, "");
  assert.equal(normalized.toolUses[0]?.name, "write_file");
  assert.deepEqual(normalized.toolUses[0]?.input, { path: "demo01.py", content: "print(1)\n" });
});

test("normalizes truncated labeled write_file text", () => {
  const normalized = normalizeAssistantText('Tool use write_file: {"file_path":"demo01.py","content":"print(1)\\n');
  assert.equal(normalized.text, "");
  assert.equal(normalized.toolUses[0]?.name, "write_file");
  assert.deepEqual(normalized.toolUses[0]?.input, { path: "demo01.py", content: "print(1)\n" });
});

test("normalizes file_path aliases in JSON action plans", () => {
  const normalized = normalizeAssistantText('{"actions":[{"tool":"write_file","input":{"file_path":"demo01.py","content":"print(1)\\n"}}]}');
  assert.equal(normalized.toolUses[0]?.name, "write_file");
  assert.deepEqual(normalized.toolUses[0]?.input, { path: "demo01.py", content: "print(1)\n" });
});

test("normalizes common model-invented tool aliases", () => {
  const file = normalizeAssistantText('Tool use file: {"operation":"read","file_path":"README.md"}');
  assert.equal(file.toolUses[0]?.name, "read_file");
  assert.deepEqual(file.toolUses[0]?.input, { operation: "read", path: "README.md" });

  const python = normalizeAssistantText('{"actions":[{"tool":"python","input":{"code":"print(1)"}}]}');
  assert.equal(python.toolUses[0]?.name, "python_exec");
  assert.deepEqual(python.toolUses[0]?.input, { code: "print(1)" });
});

test("ignores empty tool_code wrappers", () => {
  const normalized = normalizeAssistantText('我将为您搜索。\n\n<tool_code> </tool_code>');
  assert.equal(normalized.toolUses.length, 0);
  assert.equal(normalized.text, "我将为您搜索。");
});
