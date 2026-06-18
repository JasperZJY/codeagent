import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TranscriptBuffer } from "../src/cli/transcript.js";
import type { TurnSummary } from "../src/core/types.js";

test("renders last transcript with full tool output", () => {
  const transcripts = new TranscriptBuffer();
  transcripts.recordTurn("run tests", fakeTurn("full stdout line"));
  const output = transcripts.renderLast();
  assert.match(output, /Prompt: run tests/);
  assert.match(output, /full stdout line/);
});

test("renders all transcripts and saves them", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-transcript-"));
  const transcripts = new TranscriptBuffer();
  transcripts.recordTurn("one", fakeTurn("first"));
  transcripts.recordTurn("two", fakeTurn("second"));
  const all = transcripts.renderAll();
  assert.match(all, /Prompt: one/);
  assert.match(all, /Prompt: two/);
  const saved = await transcripts.save(workspace);
  const content = await readFile(saved, "utf8");
  assert.match(content, /first/);
  assert.match(saved, /\.code-agent[\\/]transcripts/);
});

function fakeTurn(stdout: string): TurnSummary {
  return {
    sessionId: "test",
    assistantMessages: [{ role: "assistant", blocks: [{ type: "text", text: "done" }] }],
    toolResults: [
      {
        role: "tool",
        blocks: [
          {
            type: "tool_result",
            toolUseId: "1",
            toolName: "shell",
            output: { code: 0, stdout, stderr: "" },
            isError: false
          }
        ]
      }
    ],
    routedMatches: [],
    iterations: 1,
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: "completed",
    trace: []
  };
}
