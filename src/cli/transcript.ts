import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ConversationMessage, RuntimeTraceEvent, TurnSummary } from "../core/types.js";
import { stringifyJson } from "../utils/json.js";

interface TranscriptTurn {
  prompt: string;
  turn: TurnSummary;
  recordedAt: string;
}

export class TranscriptBuffer {
  private readonly turns: TranscriptTurn[] = [];

  recordTurn(prompt: string, turn: TurnSummary): void {
    this.turns.push({ prompt, turn, recordedAt: new Date().toISOString() });
  }

  hasEntries(): boolean {
    return this.turns.length > 0;
  }

  renderLast(): string {
    const last = this.turns.at(-1);
    return last ? renderTranscriptTurn(last) : "No transcript recorded yet.";
  }

  renderLastAssistant(): string {
    const last = this.turns.at(-1);
    return last ? renderAssistant(last.turn.assistantMessages) : "No transcript recorded yet.";
  }

  renderAll(): string {
    if (this.turns.length === 0) {
      return "No transcript recorded yet.";
    }
    return this.turns.map(renderTranscriptTurn).join("\n\n");
  }

  async save(workspaceRoot: string): Promise<string> {
    const dir = path.join(workspaceRoot, ".code-agent", "transcripts");
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(dir, `transcript-${stamp}.md`);
    await writeFile(filePath, this.renderAll(), "utf8");
    return filePath;
  }
}

function renderTranscriptTurn(entry: TranscriptTurn): string {
  return [
    `# Transcript ${entry.recordedAt}`,
    "",
    `Prompt: ${entry.prompt}`,
    `Session: ${entry.turn.sessionId}`,
    "",
    "## Trace",
    renderTrace(entry.turn.trace ?? []),
    "",
    "## Tool Results",
    renderToolMessages(entry.turn.toolResults),
    "",
    "## Assistant",
    renderAssistant(entry.turn.assistantMessages)
  ].join("\n");
}

function renderTrace(trace: RuntimeTraceEvent[]): string {
  if (trace.length === 0) {
    return "none";
  }
  return trace.map((event) => stringifyJson(event)).join("\n");
}

function renderToolMessages(messages: ConversationMessage[]): string {
  if (messages.length === 0) {
    return "none";
  }
  return messages
    .flatMap((message) => message.blocks)
    .filter((block) => block.type === "tool_result")
    .map((block) => [
      `### ${block.toolName} ${block.isError ? "error" : "ok"}`,
      "",
      stringifyJson(block.output)
    ].join("\n"))
    .join("\n\n");
}

function renderAssistant(messages: ConversationMessage[]): string {
  const text = messages
    .flatMap((message) => message.blocks)
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return text || "none";
}
