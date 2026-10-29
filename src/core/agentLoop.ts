import type { TokenUsage } from "./types.js";

export interface AgentLoopToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
  reason?: string;
}

export interface AgentLoopModelResponse {
  text: string;
  toolUses: AgentLoopToolUse[];
  usage?: TokenUsage;
}

export interface AgentLoopToolObservation {
  toolUseId: string;
  toolName: string;
  ok: boolean;
  output: unknown;
}

export interface AgentLoopRunOptions {
  maxIterations: number;
  callModel: (iteration: number) => Promise<AgentLoopModelResponse>;
  executeToolUses: (toolUses: AgentLoopToolUse[], iteration: number) => Promise<AgentLoopToolObservation[]>;
  onToolPlan?: (toolUses: AgentLoopToolUse[], iteration: number) => void | Promise<void>;
}

export interface AgentLoopResult {
  text: string;
  usage?: TokenUsage;
  iterations: number;
  observations: AgentLoopToolObservation[];
  stoppedBy: "final_text" | "max_iterations";
}

export class AgentLoop {
  async run(options: AgentLoopRunOptions): Promise<AgentLoopResult> {
    const observations: AgentLoopToolObservation[] = [];
    const maxIterations = Math.max(1, options.maxIterations);
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const response = await options.callModel(iteration);
      if (response.toolUses.length === 0) {
        return {
          text: response.text,
          ...(response.usage ? { usage: response.usage } : {}),
          iterations: iteration + 1,
          observations,
          stoppedBy: "final_text"
        };
      }
      await options.onToolPlan?.(response.toolUses, iteration);
      observations.push(...await options.executeToolUses(response.toolUses, iteration));
    }
    return {
      text: "",
      iterations: maxIterations,
      observations,
      stoppedBy: "max_iterations"
    };
  }
}
