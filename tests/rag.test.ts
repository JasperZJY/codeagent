import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { indexWorkspace, searchRag } from "../src/core/rag.js";

test("indexes and searches workspace text chunks", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-rag-"));
  await writeFile(path.join(workspace, "README.md"), "# Demo\nThis project uses a planner and recovery loop.", "utf8");
  const result = await indexWorkspace(workspace);
  assert.match(JSON.stringify(result), /chunks/);
  const matches = await searchRag(workspace, "planner recovery");
  assert.equal(matches.length > 0, true);
  assert.equal(matches[0]?.path, "README.md");
});
