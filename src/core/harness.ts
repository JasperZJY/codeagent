import { AgentLoop, type AgentLoopRunOptions, type AgentLoopResult } from "./agentLoop.js";
import { ContextPipeline, type PreparedTurnContext } from "./contextPipeline.js";
import { HookManager, createDefaultHookManager } from "./hooks.js";
import { ToolPipeline, type ToolCall } from "./toolPipeline.js";
import type { ConversationMessage, RuntimeConfig, ToolExecution, ToolHandlerContext } from "./types.js";
import { defaultToolRegistry, type ToolRegistry } from "../tools/registry.js";

export class AgentHarness {
  readonly hooks: HookManager;
  readonly toolPipeline: ToolPipeline;
  readonly contextPipeline: ContextPipeline;
  readonly agentLoop: AgentLoop;

  constructor(
    private readonly config: RuntimeConfig,
    readonly toolRegistry: ToolRegistry = defaultToolRegistry,
    hooks: HookManager = createDefaultHookManager()
  ) {
    this.hooks = hooks;
    this.toolPipeline = new ToolPipeline(toolRegistry, hooks);
    this.contextPipeline = new ContextPipeline(config);
    this.agentLoop = new AgentLoop();
  }

  async prepareTurnContext(prompt: string, messages: ConversationMessage[] = []): Promise<PreparedTurnContext> {
    return await this.contextPipeline.prepareTurnContext(prompt, messages);
  }

  buildSystemPrompt(runtimeContext = ""): string {
    return this.contextPipeline.buildSystemPrompt(runtimeContext);
  }

  async executeTool(name: string, input: unknown, context: ToolHandlerContext): Promise<ToolExecution> {
    return await this.toolPipeline.executeToolCall({ name, input }, context);
  }

  async executeToolCalls(calls: ToolCall[], context: ToolHandlerContext): Promise<ToolExecution[]> {
    return await this.toolPipeline.executeToolCalls(calls, context);
  }

  async runAgentLoop(options: AgentLoopRunOptions): Promise<AgentLoopResult> {
    await this.hooks.runTurnStart({ workspaceRoot: this.config.workspaceRoot });
    const result = await this.agentLoop.run(options);
    await this.hooks.runTurnEnd({ workspaceRoot: this.config.workspaceRoot, result });
    return result;
  }
}
