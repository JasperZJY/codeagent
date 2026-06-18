import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deriveMemoryFromTurn, MemoryStore } from "../src/core/memory.js";

test("writes and searches project memory", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-memory-"));
  const store = new MemoryStore(workspace);
  await store.append({
    type: "lesson",
    text: "When README is missing, search docs first.",
    tags: ["recovery"],
    source: "test"
  });
  const matches = await store.search("README docs");
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.type, "lesson");
});

test("derives memory from tool failures and reflection lessons", () => {
  const entries = deriveMemoryFromTurn(
    "记住以后先跑测试",
    [
      {
        role: "tool",
        blocks: [
          {
            type: "tool_result",
            toolUseId: "t",
            toolName: "read_file",
            output: "ENOENT",
            isError: true
          }
        ]
      }
    ],
    ["Prefer small recovery steps."]
  );
  assert.equal(entries.some((entry) => entry.type === "preference"), true);
  assert.equal(entries.some((entry) => entry.type === "failure"), true);
  assert.equal(entries.some((entry) => entry.type === "lesson"), true);
});
