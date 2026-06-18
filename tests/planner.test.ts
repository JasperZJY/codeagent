import test from "node:test";
import assert from "node:assert/strict";
import { fallbackRouteFromMatches, parseAgentRoutePlan, parseModelActionPlan } from "../src/core/planner.js";

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
