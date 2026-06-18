import test from "node:test";
import assert from "node:assert/strict";
import { routePrompt } from "../src/core/router.js";

test("routes prompt to read_file tool", () => {
  const matches = routePrompt("read README.md", 5);
  assert.equal(matches.some((match) => match.kind === "tool" && match.name === "read_file"), true);
});

test("routes explicit slash command first", () => {
  const matches = routePrompt("/prompt inspect src/index.ts", 5);
  assert.equal(matches[0]?.kind, "command");
  assert.equal(matches[0]?.name, "prompt");
});

test("routes Chinese local file capability question to list_dir", () => {
  const matches = routePrompt("你可以阅读我本地的文件吗", 5);
  assert.equal(matches.some((match) => match.kind === "tool" && match.name === "list_dir"), true);
});

test("routes Chinese project structure analysis to list_dir first", () => {
  const matches = routePrompt("帮我分析这个项目结构", 5);
  assert.equal(matches[0]?.kind, "tool");
  assert.equal(matches[0]?.name, "list_dir");
});

test("routes Chinese read request with path to read_file", () => {
  const matches = routePrompt("帮我读取 README.md", 5);
  assert.equal(matches[0]?.kind, "tool");
  assert.equal(matches[0]?.name, "read_file");
});

test("routes Chinese write request to write_file first", () => {
  const matches = routePrompt("请给我编写一段N皇后C语言代码保存到 TEST.py", 5);
  assert.equal(matches[0]?.kind, "tool");
  assert.equal(matches[0]?.name, "write_file");
});

test("routes URL and internet search prompts to web tools", () => {
  assert.equal(routePrompt("读取 https://example.com", 5).some((match) => match.name === "fetch_url"), true);
  const matches = routePrompt("上网搜索最新 TypeScript MCP 示例", 5);
  assert.equal(matches[0]?.kind, "tool");
  assert.equal(matches[0]?.name, "web_search");
});

test("routes memory and rag prompts to project intelligence tools", () => {
  assert.equal(routePrompt("记住以后先读取 README", 5).some((match) => match.name === "memory_write"), true);
  assert.equal(routePrompt("建立 RAG 索引", 5).some((match) => match.name === "rag_index"), true);
});
