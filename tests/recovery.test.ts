import test from "node:test";
import assert from "node:assert/strict";
import { planRecovery } from "../src/core/recovery.js";

test("plans missing-file recovery actions", () => {
  const recovery = planRecovery(
    { tool: "read_file", input: { path: "docs/missing.md" } },
    {
      toolName: "read_file",
      input: { path: "docs/missing.md" },
      ok: false,
      output: "ENOENT: no such file or directory",
      durationMs: 1
    }
  );
  assert.ok(recovery);
  assert.equal(recovery.actions[0]?.tool, "list_dir");
  assert.equal(recovery.actions[1]?.tool, "glob_search");
});

test("reports unconfigured web search without fake recovery", () => {
  const recovery = planRecovery(
    { tool: "web_search", input: { query: "latest" } },
    {
      toolName: "web_search",
      input: { query: "latest" },
      ok: false,
      output: "web_search_unconfigured: set BAIDU_AI_SEARCH_API_KEY",
      durationMs: 1
    }
  );
  assert.ok(recovery);
  assert.equal(recovery.actions.length, 0);
});
