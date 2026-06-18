import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handleMcpMessage } from "../src/mcp/server.js";
import type { RuntimeConfig } from "../src/core/types.js";

test("mcp initialize advertises tool capability", async () => {
  const response = await handleMcpMessage(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
    fakeConfig(await workspace())
  );
  assert.equal(response?.id, 1);
  assert.match(JSON.stringify(response), /tools/);
});

test("mcp tools list exposes registered tools", async () => {
  const response = await handleMcpMessage(
    { jsonrpc: "2.0", id: "tools", method: "tools/list" },
    fakeConfig(await workspace())
  );
  const text = JSON.stringify(response);
  assert.match(text, /read_file/);
  assert.match(text, /web_search/);
  assert.match(text, /ccr_retrieve/);
});

async function workspace(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "code-agent-mcp-"));
}

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
    useLlm: false,
    contextCompression: "off"
  };
}
