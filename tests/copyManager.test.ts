import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCopyText, runCopyCommand } from "../src/cli/copyManager.js";
import { TranscriptBuffer } from "../src/cli/transcript.js";
import type { TurnSummary } from "../src/core/types.js";

test("/copy last resolves latest assistant answer without ANSI", async () => {
  const transcripts = new TranscriptBuffer();
  transcripts.recordTurn("你好", fakeTurn("回答 \x1b[32m完成\x1b[0m"));
  const text = await resolveCopyText({
    target: "last",
    workspaceRoot: process.cwd(),
    transcripts
  });
  assert.equal(text, "回答 完成");
});

test("/copy turn and transcript include current turn content", async () => {
  const transcripts = new TranscriptBuffer();
  transcripts.recordTurn("帮我分析", fakeTurn("已经分析"));
  const turn = await resolveCopyText({ target: "turn", workspaceRoot: process.cwd(), transcripts, raw: true });
  const transcript = await resolveCopyText({ target: "transcript", workspaceRoot: process.cwd(), transcripts, raw: true });
  assert.match(turn, /Prompt: 帮我分析/);
  assert.match(turn, /已经分析/);
  assert.match(transcript, /Transcript/);
});

test("/copy all prefers visible history", async () => {
  const transcripts = new TranscriptBuffer();
  transcripts.recordTurn("old", fakeTurn("old answer"));
  const text = await resolveCopyText({
    target: "all",
    visibleHistory: "[You]\n当前中文历史",
    workspaceRoot: process.cwd(),
    transcripts
  });
  assert.match(text, /当前中文历史/);
  assert.doesNotMatch(text, /old answer/);
});

test("/copy save writes a text file", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-copy-"));
  const transcripts = new TranscriptBuffer();
  transcripts.recordTurn("copy", fakeTurn("保存内容"));
  const output = await runCopyCommand({ target: "save", workspaceRoot: workspace, transcripts });
  const file = output.match(/Copy saved to (.*)$/)?.[1];
  assert.ok(file);
  await access(file, constants.F_OK);
});

test("clipboard fallback can be disabled clearly", async () => {
  const previous = process.env["CODE_AGENT_TEST_CLIPBOARD"];
  process.env["CODE_AGENT_TEST_CLIPBOARD"] = "1";
  try {
    const transcripts = new TranscriptBuffer();
    transcripts.recordTurn("copy", fakeTurn("复制内容"));
    const output = await runCopyCommand({ target: "last", workspaceRoot: process.cwd(), transcripts });
    assert.match(output, /Copied/);
  } finally {
    if (previous === undefined) {
      delete process.env["CODE_AGENT_TEST_CLIPBOARD"];
    } else {
      process.env["CODE_AGENT_TEST_CLIPBOARD"] = previous;
    }
  }
});

function fakeTurn(answer: string): TurnSummary {
  return {
    sessionId: "test",
    assistantMessages: [{ role: "assistant", blocks: [{ type: "text", text: answer }] }],
    toolResults: [],
    routedMatches: [],
    iterations: 1,
    usage: { inputTokens: 1, outputTokens: 1 },
    turnUsage: { inputTokens: 1, outputTokens: 1, source: "api" },
    stopReason: "completed",
    trace: []
  };
}
