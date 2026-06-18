import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareMessagesForModel, retrieveCcrEntry } from "../src/core/headroom.js";
import type { RuntimeConfig } from "../src/core/types.js";

test("compresses large tool results with retrievable CCR reference", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-ccr-"));
  const largeContent = Array.from({ length: 400 }, (_, index) => `line ${index} value`).join("\n");
  const messages = [
    {
      role: "tool" as const,
      blocks: [
        {
          type: "tool_result" as const,
          toolUseId: "call-1",
          toolName: "grep_search",
          output: { content: largeContent },
          isError: false
        }
      ]
    }
  ];

  const prepared = await prepareMessagesForModel(fakeConfig(workspace), messages);
  const block = prepared[0]?.blocks[0];
  assert.equal(block?.type, "tool_result");
  assert.equal((block.output as Record<string, unknown>)["kind"], "ccr_compressed");
  const ref = (block.output as { ref?: string }).ref;
  assert.ok(ref);
  const restored = await retrieveCcrEntry(workspace, ref);
  assert.match(JSON.stringify(restored), /line 399 value/);
});

function fakeConfig(workspaceRoot: string): RuntimeConfig {
  return {
    workspaceRoot,
    provider: "openai-compatible",
    model: "qwen3:8b",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    permissionMode: "workspace-write",
    outputFormat: "text",
    maxTurns: 4,
    maxBudgetTokens: 2000,
    useLlm: true,
    contextCompression: "local"
  };
}
