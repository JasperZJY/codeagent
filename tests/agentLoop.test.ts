import test from "node:test";
import assert from "node:assert/strict";
import { AgentLoop } from "../src/core/agentLoop.js";

test("agent loop depends only on model and tool callbacks", async () => {
  const calls: string[] = [];
  const loop = new AgentLoop();
  const result = await loop.run({
    maxIterations: 3,
    callModel: async (iteration) => {
      calls.push(`model:${iteration}`);
      if (iteration === 0) {
        return {
          text: "",
          toolUses: [{ id: "call-1", name: "fake_tool", input: { value: 1 } }]
        };
      }
      return {
        text: "done",
        toolUses: [],
        usage: { inputTokens: 2, outputTokens: 1 }
      };
    },
    executeToolUses: async (toolUses, iteration) => {
      calls.push(`tools:${iteration}:${toolUses[0]?.name}`);
      return toolUses.map((toolUse) => ({
        toolUseId: toolUse.id,
        toolName: toolUse.name,
        ok: true,
        output: { observed: toolUse.input }
      }));
    }
  });

  assert.deepEqual(calls, ["model:0", "tools:0:fake_tool", "model:1"]);
  assert.equal(result.text, "done");
  assert.equal(result.iterations, 2);
  assert.equal(result.observations[0]?.toolName, "fake_tool");
  assert.equal(result.usage?.source, undefined);
});
