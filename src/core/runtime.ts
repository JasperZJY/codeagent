import path from "node:path";
import { ChangeTracker } from "./changeTracker.js";
import { buildProjectCommandProfile, selectValidationCommands } from "./commandProfile.js";
import { buildContextMonitorReport } from "./contextMonitor.js";
import { compactSession, type ContextCompactionReport } from "./context.js";
import {
  goalsMet,
  markPendingGoalsRunning,
  startTurnGoals,
  summarizeGoals,
  updateGoalsFromExecution
} from "./goals.js";
import { generateAssistantResult, generateAssistantText } from "./llm.js";
import { buildMemoryContext, deriveMemoryFromTurn, MemoryStore, type MemoryEntry } from "./memory.js";
import {
  buildCoordinatorSystemPrompt,
  buildPlanningSystemPrompt,
  describePlan,
  describeRoutePlan,
  fallbackRouteFromMatches,
  parseAgentRoutePlan,
  parseModelActionPlan,
  type AgentRoutePlan,
  type ModelToolAction
} from "./planner.js";
import { buildRagContext, indexWorkspace, searchRag, type RagSearchResult } from "./rag.js";
import { planRecovery } from "./recovery.js";
import { decideReflection, type ReflectionDecision } from "./reflectionPolicy.js";
import { formatReflection, runReflection, type ReflectionReport } from "./reflection.js";
import { buildResumeState } from "./resumeState.js";
import { routePrompt } from "./router.js";
import {
  appendMessage,
  estimateUsage,
  type PersistedSession,
  SessionStore
} from "./session.js";
import {
  finalizePlan,
  summarizeTaskPlan,
  TaskStore,
  updatePlanFromExecution,
  updatePlanFromValidation
} from "./tasks.js";
import {
  runTestFixLoop,
  shellExecutionSucceeded,
  shellOutputText,
  type TestFixFailure
} from "./testRunner.js";
import { initializeProject } from "./projectInit.js";
import { buildSkillsContext, matchSkillsForPrompt, type SkillMatch } from "./skills.js";
import { decideSummary } from "./summaryPolicy.js";
import type {
  AgentTaskPlan,
  ContextMonitorReport,
  ConversationMessage,
  ParsedError,
  ProjectCommandProfile,
  ProjectInitResult,
  ResumeState,
  RoutedMatch,
  RuntimeConfig,
  RuntimeTraceEvent,
  ThinkingTrace,
  TestFixLoopResult,
  ToolExecution,
  TurnSummary
} from "./types.js";
import { executeTool } from "../tools/registry.js";

export interface BootstrapReport {
  prompt: string;
  config: Omit<RuntimeConfig, "apiKey"> & { apiKey: "set" | "unset" };
  routedMatches: RoutedMatch[];
  sessionId: string;
  savedPath: string;
  turn: TurnSummary;
}

export interface RunTurnOptions {
  onTrace?: (event: RuntimeTraceEvent) => void;
  onTextDelta?: (delta: string) => void;
  onThinkingDelta?: (event: ThinkingTrace) => void;
}

interface PlannedToolResult {
  toolUseId: string;
  execution: ToolExecution;
}

export class AgentRuntime {
  private readonly sessionStore: SessionStore;
  private session?: PersistedSession;
  private activeCheckpointId: string | undefined;

  constructor(private readonly config: RuntimeConfig) {
    this.sessionStore = new SessionStore(config.workspaceRoot);
  }

  async bootstrap(prompt: string, limit: number): Promise<BootstrapReport> {
    const turn = await this.runTurn(prompt, limit);
    const session = await this.currentSession();
    const savedPath = await this.sessionStore.save(session);
    return {
      prompt,
      config: {
        ...this.config,
        apiKey: this.config.apiKey ? "set" : "unset"
      },
      routedMatches: turn.routedMatches,
      sessionId: session.sessionId,
      savedPath,
      turn
    };
  }

  async runTurnLoop(prompt: string, limit: number): Promise<TurnSummary[]> {
    const results: TurnSummary[] = [];
    for (let index = 0; index < this.config.maxTurns; index += 1) {
      const turnPrompt = index === 0 ? prompt : `${prompt} [turn ${index + 1}]`;
      const result = await this.runTurn(turnPrompt, limit);
      results.push(result);
      if (result.stopReason !== "tool_use") {
        break;
      }
    }
    if (this.session) {
      await this.sessionStore.save(this.session);
    }
    return results;
  }

  async runTurn(prompt: string, limit: number, options: RunTurnOptions = {}): Promise<TurnSummary> {
    const session = await this.currentSession();
    if (session.messages.length >= this.config.maxTurns * 2) {
      return {
        sessionId: session.sessionId,
        assistantMessages: [],
        toolResults: [],
        routedMatches: [],
        iterations: 0,
        usage: session.usage,
        stopReason: "max_turns_reached",
        trace: [
          {
            type: "info",
            label: "Stopped",
            detail: "max_turns_reached"
          }
        ]
      };
    }

    const trace: RuntimeTraceEvent[] = [];
    const addTrace = (event: RuntimeTraceEvent): void => {
      trace.push(event);
      options.onTrace?.(event);
    };

    const tracker = new ChangeTracker(this.config.workspaceRoot);
    const checkpoint = await tracker.createCheckpoint({
      reason: "turn",
      sessionId: session.sessionId,
      prompt
    });
    this.activeCheckpointId = checkpoint.id;
    addTrace({ type: "info", label: "checkpoint", detail: checkpoint.id });

    const taskStore = new TaskStore(this.config.workspaceRoot);
    let taskPlan = await taskStore.ensurePlanForPrompt(prompt, session.sessionId);
    if (taskPlan) {
      addTrace({
        type: "info",
        label: "plan",
        detail: summarizeTaskPlan(taskPlan)
      });
    }

    addTrace({ type: "running", label: "route", detail: quote(prompt) });
    const routedMatches = routePrompt(prompt, limit);
    addTrace({
      type: "ran",
      label: "route",
      detail: routedMatches.length ? routedMatches.map((match) => `${match.kind}:${match.name}`).join(", ") : "none",
      ok: true
    });

    const memoryStore = new MemoryStore(this.config.workspaceRoot);
    const memoryMatches = await memoryStore.search(prompt, 6);
    addTrace({
      type: "info",
      label: "memory",
      detail: memoryMatches.length ? `loaded ${memoryMatches.length} relevant memories` : "none"
    });
    const ragMatches = await safeRagSearch(this.config.workspaceRoot, prompt, 6);
    addTrace({
      type: "info",
      label: "rag",
      detail: ragMatches.length ? `loaded ${ragMatches.length} snippets` : "none"
    });
    const skillMatches = await safeSkillMatch(this.config.workspaceRoot, prompt, 3);
    for (const match of skillMatches) {
      addTrace({
        type: "info",
        label: "skill",
        detail: `${match.skill.name} (${match.reason})`
      });
    }
    const runtimeContext = buildRuntimeContext(memoryMatches, ragMatches, skillMatches);

    appendMessage(session, {
      role: "user",
      blocks: [{ type: "text", text: prompt }]
    });

    const goals = startTurnGoals(session, prompt);
    markPendingGoalsRunning(goals);
    addTrace({
      type: "info",
      label: "goals",
      detail: goals.map((goal) => goal.title).join("; ")
    });

    const toolResults: ConversationMessage[] = [];
    let iterations = 1;
    let reflection: ReflectionReport | undefined;
    let reflectionDecision: ReflectionDecision | undefined;
    let validation: TestFixLoopResult | undefined;
    let contextReport: ContextMonitorReport | undefined;

    if (shouldUseModelPlanner(this.config, routedMatches)) {
      iterations += await this.runModelToolLoop(session, routedMatches, toolResults, runtimeContext, addTrace, taskStore, taskPlan);
    } else {
      const safeToolExecutions = await this.executeInferredReadOnlyTools(prompt, routedMatches, addTrace);
      for (const execution of safeToolExecutions) {
        const message = toolResultMessage(`auto-${execution.toolName}`, execution);
        appendMessage(session, message);
        toolResults.push(message);
        updateGoalsFromExecution(goals, execution);
        if (taskPlan) {
          updatePlanFromExecution(taskPlan, execution);
          taskPlan = await taskStore.save(taskPlan);
        }
      }
    }

    if (hasSuccessfulMutation(toolResults)) {
      validation = await this.runAutomaticValidation(session, routedMatches, toolResults, runtimeContext, addTrace, taskStore, taskPlan);
      if (taskPlan && validation) {
        updatePlanFromValidation(taskPlan, validation);
        taskPlan = await taskStore.save(taskPlan);
      }
    }

    reflectionDecision = decideReflection({ prompt, toolResults, trace, ...(taskPlan ? { taskPlan } : {}), ...(validation ? { validation } : {}) });
    addTrace({ type: "info", label: "reflection_policy", detail: `${reflectionDecision.level}: ${reflectionDecision.reason}` });
    if (reflectionDecision.shouldReflect) {
      addTrace({
        type: "running",
        label: "reflection",
        detail: this.config.useLlm ? `${this.config.provider}:${this.config.model}` : "deterministic"
      });
      reflection = await runReflection(this.config, prompt, session.messages, toolResults, goals, runtimeContext);
      addTrace({
        type: "ran",
        label: "reflection",
        detail: reflection.verdict,
        ok: reflection.verdict !== "blocked"
      });
      if (reflectionDecision.level === "full" && reflection.issues.length > 0) {
        addTrace({
          type: "ran",
          label: "reviewed_changes",
          detail: reflection.verdict,
          ok: reflection.verdict !== "blocked",
          output: reflection
        });
      }
    } else {
      reflection = { verdict: "pass", issues: [], nextActions: [], lessons: [] };
    }

    if (taskPlan) {
      finalizePlan(taskPlan, reflection.verdict !== "blocked" && validation?.status !== "failed", "final report prepared");
      taskPlan = await taskStore.save(taskPlan);
    }

    const learnedEntries = deriveMemoryFromTurn(prompt, toolResults, reflection.lessons);
    for (const entry of learnedEntries) {
      await memoryStore.append(entry);
    }
    if (learnedEntries.length > 0) {
      addTrace({
        type: "info",
        label: "memory",
        detail: `stored ${learnedEntries.length} learned entries`
      });
    }

    const fallback = buildFallbackAssistantText(prompt, routedMatches, toolResults, this.config);
    const finalContext = buildFinalContext(runtimeContext, goals, reflection);
    addTrace({
      type: "running",
      label: "llm",
      detail: this.config.useLlm ? `${this.config.provider}:${this.config.model}` : "disabled"
    });
    let sawThinkingDelta = false;
    const generated = await generateAssistantResult(
      this.config,
      systemPrompt(this.config, finalContext),
      session.messages,
      fallback,
      {
        ...(options.onTextDelta ? { onTextDelta: options.onTextDelta } : {}),
        onThinkingDelta: (event) => {
          options.onThinkingDelta?.(event);
          if (sawThinkingDelta) {
            return;
          }
          sawThinkingDelta = true;
          addTrace({
            type: "info",
            label: "thinking",
            detail: `${event.source}: ${event.chars} chars hidden`,
            output: event
          });
        }
      }
    );
    if (!sawThinkingDelta && generated.thinking?.[0]) {
      const event = generated.thinking[0];
      addTrace({
        type: "info",
        label: "thinking",
        detail: `${event.source}: ${event.chars} chars hidden`,
        output: event
      });
    }
    const text = generated.text;
    addTrace({
      type: "ran",
      label: "llm",
      detail: this.config.useLlm ? "ok" : "fallback",
      ok: true
    });

    const turnUsage = generated.usage ?? { ...estimateUsage(prompt, text), estimated: true as const, source: "estimated" as const };
    const assistantMessage: ConversationMessage = {
      role: "assistant",
      blocks: [{ type: "text", text }],
      usage: turnUsage
    };
    appendMessage(session, assistantMessage);
    contextReport = await buildContextMonitorReport(this.config, session);
    addTrace({ type: "running", label: "save", detail: session.sessionId });
    await this.sessionStore.save(session);
    addTrace({ type: "ran", label: "save", detail: session.sessionId, ok: true });
    this.activeCheckpointId = undefined;

    const provisionalTurn = {
      sessionId: session.sessionId,
      assistantMessages: [assistantMessage],
      toolResults,
      routedMatches,
      iterations,
      usage: session.usage,
      turnUsage,
      stopReason: "completed",
      trace,
      ...(taskPlan ? { taskPlan } : {}),
      ...(validation ? { validation } : {}),
      ...(contextReport ? { contextReport } : {}),
      ...(reflectionDecision ? { reflectionDecision } : {}),
      ...(skillMatches.length ? {
        loadedSkills: skillMatches.map((match) => ({
          name: match.skill.name,
          description: match.skill.description,
          source: match.skill.source,
          path: match.skill.path
        }))
      } : {}),
      semanticEvidence: collectSemanticEvidence(toolResults)
    } satisfies TurnSummary;
    const summaryDecision = decideSummary(provisionalTurn, this.config.summaryMode ?? "auto");
    return {
      ...provisionalTurn,
      summary: {
        shown: summaryDecision.shouldShowSummary,
        reason: summaryDecision.reason,
        style: summaryDecision.style
      }
    };
  }

  async execTool(name: string, payload: unknown): Promise<ToolExecution> {
    return await executeTool(name, payload, {
      permissionMode: this.config.permissionMode,
      workspaceRoot: this.config.workspaceRoot,
      cwd: this.config.workspaceRoot,
      ...(this.activeCheckpointId !== undefined ? { checkpointId: this.activeCheckpointId } : {})
    });
  }

  async getCurrentSession(): Promise<PersistedSession> {
    return await this.currentSession();
  }

  async useSession(sessionId: string): Promise<PersistedSession> {
    const loaded = await this.sessionStore.load(sessionId);
    if (!loaded) {
      throw new Error(`session_not_found: ${sessionId}`);
    }
    loaded.model = this.config.model;
    this.session = loaded;
    await this.sessionStore.save(loaded);
    return loaded;
  }

  async compactContext(keepMessages = 6): Promise<ContextCompactionReport> {
    const session = await this.currentSession();
    const report = compactSession(session, keepMessages);
    await this.sessionStore.save(session);
    return report;
  }

  async getGoals() {
    const session = await this.currentSession();
    return session.goals ?? [];
  }

  async listMemory(query?: string): Promise<MemoryEntry[]> {
    const store = new MemoryStore(this.config.workspaceRoot);
    return query?.trim() ? await store.search(query, 20) : await store.list(20);
  }

  async indexRag(pathInput = "."): Promise<unknown> {
    return await indexWorkspace(this.config.workspaceRoot, { path: pathInput });
  }

  async searchRag(query: string, limit = 10): Promise<RagSearchResult[]> {
    return await searchRag(this.config.workspaceRoot, query, limit);
  }

  async listSessions(): Promise<PersistedSession[]> {
    return await this.sessionStore.list();
  }

  async loadSession(sessionId: string): Promise<PersistedSession | undefined> {
    return await this.sessionStore.load(sessionId);
  }

  async getTaskPlan(): Promise<AgentTaskPlan | undefined> {
    return await new TaskStore(this.config.workspaceRoot).loadCurrent();
  }

  async addTask(content: string): Promise<AgentTaskPlan> {
    return await new TaskStore(this.config.workspaceRoot).addTask(content);
  }

  async updateTask(id: string, status: "done" | "blocked"): Promise<AgentTaskPlan> {
    return await new TaskStore(this.config.workspaceRoot).updateTask(id, status, status === "done" ? "completed by user" : "blocked by user");
  }

  async resetTasks(): Promise<void> {
    await new TaskStore(this.config.workspaceRoot).reset();
  }

  async resumeTaskPlan(): Promise<AgentTaskPlan | undefined> {
    return await new TaskStore(this.config.workspaceRoot).resumeLatestIncomplete();
  }

  async getProjectCommandProfile(): Promise<ProjectCommandProfile> {
    return await buildProjectCommandProfile(this.config.workspaceRoot);
  }

  async initializeProject(): Promise<ProjectInitResult> {
    return await initializeProject(this.config.workspaceRoot);
  }

  async getContextReport(): Promise<ContextMonitorReport> {
    return await buildContextMonitorReport(this.config, await this.currentSession());
  }

  async getResumeState(): Promise<ResumeState> {
    return await buildResumeState(this.config.workspaceRoot, await this.currentSession());
  }

  private async currentSession(): Promise<PersistedSession> {
    if (!this.session) {
      this.session = await this.sessionStore.loadOrCreate(this.config.sessionId, this.config.model);
    }
    if (this.session.model !== this.config.model) {
      this.session.model = this.config.model;
    }
    return this.session;
  }

  private async runAutomaticValidation(
    session: PersistedSession,
    routedMatches: RoutedMatch[],
    toolResults: ConversationMessage[],
    runtimeContext: string,
    addTrace: (event: RuntimeTraceEvent) => void,
    taskStore: TaskStore,
    taskPlan: AgentTaskPlan | undefined
  ): Promise<TestFixLoopResult> {
    addTrace({ type: "running", label: "project_profile", detail: "detect validation commands" });
    const profile = await buildProjectCommandProfile(this.config.workspaceRoot);
    const commands = selectValidationCommands(profile);
    addTrace({
      type: "ran",
      label: "project_profile",
      detail: commands.length ? commands.join("; ") : "no validation commands",
      ok: commands.length > 0,
      output: { kind: "project_profile", profile, commands }
    });

    const validationOptions: Parameters<typeof runTestFixLoop>[0] = {
      commands,
      maxFixAttempts: 3,
      runCommand: async (command, attempt) => {
        addTrace({
          type: "running",
          label: "shell",
          detail: command,
          input: { command, validationAttempt: attempt }
        });
        const execution = await this.execTool("shell", { command, timeoutMs: 120000 });
        const ok = shellExecutionSucceeded(execution);
        const normalized = { ...execution, ok };
        addTrace({
          type: "ran",
          label: "shell",
          detail: ok ? "validation passed" : "validation failed",
          ok,
          durationMs: execution.durationMs,
          input: { command, validationAttempt: attempt },
          output: execution.output
        });
        const message = toolResultMessage(`validation-${attempt}-${command}`, normalized);
        appendMessage(session, message);
        toolResults.push(message);
        return normalized;
      }
    };
    if (this.config.useLlm) {
      validationOptions.fixAttempt = async (failure, attempt) => {
          return await this.runValidationFixAttempt(
            session,
            routedMatches,
            toolResults,
            runtimeContext,
            failure,
            attempt,
            addTrace,
            taskStore,
            taskPlan
          );
        };
    }
    const validation = await runTestFixLoop(validationOptions);

    addTrace({
      type: "info",
      label: "validation",
      detail: `${validation.status}: ${validation.message}`
    });
    return validation;
  }

  private async runValidationFixAttempt(
    session: PersistedSession,
    routedMatches: RoutedMatch[],
    toolResults: ConversationMessage[],
    runtimeContext: string,
    failure: TestFixFailure,
    attempt: number,
    addTrace: (event: RuntimeTraceEvent) => void,
    taskStore: TaskStore,
    taskPlan: AgentTaskPlan | undefined
  ): Promise<boolean> {
    const errorContext = [
      runtimeContext,
      "Validation failure:",
      `Command: ${failure.command}`,
      `Attempt: ${failure.attempt}`,
      "Parsed errors:",
      failure.errors.length
        ? failure.errors.map((error) => `- ${formatErrorForPrompt(error)}`).join("\n")
        : "- No structured errors parsed.",
      "Output:",
      shellOutputText({ stdout: failure.output }).slice(0, 4000)
    ].filter(Boolean).join("\n");
    const routePlan: AgentRoutePlan = {
      intent: "edit_file",
      strategy: "self_correction",
      tools: ["read_file", "grep_search", "edit_file", "write_file"],
      reason: "repair validation failure"
    };

    addTrace({
      type: "running",
      label: "planner",
      detail: `test-fix attempt ${attempt}`
    });
    const planText = await generateAssistantText(
      this.config,
      buildPlanningSystemPrompt(this.config, routedMatches, routePlan, errorContext),
      session.messages,
      JSON.stringify({ actions: [], final: "blocked" })
    );
    const plan = parseModelActionPlan(planText);
    if (!plan || plan.actions.length === 0) {
      addTrace({
        type: "ran",
        label: "planner",
        detail: "test-fix produced no actions",
        ok: false
      });
      return false;
    }
    addTrace({
      type: "ran",
      label: "planner",
      detail: `test-fix ${describePlan(plan)}`,
      ok: true
    });

    let changed = false;
    for (let actionIndex = 0; actionIndex < plan.actions.length; actionIndex += 1) {
      const action = plan.actions[actionIndex];
      if (!action) {
        continue;
      }
      const executions = await this.executePlannedAction(action, 100 + attempt, actionIndex, session, addTrace);
      for (const result of executions) {
        const message = toolResultMessage(result.toolUseId, result.execution);
        appendMessage(session, message);
        toolResults.push(message);
        if (taskPlan) {
          updatePlanFromExecution(taskPlan, result.execution);
          await taskStore.save(taskPlan);
        }
        if (result.execution.ok && (result.execution.toolName === "write_file" || result.execution.toolName === "edit_file")) {
          changed = true;
        }
      }
    }
    return changed;
  }

  private async runModelToolLoop(
    session: PersistedSession,
    routedMatches: RoutedMatch[],
    toolResults: ConversationMessage[],
    runtimeContext: string,
    addTrace: (event: RuntimeTraceEvent) => void,
    taskStore?: TaskStore,
    taskPlan?: AgentTaskPlan
  ): Promise<number> {
    const routePlan = await this.runCoordinator(session, routedMatches, runtimeContext, addTrace);
    if (routePlan.intent === "direct_answer" || routePlan.tools.length === 0) {
      return 1;
    }

    const maxPlannerIterations = Math.max(1, Math.min(this.config.maxTurns, 6));
    for (let iteration = 0; iteration < maxPlannerIterations; iteration += 1) {
      addTrace({
        type: "running",
        label: "planner",
        detail: `${this.config.provider}:${this.config.model}`
      });
      const planText = await generateAssistantText(
        this.config,
        buildPlanningSystemPrompt(this.config, routedMatches, routePlan, runtimeContext),
        session.messages,
        ""
      );
      const plan = parseModelActionPlan(planText);
      if (!plan) {
        addTrace({
          type: "ran",
          label: "planner",
          detail: "invalid or empty JSON action plan",
          ok: false
        });
        return iteration + 1;
      }

      addTrace({
        type: "ran",
        label: "planner",
        detail: describePlan(plan),
        ok: true
      });

      if (plan.actions.length === 0) {
        return iteration + 1;
      }

      for (let actionIndex = 0; actionIndex < plan.actions.length; actionIndex += 1) {
        const action = plan.actions[actionIndex];
        if (!action) {
          continue;
        }
        const executions = await this.executePlannedAction(action, iteration, actionIndex, session, addTrace);
        for (const result of executions) {
          const message = toolResultMessage(result.toolUseId, result.execution);
          appendMessage(session, message);
          toolResults.push(message);
          updateGoalsFromExecution(session.goals ?? [], result.execution);
          if (taskStore && taskPlan) {
            updatePlanFromExecution(taskPlan, result.execution);
            taskPlan = await taskStore.save(taskPlan);
          }
        }
      }
      if (goalsMet(session.goals ?? [])) {
        return iteration + 1;
      }
    }

    addTrace({
      type: "info",
      label: "planner",
      detail: `max planner iterations reached (${maxPlannerIterations})`
    });
    return maxPlannerIterations;
  }

  private async runCoordinator(
    session: PersistedSession,
    routedMatches: RoutedMatch[],
    runtimeContext: string,
    addTrace: (event: RuntimeTraceEvent) => void
  ): Promise<AgentRoutePlan> {
    addTrace({
      type: "running",
      label: "coordinator",
      detail: `${this.config.provider}:${this.config.model}`
    });
    const fallback = fallbackRouteFromMatches(routedMatches);
    const text = await generateAssistantText(
      this.config,
      buildCoordinatorSystemPrompt(this.config, routedMatches, runtimeContext),
      session.messages,
      JSON.stringify(fallback)
    );
    const routePlan = parseAgentRoutePlan(text) ?? fallback;
    addTrace({
      type: "ran",
      label: "coordinator",
      detail: describeRoutePlan(routePlan),
      ok: true
    });
    return routePlan;
  }

  private async executePlannedAction(
    action: ModelToolAction,
    iteration: number,
    actionIndex: number,
    session: PersistedSession,
    addTrace: (event: RuntimeTraceEvent) => void
  ): Promise<PlannedToolResult[]> {
    const id = `plan-${iteration + 1}-${actionIndex + 1}`;
    appendMessage(session, {
      role: "assistant",
      blocks: [
        {
          type: "tool_use",
          id,
          name: action.tool,
          input: action.input
        }
      ]
    });

    addTrace({
      type: "running",
      label: action.tool,
      detail: describeToolInput(action.tool, action.input),
      input: action.input
    });
    const execution = await this.execTool(action.tool, action.input);
    addTrace({
      type: "ran",
      label: action.tool,
      detail: execution.ok ? summarizeToolOutput(execution.output) : String(execution.output),
      ok: execution.ok,
      durationMs: execution.durationMs,
      input: action.input,
      output: execution.output
    });
    const results: PlannedToolResult[] = [{ toolUseId: id, execution }];

    const recovery = planRecovery(action, execution);
    if (recovery) {
      addTrace({
        type: "info",
        label: "recovery",
        detail: recovery.reason
      });
    }
    for (let index = 0; index < (recovery?.actions ?? []).slice(0, 2).length; index += 1) {
      const recoveryAction = recovery?.actions[index];
      if (!recoveryAction) {
        continue;
      }
      const recoveryId = `${id}-recovery-${index + 1}`;
      appendMessage(session, {
        role: "assistant",
        blocks: [
          {
            type: "tool_use",
            id: recoveryId,
            name: recoveryAction.tool,
            input: recoveryAction.input
          }
        ]
      });
      addTrace({
        type: "running",
        label: recoveryAction.tool,
        detail: `recovery: ${describeToolInput(recoveryAction.tool, recoveryAction.input)}`,
        input: recoveryAction.input
      });
      const recoveryExecution = await this.execTool(recoveryAction.tool, recoveryAction.input);
      addTrace({
        type: "ran",
        label: recoveryAction.tool,
        detail: recoveryExecution.ok ? summarizeToolOutput(recoveryExecution.output) : String(recoveryExecution.output),
        ok: recoveryExecution.ok,
        durationMs: recoveryExecution.durationMs,
        input: recoveryAction.input,
        output: recoveryExecution.output
      });
      results.push({ toolUseId: recoveryId, execution: recoveryExecution });
    }
    return results;
  }

  private async executeInferredReadOnlyTools(
    prompt: string,
    matches: RoutedMatch[],
    addTrace: (event: RuntimeTraceEvent) => void
  ): Promise<ToolExecution[]> {
    const executions: ToolExecution[] = [];
    for (const match of matches.filter((item) => item.kind === "tool")) {
      const input = inferToolInput(match.name, prompt);
      if (!input) {
        addTrace({
          type: "info",
          label: match.name,
          detail: "skipped: no inferred input"
        });
        continue;
      }
      addTrace({
        type: "running",
        label: match.name,
        detail: describeToolInput(match.name, input),
        input
      });
      const execution = await this.execTool(match.name, input);
      addTrace({
        type: "ran",
        label: match.name,
        detail: execution.ok ? summarizeToolOutput(execution.output) : String(execution.output),
        ok: execution.ok,
        durationMs: execution.durationMs,
        input,
        output: execution.output
      });
      executions.push(execution);
    }
    return executions;
  }
}

function shouldUseModelPlanner(config: RuntimeConfig, matches: RoutedMatch[]): boolean {
  return config.useLlm && matches.some((match) => match.kind === "tool");
}

function hasSuccessfulMutation(toolResults: ConversationMessage[]): boolean {
  return toolResults.some((message) =>
    message.blocks.some((block) =>
      block.type === "tool_result" &&
      !block.isError &&
      (block.toolName === "write_file" || block.toolName === "edit_file")
    )
  );
}

function collectSemanticEvidence(toolResults: ConversationMessage[]): string[] {
  const evidence: string[] = [];
  for (const message of toolResults) {
    for (const block of message.blocks) {
      if (block.type !== "tool_result" || block.isError || !isSemanticTool(block.toolName)) {
        continue;
      }
      const output = block.output && typeof block.output === "object" ? block.output as Record<string, unknown> : {};
      for (const key of ["symbols", "definitions", "references", "imports", "edges", "outline"]) {
        const values = output[key];
        if (!Array.isArray(values)) {
          continue;
        }
        for (const item of values.slice(0, 6)) {
          if (item && typeof item === "object") {
            evidence.push(formatSemanticItem(block.toolName, item as Record<string, unknown>));
          }
        }
      }
    }
  }
  return evidence.filter(Boolean).slice(0, 12);
}

function isSemanticTool(toolName: string): boolean {
  return [
    "symbol_search",
    "find_definition",
    "find_references",
    "analyze_imports",
    "call_graph",
    "code_outline"
  ].includes(toolName);
}

function formatSemanticItem(toolName: string, item: Record<string, unknown>): string {
  const file = String(item["file"] ?? "");
  const line = item["line"] ? `:${String(item["line"])}` : "";
  const name = String(item["name"] ?? item["caller"] ?? item["kind"] ?? toolName);
  const extra = item["callee"] ? ` -> ${String(item["callee"])}` : "";
  return `${toolName}: ${name}${extra}${file ? ` at ${file}${line}` : ""}`;
}

function inferToolInput(toolName: string, prompt: string): Record<string, unknown> | undefined {
  if (toolName === "read_file") {
    const file = firstPathLike(prompt);
    return file ? { path: file } : undefined;
  }
  if (toolName === "list_dir") {
    return { path: firstPathLike(prompt) ?? "." };
  }
  if (toolName === "glob_search") {
    const glob = prompt.split(/\s+/).find((token) => token.includes("*"));
    return glob ? { pattern: glob, path: "." } : undefined;
  }
  if (toolName === "grep_search") {
    const quoted = prompt.match(/["']([^"']+)["']/)?.[1];
    if (quoted) {
      return { pattern: quoted, path: "." };
    }
    const tokens = prompt.split(/\s+/).filter(Boolean);
    const searchIndex = tokens.findIndex((token) => ["grep", "search", "find"].includes(token.toLowerCase()));
    const pattern = searchIndex >= 0 ? tokens[searchIndex + 1] : undefined;
    return pattern ? { pattern, path: "." } : undefined;
  }
  if (toolName === "structured_output") {
    return { prompt };
  }
  if (toolName === "fetch_url") {
    const url = prompt.match(/https?:\/\/\S+/i)?.[0];
    return url ? { url } : undefined;
  }
  if (toolName === "web_search") {
    return { query: prompt };
  }
  if (toolName === "memory_search") {
    return { query: prompt };
  }
  if (toolName === "memory_write") {
    return { text: prompt, type: "lesson", tags: ["user_requested"] };
  }
  if (toolName === "rag_index") {
    return { path: firstPathLike(prompt) ?? "." };
  }
  if (toolName === "rag_search") {
    return { query: prompt };
  }
  if (toolName === "symbol_index") {
    return { path: firstPathLike(prompt) ?? "." };
  }
  if (toolName === "symbol_search") {
    return { query: quotedOrLastToken(prompt), limit: 20 };
  }
  if (toolName === "find_definition" || toolName === "find_references") {
    return { name: quotedOrLastToken(prompt), limit: 50 };
  }
  if (toolName === "analyze_imports" || toolName === "code_outline") {
    const file = firstPathLike(prompt);
    return file ? { path: file } : {};
  }
  if (toolName === "call_graph") {
    const symbol = quotedOrLastToken(prompt);
    return symbol ? { symbol } : {};
  }
  if (toolName === "python_run_file") {
    const file = firstPathLike(prompt);
    return file ? { path: file } : undefined;
  }
  if (toolName === "python_last_result" || toolName === "python_clean_tmp") {
    return {};
  }
  if (toolName === "python_exec" || toolName === "python_write_and_run" || toolName === "python_risk") {
    const code = fencedCode(prompt) ?? quotedBlock(prompt);
    return code ? { code } : undefined;
  }
  if (toolName.startsWith("skill_") && !/\bskills?\b|技能|能力包/i.test(prompt)) {
    return undefined;
  }
  if (toolName === "skill_list" || toolName === "skill_reload" || toolName === "skill_init") {
    return {};
  }
  if (toolName === "skill_search") {
    return { query: prompt };
  }
  if (toolName === "skill_read" || toolName === "skill_use" || toolName === "skill_create") {
    const name = prompt.match(/[a-z0-9][a-z0-9_-]{1,80}/i)?.[0];
    return name ? { name } : undefined;
  }
  if (toolName === "project_init" || toolName === "context_monitor" || toolName === "resume_state") {
    return {};
  }
  return undefined;
}

function firstPathLike(prompt: string): string | undefined {
  const tokens = prompt.match(/(?:\.{1,2}[\\/]|[A-Za-z]:[\\/]|[\w.-]+[\\/])[\w./\\-]+|[\w.-]+\.(?:ts|tsx|js|json|py|md|rs|toml|txt)/g);
  return tokens?.[0];
}

function quotedOrLastToken(prompt: string): string {
  const quoted = prompt.match(/["'`“”‘’]([^"'`“”‘’]+)["'`“”‘’]/)?.[1];
  if (quoted?.trim()) {
    return quoted.trim();
  }
  const words = prompt.match(/[A-Za-z_$][\w$]*/g);
  return words?.at(-1) ?? prompt.trim();
}

function fencedCode(prompt: string): string | undefined {
  return prompt.match(/```(?:python|py)?\s*([\s\S]*?)```/i)?.[1]?.trim();
}

function quotedBlock(prompt: string): string | undefined {
  return prompt.match(/["'`](.{8,})["'`]/s)?.[1]?.trim();
}

function toolResultMessage(toolUseId: string, execution: ToolExecution): ConversationMessage {
  return {
    role: "tool",
    blocks: [
      {
        type: "tool_result",
        toolUseId,
        toolName: execution.toolName,
        output: execution.output,
        isError: !execution.ok
      }
    ]
  };
}

function describeToolInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") {
    return compact(String(input));
  }
  const object = input as Record<string, unknown>;
  const pathValue = typeof object["path"] === "string" ? object["path"] : undefined;
  if (toolName === "write_file") {
    const content = typeof object["content"] === "string" ? object["content"] : "";
    const lines = content ? content.split(/\r?\n/).length : 0;
    const bytes = Buffer.byteLength(content, "utf8");
    return pathValue ? `${pathValue} (${lines} lines, ${bytes} bytes)` : `${lines} lines, ${bytes} bytes`;
  }
  if (toolName === "edit_file") {
    return pathValue ? `${pathValue} edit` : "edit";
  }
  if (toolName === "shell") {
    return compact(String(object["command"] ?? ""));
  }
  if (pathValue) {
    return pathValue;
  }
  return compact(JSON.stringify(input));
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function compact(value: string, limit = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
}

function summarizeToolOutput(output: unknown): string {
  if (!output || typeof output !== "object") {
    return compact(String(output));
  }
  const object = output as Record<string, unknown>;
  if (object["kind"] === "text") {
    return `read ${String(object["numLines"] ?? "?")} lines from ${String(object["path"] ?? "file")}`;
  }
  if (Array.isArray(object["entries"])) {
    return `listed ${object["entries"].length} entries in ${String(object["path"] ?? "directory")}`;
  }
  if (Array.isArray(object["files"])) {
    return `matched ${object["files"].length} files`;
  }
  if (typeof object["numMatches"] === "number") {
    return `matched ${object["numMatches"]} lines`;
  }
  if (typeof object["path"] === "string") {
    return `ok ${object["path"]}`;
  }
  return "ok";
}

function buildFallbackAssistantText(
  prompt: string,
  matches: RoutedMatch[],
  toolResults: ConversationMessage[],
  config: RuntimeConfig
): string {
  const lines = [
    `Prompt: ${prompt}`,
    `Routed matches: ${matches.length ? matches.map((match) => `${match.kind}:${match.name}`).join(", ") : "none"}`,
    `Tool observations: ${toolResults.length}`
  ];
  if (!config.useLlm && matches.some((match) => match.kind === "tool" && match.name === "write_file")) {
    lines.push("LLM disabled: generated file content was not fabricated. Enable useLlm or call exec-tool write_file with explicit content.");
  }
  for (const result of toolResults) {
    const block = result.blocks[0];
    if (block?.type === "tool_result") {
      lines.push(`${block.toolName}: ${block.isError ? "error" : "ok"}`);
      lines.push(JSON.stringify(block.output, null, 2).slice(0, 4000));
    }
  }
  return lines.join("\n");
}

async function safeRagSearch(workspaceRoot: string, prompt: string, limit: number): Promise<RagSearchResult[]> {
  try {
    return await searchRag(workspaceRoot, prompt, limit);
  } catch {
    return [];
  }
}

async function safeSkillMatch(workspaceRoot: string, prompt: string, limit: number): Promise<SkillMatch[]> {
  try {
    return await matchSkillsForPrompt(workspaceRoot, prompt, limit);
  } catch {
    return [];
  }
}

function buildRuntimeContext(memoryEntries: MemoryEntry[], ragMatches: RagSearchResult[], skillMatches: SkillMatch[] = []): string {
  return [buildMemoryContext(memoryEntries), buildRagContext(ragMatches), buildSkillsContext(skillMatches)].filter(Boolean).join("\n\n");
}

function buildFinalContext(runtimeContext: string, goals: ReturnType<typeof startTurnGoals>, reflection: ReflectionReport): string {
  return [
    runtimeContext,
    "Active goals:",
    summarizeGoals(goals),
    "",
    formatReflection(reflection)
  ].filter(Boolean).join("\n");
}

function formatErrorForPrompt(error: ParsedError): string {
  const location = error.file
    ? `${error.file}${error.line ? `:${error.line}` : ""}${error.column ? `:${error.column}` : ""}`
    : "unknown";
  return `${location} ${error.type}: ${error.message}`;
}

function systemPrompt(config: RuntimeConfig, runtimeContext = ""): string {
  return [
    "You are a pragmatic code agent runtime.",
    "Use concise, actionable engineering output.",
    "You are running inside a local project workspace and can inspect workspace files through tool observations provided by the runtime.",
    `If the user asks what model or big model you are, answer with the configured provider and model exactly: ${config.provider}:${config.model}.`,
    "Do not claim you cannot read local files. Instead, explain that you can read, list, and search files inside the configured workspace when a path or file task is provided.",
    "You cannot access files outside the workspace unless the configured tools and permissions explicitly allow it.",
    "When tool results are present in the conversation, treat them as the source of truth and summarize them for the user.",
    "Do not expose hidden chain-of-thought. Describe only observable actions and results.",
    `Workspace: ${path.resolve(config.workspaceRoot)}`,
    `Permission mode: ${config.permissionMode}`,
    "Available local tools include read_file, list_dir, glob_search, grep_search, write_file, edit_file, shell, python_exec, python_run_file, python_write_and_run, python_analyze_result, python_last_result, python_clean_tmp, git_status, git_diff, changes_summary, checkpoint_create, revert_changes, git_commit_message, risk_analyze, task_plan, task_add, task_update, task_reset, task_resume, skill_list, skill_search, skill_read, skill_use, skill_create, skill_reload, skill_init, project_profile, validation_plan, parse_errors, symbol_index, symbol_search, find_definition, find_references, analyze_imports, call_graph, code_outline, project_init, context_monitor, resume_state, web_search, fetch_url, memory_search, memory_write, rag_index, rag_search, and ccr_retrieve depending on permissions.",
    runtimeContext ? `Runtime context:\n${runtimeContext}` : "Runtime context: none"
  ].join("\n");
}
