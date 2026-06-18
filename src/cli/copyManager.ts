import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TurnSummary } from "../core/types.js";
import { stripAnsi } from "./markdownRenderer.js";
import { stripTerminalDecorations } from "./terminalBlocks.js";
import { TranscriptBuffer } from "./transcript.js";
import { writeClipboard } from "./clipboard.js";

export type CopyTarget = "last" | "turn" | "all" | "selection" | "transcript" | "save";

export interface CopyCommandInput {
  target: CopyTarget;
  raw?: boolean;
  rendered?: boolean;
  visibleHistory?: string;
  selection?: string;
  workspaceRoot: string;
  transcripts: TranscriptBuffer;
}

export async function runCopyCommand(input: CopyCommandInput): Promise<string> {
  const text = await resolveCopyText(input);
  if (input.target === "save") {
    const file = await saveCopyText(input.workspaceRoot, text);
    return `Copy saved to ${file}`;
  }
  const result = await writeClipboard(text);
  return result.ok ? result.message : `copy failed: ${result.message}`;
}

export async function resolveCopyText(input: CopyCommandInput): Promise<string> {
  const text = (() => {
    switch (input.target) {
      case "last":
        return input.transcripts.renderLastAssistant();
      case "turn":
        return input.transcripts.renderLast();
      case "all":
        return input.visibleHistory?.trim() || input.transcripts.renderAll();
      case "selection":
        return input.selection?.trim() || "No internal selection is active.";
      case "transcript":
      case "save":
        return input.transcripts.renderAll();
    }
  })();
  return input.raw ? stripAnsi(text) : stripTerminalDecorations(stripAnsi(text));
}

async function saveCopyText(workspaceRoot: string, text: string): Promise<string> {
  const dir = path.join(workspaceRoot, ".code-agent", "transcripts");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `copy-${stamp}.txt`);
  await writeFile(file, text, "utf8");
  return file;
}

export function lastAssistantFromTurn(turn: TurnSummary): string {
  return turn.assistantMessages
    .flatMap((message) => message.blocks)
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
