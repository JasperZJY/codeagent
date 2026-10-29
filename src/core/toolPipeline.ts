import { performance } from "node:perf_hooks";
import { HookManager, createDefaultHookManager } from "./hooks.js";
import { redactSensitiveData, redactSensitiveText } from "./security.js";
import { normalizeToolCallAlias, unknownToolMessage } from "./toolAliases.js";
import type { ToolDefinition, ToolExecution, ToolHandlerContext } from "./types.js";
import { asObject } from "../utils/json.js";

export interface ToolCall {
  id?: string;
  name: string;
  input: unknown;
}

export interface ToolLookup {
  getTool(name: string): ToolDefinition | undefined;
}

export class ToolPipeline {
  constructor(
    private readonly tools: ToolLookup,
    private readonly hooks: HookManager = createDefaultHookManager()
  ) {}

  async executeToolCall(call: ToolCall, context: ToolHandlerContext): Promise<ToolExecution> {
    const normalizedCall = normalizeToolCallAlias(call.name, asObject(call.input));
    const tool = this.tools.getTool(normalizedCall.name);
    if (!tool) {
      return {
        toolName: normalizedCall.name,
        input: normalizedCall.input,
        ok: false,
        output: unknownToolMessage(call.name),
        durationMs: 0
      };
    }

    const started = performance.now();
    const state: Record<string, unknown> = {};
    const hookContext = {
      tool,
      input: normalizedCall.input,
      authorization: context,
      state
    };

    try {
      const pre = await this.hooks.runPreToolUse(hookContext);
      if (!pre.ok) {
        return {
          toolName: tool.name,
          input: redactSensitiveData(hookContext.input),
          ok: false,
          output: pre.observations?.[0] ?? redactSensitiveText(pre.reason ?? "Tool use denied"),
          durationMs: Math.round(performance.now() - started)
        };
      }

      const input = pre.modifiedInput ?? hookContext.input;
      const output = await tool.handler(input, context);
      const execution: ToolExecution = {
        toolName: tool.name,
        input: redactSensitiveData(input),
        ok: true,
        output,
        durationMs: Math.round(performance.now() - started)
      };
      return await this.hooks.runPostToolUse({ ...hookContext, input }, execution);
    } catch (error) {
      const hookResult = await this.hooks.runToolError(hookContext, error);
      return {
        toolName: tool.name,
        input: redactSensitiveData(hookContext.input),
        ok: false,
        output: redactSensitiveText(hookResult?.reason ?? (error instanceof Error ? error.message : String(error))),
        durationMs: Math.round(performance.now() - started)
      };
    }
  }

  async executeToolCalls(calls: ToolCall[], context: ToolHandlerContext): Promise<ToolExecution[]> {
    const results: ToolExecution[] = [];
    for (const call of calls) {
      results.push(await this.executeToolCall(call, context));
    }
    return results;
  }
}
