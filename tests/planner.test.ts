import test from "node:test";
import assert from "node:assert/strict";
import { buildPlanningSystemPrompt, fallbackRouteFromMatches, parseAgentRoutePlan, parseModelActionPlan } from "../src/core/planner.js";
import type { RuntimeConfig } from "../src/core/types.js";

test("parses fenced planner JSON with a tool action", () => {
  const plan = parseModelActionPlan([
    "```json",
    "{\"actions\":[{\"tool\":\"read_file\",\"input\":{\"path\":\"README.md\"},\"reason\":\"inspect\"}]}",
    "```"
  ].join("\n"));
  assert.ok(plan);
  assert.equal(plan.actions[0]?.tool, "read_file");
  assert.deepEqual(plan.actions[0]?.input, { path: "README.md" });
});

test("strips qwen-style thinking tags before parsing", () => {
  const plan = parseModelActionPlan("<think>hidden reasoning</think>{\"actions\":[],\"final\":\"done\"}");
  assert.ok(plan);
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.final, "done");
});

test("parses function-style tool calls in assistant text", () => {
  const plan = parseModelActionPlan([
    "我来帮你搜索一下今天的热点新闻。",
    "",
    "╭ python ─╮",
    "│ web_search(query=\"今日热点新闻\")",
    "╰─────────╯"
  ].join("\n"));
  assert.ok(plan);
  assert.equal(plan.actions[0]?.tool, "web_search");
  assert.deepEqual(plan.actions[0]?.input, { query: "今日热点新闻" });
});

test("rejects unknown planner tools", () => {
  const plan = parseModelActionPlan("{\"actions\":[{\"tool\":\"teleport\",\"input\":{}}]}");
  assert.ok(plan);
  assert.equal(plan.actions.length, 0);
});

test("parses coordinator route plan", () => {
  const route = parseAgentRoutePlan("{\"intent\":\"internet_search\",\"strategy\":\"react\",\"tools\":[\"web_search\"]}");
  assert.ok(route);
  assert.equal(route.intent, "internet_search");
  assert.deepEqual(route.tools, ["web_search"]);
});

test("falls back from routed tool matches to coordinator route", () => {
  const route = fallbackRouteFromMatches([
    { kind: "tool", name: "write_file", score: 80, description: "write" }
  ]);
  assert.equal(route.intent, "write_file");
  assert.deepEqual(route.tools, ["write_file"]);
});

test("planning prompt instructs Markdown save requests to use write_file", () => {
  const config: RuntimeConfig = {
    workspaceRoot: process.cwd(),
    provider: "openai-compatible",
    model: "test-model",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "test",
    permissionMode: "workspace-write",
    outputFormat: "json",
    maxTurns: 4,
    maxBudgetTokens: 2000,
    useLlm: false
  };
  const prompt = buildPlanningSystemPrompt(
    config,
    [{ kind: "tool", name: "write_file", score: 80, description: "write" }],
    { intent: "write_file", strategy: "react", tools: ["write_file"] }
  );
  assert.match(prompt, /Markdown/);
  assert.match(prompt, /write_file/);
  assert.match(prompt, /\.md/);
});
