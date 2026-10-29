import type { ConversationMessage } from "./types.js";

export interface SubagentRequest {
  description: string;
  messages: ConversationMessage[];
}

export interface SubagentResult {
  description: string;
  summary: string;
}

export async function runIsolatedSubagent(request: SubagentRequest): Promise<SubagentResult> {
  return {
    description: request.description,
    summary: "Subagent execution is reserved for the next harness phase."
  };
}
