import type { AgentRuntime } from "../core/runtime.js";
import type { RuntimeConfig } from "../core/types.js";
import type { TranscriptBuffer } from "./transcript.js";

export interface SlashCommandResult {
  config: RuntimeConfig;
  runtime: AgentRuntime;
  output?: string;
  exit?: boolean;
  clear?: boolean;
}

export interface SlashCommandRuntimeOptions {
  visibleHistory?: string;
}

export interface SlashCommandContext {
  config: RuntimeConfig;
  runtime: AgentRuntime;
  transcripts: TranscriptBuffer;
  runtimeOptions: SlashCommandRuntimeOptions;
}
