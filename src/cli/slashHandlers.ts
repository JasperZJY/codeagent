import {
  listRuntimeProfiles,
  loadRuntimeConfig,
  normalizePermissionMode,
  normalizeProvider,
  normalizeSummaryMode,
  normalizeTerminalMode,
  normalizeThinkingDisplayMode
} from "../core/config.js";
import { AgentRuntime } from "../core/runtime.js";
import { resolveSessionSelector, sameWorkspace } from "../core/sessionManager.js";
import type { RuntimeConfig, ToolExecution } from "../core/types.js";
import {
  renderBanner,
  renderCompactionReport,
  renderContextReport,
  renderGoals,
  renderInteractiveHelp,
  renderMemory,
  renderProjectInit,
  renderRagIndexResult,
  renderRagMatches,
  renderResumeState,
  renderSessionSummary,
  renderSessions,
  renderStatus,
  renderTaskPlan
} from "./banner.js";
import { runCopyCommand, type CopyTarget } from "./copyManager.js";
import { parseKeepMessages, parseSlashCommand, slashCommandHelp, type ParsedSlashCommand, type SlashCommandName } from "./slash.js";
import type { SlashCommandHandler } from "./slashRegistry.js";
import type { SlashCommandContext, SlashCommandResult } from "./slashResult.js";
import { renderTrace } from "./trace.js";

export function createDefaultSlashHandlers(): SlashCommandHandler[] {
  return [
    commandHandler("help", (command, context) => ({
      ...sameRuntime(context),
      output: renderHelp(command)
    })),
    commandHandler("status", async (_command, context) => ({
      ...sameRuntime(context),
      output: renderStatus(context.config, await context.runtime.getCurrentSession())
    })),
    commandHandler("model", handleModel),
    commandHandler("profile", handleProfile),
    commandHandler("provider", handleProvider),
    commandHandler("permissions", handlePermissions),
    commandHandler("session", handleSession),
    commandHandler("sessions", handleSessions),
    commandHandler("resume", handleResume),
    commandHandler("compact", async (command, context) => {
      const keepMessages = parseKeepMessages(command);
      const report = await context.runtime.compactContext(keepMessages);
      return { ...sameRuntime(context), output: renderCompactionReport(report) };
    }),
    commandHandler("goals", async (_command, context) => ({
      ...sameRuntime(context),
      output: renderGoals(await context.runtime.getGoals())
    })),
    commandHandler("memory", async (command, context) => ({
      ...sameRuntime(context),
      output: renderMemory(await context.runtime.listMemory(command.rawArgs || undefined))
    })),
    commandHandler("rag", handleRag, ["index", "search"]),
    commandHandler("python", handlePython, ["run", "exec", "last", "clean"]),
    commandHandler("skills", handleSkills, ["list", "search", "use", "read", "create", "reload", "init"]),
    commandHandler("verbose", (command, context) => handleVerbose(command, context)),
    commandHandler("markdown", (command, context) => handleMarkdown(command, context)),
    commandHandler("dialog-blocks", (command, context) => handleDialogBlocks(command, context)),
    commandHandler("thinking", (command, context) => handleThinking(command, context)),
    commandHandler("timeout", handleTimeout),
    commandHandler("summary", (command, context) => handleSummary(command, context)),
    commandHandler("terminal-mode", (command, context) => handleTerminalMode(command, context)),
    commandHandler("copy", handleCopy),
    commandHandler("transcript", handleTranscript),
    commandHandler("diff", (command, context) =>
      handleToolSlash(context, "git_diff", command.rawArgs ? { path: command.rawArgs } : {})
    ),
    commandHandler("changes", (command, context) => handleToolSlash(context, "changes_summary", {})),
    commandHandler("checkpoint", (command, context) =>
      handleToolSlash(context, "checkpoint_create", { reason: command.rawArgs || "manual" })
    ),
    commandHandler("revert", handleRevert),
    commandHandler("commit-msg", (command, context) => handleToolSlash(context, "git_commit_message", {})),
    commandHandler("risk", (command, context) => {
      if (!command.rawArgs.trim()) {
        return { ...sameRuntime(context), output: "error: missing_command: usage is /risk <command>" };
      }
      return handleToolSlash(context, "risk_analyze", { command: command.rawArgs });
    }),
    commandHandler("plan", async (_command, context) => ({
      ...sameRuntime(context),
      output: renderTaskPlan(await context.runtime.getTaskPlan())
    })),
    commandHandler("todo", async (_command, context) => ({
      ...sameRuntime(context),
      output: renderTaskPlan(await context.runtime.getTaskPlan())
    })),
    commandHandler("task", handleTask, ["add", "done", "block", "reset"]),
    commandHandler("resume-task", async (_command, context) => ({
      ...sameRuntime(context),
      output: renderTaskPlan(await context.runtime.resumeTaskPlan())
    })),
    commandHandler("init", async (_command, context) => ({
      ...sameRuntime(context),
      output: renderProjectInit(await context.runtime.initializeProject())
    })),
    commandHandler("context", async (_command, context) => ({
      ...sameRuntime(context),
      output: renderContextReport(await context.runtime.getContextReport(), "context")
    })),
    commandHandler("tokens", async (command, context) => {
      if (command.args[0]?.toLowerCase() === "show") {
        return handleTokenUsage(command, context);
      }
      return { ...sameRuntime(context), output: renderContextReport(await context.runtime.getContextReport(), "tokens") };
    }),
    commandHandler("cost", async (_command, context) => ({
      ...sameRuntime(context),
      output: renderContextReport(await context.runtime.getContextReport(), "cost")
    })),
    commandHandler("clear", async (_command, context) => {
      const session = await context.runtime.getCurrentSession();
      return { ...sameRuntime(context), output: renderBanner(context.config, session), clear: true };
    }),
    commandHandler("exit", (_command, context) => ({
      ...sameRuntime(context),
      output: "Session saved. Bye.",
      exit: true
    }))
  ];
}

function commandHandler(
  name: SlashCommandName,
  execute: SlashCommandHandler["execute"],
  subcommands?: string[]
): SlashCommandHandler {
  const help = slashCommandHelp.find((entry) => parseSlashCommand(entry.usage.split(/\s+/, 1)[0] ?? "")?.name === name);
  return {
    name,
    usage: help?.usage ?? `/${name}`,
    description: help?.description ?? name,
    ...(subcommands ? { subcommands } : {}),
    execute
  };
}

function sameRuntime(context: SlashCommandContext): Pick<SlashCommandResult, "config" | "runtime"> {
  return { config: context.config, runtime: context.runtime };
}

function renderHelp(command: ParsedSlashCommand): string {
  const target = command.args[0]?.toLowerCase();
  if (!target) {
    return renderInteractiveHelp();
  }
  const parsed = parseSlashCommand(`/${target}`);
  const entries = slashCommandHelp.filter((entry) => {
    const name = parseSlashCommand(entry.usage.split(/\s+/, 1)[0] ?? "")?.name;
    return parsed?.name !== "unknown" && name === parsed?.name;
  });
  if (entries.length === 0) {
    return `No help for /${target}.\nType /help to list available commands.`;
  }
  const width = Math.max(...entries.map((entry) => entry.usage.length));
  return [
    `Help: /${target}`,
    "",
    ...entries.map((entry) => `  ${entry.usage.padEnd(width)}  ${entry.description}`)
  ].join("\n");
}

async function handlePython(command: ParsedSlashCommand, context: SlashCommandContext): Promise<SlashCommandResult> {
  const action = command.args[0]?.toLowerCase();
  if (!action) {
    return {
      ...sameRuntime(context),
      output: [
        "Python tools:",
        "- /python run <file>",
        "- /python exec <code>",
        "- /python last",
        "- /python clean",
        "",
        "Safety: workspace-only execution, 30s timeout, sensitive paths and network/subprocess code are blocked by default."
      ].join("\n")
    };
  }
  if (action === "run") {
    const file = command.args[1];
    if (!file) {
      return { ...sameRuntime(context), output: "error: missing_python_file: usage is /python run <file>" };
    }
    return await handleToolSlash(context, "python_run_file", { path: file });
  }
  if (action === "exec") {
    const code = command.rawArgs.replace(/^exec\s+/i, "").trim();
    if (!code) {
      return { ...sameRuntime(context), output: "error: missing_python_code: usage is /python exec <code>" };
    }
    return await handleToolSlash(context, "python_exec", { code });
  }
  if (action === "last") {
    return await handleToolSlash(context, "python_last_result", {});
  }
  if (action === "clean") {
    return await handleToolSlash(context, "python_clean_tmp", {});
  }
  return { ...sameRuntime(context), output: "error: invalid_python_command: use /python run <file>, /python exec <code>, /python last, or /python clean" };
}

async function handleSkills(command: ParsedSlashCommand, context: SlashCommandContext): Promise<SlashCommandResult> {
  const action = command.args[0]?.toLowerCase() || "list";
  if (action === "list") {
    return await handleToolSlash(context, "skill_list", {});
  }
  if (action === "search") {
    const query = command.args.slice(1).join(" ").trim();
    if (!query) {
      return { ...sameRuntime(context), output: "error: missing_skill_query: usage is /skills search <query>" };
    }
    return await handleToolSlash(context, "skill_search", { query });
  }
  if (action === "use" || action === "read" || action === "create") {
    const name = command.args[1];
    if (!name) {
      return { ...sameRuntime(context), output: `error: missing_skill_name: usage is /skills ${action} <name>` };
    }
    const toolName = action === "use" ? "skill_use" : action === "read" ? "skill_read" : "skill_create";
    return await handleToolSlash(context, toolName, { name });
  }
  if (action === "reload") {
    return await handleToolSlash(context, "skill_reload", {});
  }
  if (action === "init") {
    return await handleToolSlash(context, "skill_init", {});
  }
  return { ...sameRuntime(context), output: "error: invalid_skills_command: use /skills list|search|use|read|create|reload|init" };
}

async function handleTask(command: ParsedSlashCommand, context: SlashCommandContext): Promise<SlashCommandResult> {
  const action = command.args[0]?.toLowerCase();
  if (action === "add") {
    const content = command.args.slice(1).join(" ").trim();
    if (!content) {
      return { ...sameRuntime(context), output: "error: missing_task_content: usage is /task add <content>" };
    }
    return { ...sameRuntime(context), output: renderTaskPlan(await context.runtime.addTask(content)) };
  }
  if (action === "done") {
    const id = command.args[1];
    if (!id) {
      return { ...sameRuntime(context), output: "error: missing_task_id: usage is /task done <id>" };
    }
    return { ...sameRuntime(context), output: renderTaskPlan(await context.runtime.updateTask(id, "done")) };
  }
  if (action === "block") {
    const id = command.args[1];
    if (!id) {
      return { ...sameRuntime(context), output: "error: missing_task_id: usage is /task block <id>" };
    }
    return { ...sameRuntime(context), output: renderTaskPlan(await context.runtime.updateTask(id, "blocked")) };
  }
  if (action === "reset") {
    await context.runtime.resetTasks();
    return { ...sameRuntime(context), output: "Task plan reset." };
  }
  return {
    ...sameRuntime(context),
    output: "error: invalid_task_command: use /task add <content>, /task done <id>, /task block <id>, or /task reset"
  };
}

async function handleSession(command: ParsedSlashCommand, context: SlashCommandContext): Promise<SlashCommandResult> {
  const action = command.args[0]?.toLowerCase();
  if (!action) {
    return {
      ...sameRuntime(context),
      output: renderSessionSummary(context.config, await context.runtime.getCurrentSession())
    };
  }
  if (action === "id") {
    const session = await context.runtime.getCurrentSession();
    return { ...sameRuntime(context), output: session.sessionId };
  }
  if (action === "rename") {
    const title = command.rawArgs.replace(/^rename\s+/i, "").trim();
    if (!title) {
      return { ...sameRuntime(context), output: "error: missing_session_title: usage is /session rename <new title>" };
    }
    const session = await context.runtime.renameCurrentSession(title);
    return { ...sameRuntime(context), output: `Session renamed: ${session.title ?? session.sessionId}` };
  }
  if (action === "summarize") {
    const session = await context.runtime.summarizeCurrentSession();
    return { ...sameRuntime(context), output: renderSessionSummary(context.config, session) };
  }
  if (action === "refresh-title") {
    const session = await context.runtime.refreshCurrentSessionTitle();
    return { ...sameRuntime(context), output: `Session title refreshed: ${session.title ?? session.sessionId}` };
  }
  return {
    ...sameRuntime(context),
    output: "error: invalid_session_command: use /session, /session rename <title>, /session summarize, /session id, or /session refresh-title"
  };
}

async function handleSessions(command: ParsedSlashCommand, context: SlashCommandContext): Promise<SlashCommandResult> {
  const action = command.args[0]?.toLowerCase();
  if (!action || action === "current-workspace") {
    return { ...sameRuntime(context), output: renderSessions(await context.runtime.listSessions()) };
  }
  if (action === "all") {
    return { ...sameRuntime(context), output: renderSessions(await context.runtime.listSessions({ allWorkspaces: true })) };
  }
  if (action === "search") {
    const query = command.args.slice(1).join(" ").trim().toLowerCase();
    if (!query) {
      return { ...sameRuntime(context), output: "error: missing_session_query: usage is /sessions search <query>" };
    }
    const sessions = (await context.runtime.listSessions()).filter((session) =>
      [session.title, session.summary, session.sessionId, session.lastUserMessagePreview]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
    return { ...sameRuntime(context), output: renderSessions(sessions) };
  }
  return {
    ...sameRuntime(context),
    output: "error: invalid_sessions_command: use /sessions, /sessions all, /sessions current-workspace, or /sessions search <query>"
  };
}

async function handleModel(command: ParsedSlashCommand, context: SlashCommandContext): Promise<SlashCommandResult> {
  if (!command.rawArgs) {
    return { ...sameRuntime(context), output: `Model: ${context.config.model}` };
  }
  const activeSession = await context.runtime.getCurrentSession();
  const nextConfig: RuntimeConfig = { ...context.config, model: command.rawArgs, sessionId: activeSession.sessionId };
  const nextRuntime = new AgentRuntime(nextConfig);
  await nextRuntime.getCurrentSession();
  return { config: nextConfig, runtime: nextRuntime, output: `Model set to ${nextConfig.model}.` };
}

async function handleProfile(command: ParsedSlashCommand, context: SlashCommandContext): Promise<SlashCommandResult> {
  const action = command.args[0]?.toLowerCase();
  if (!action || action === "current") {
    return { ...sameRuntime(context), output: renderCurrentProfile(context.config) };
  }
  if (action === "list" || action === "ls") {
    return { ...sameRuntime(context), output: renderProfileList(context.config) };
  }

  const profileName = command.args[0] ?? action;
  const activeSession = await context.runtime.getCurrentSession();
  const nextConfig = loadRuntimeConfig({
    workspaceRoot: context.config.workspaceRoot,
    profile: profileName,
    permissionMode: context.config.permissionMode,
    outputFormat: context.config.outputFormat,
    maxTurns: context.config.maxTurns,
    maxBudgetTokens: context.config.maxBudgetTokens,
    sessionId: activeSession.sessionId,
    ...(context.config.verbose !== undefined ? { verbose: context.config.verbose } : {}),
    ...(context.config.markdown !== undefined ? { markdown: context.config.markdown } : {}),
    ...(context.config.dialogBlocks !== undefined ? { dialogBlocks: context.config.dialogBlocks } : {}),
    ...(context.config.showTokenUsage !== undefined ? { showTokenUsage: context.config.showTokenUsage } : {}),
    ...(context.config.summaryMode !== undefined ? { summaryMode: context.config.summaryMode } : {}),
    ...(context.config.terminalMode !== undefined ? { terminalMode: context.config.terminalMode } : {}),
    ...(context.config.contextCompression !== undefined ? { contextCompression: context.config.contextCompression } : {}),
    ...(context.config.headroomBaseUrl !== undefined ? { headroomBaseUrl: context.config.headroomBaseUrl } : {})
  });
  const nextRuntime = new AgentRuntime(nextConfig);
  await nextRuntime.getCurrentSession();
  const keyStatus = nextConfig.apiKey ? "set" : "unset";
  const warning = keyStatus === "unset" ? "\nWarning: API key is unset. Set the profile's apiKeyEnv before sending model prompts." : "";
  return {
    config: nextConfig,
    runtime: nextRuntime,
    output: [
      `Profile switched to ${nextConfig.profile ?? profileName}.`,
      `Provider: ${nextConfig.provider}`,
      `Model: ${nextConfig.model}`,
      `Base URL: ${nextConfig.baseUrl}`,
      `API key: ${keyStatus}`,
      `Session: ${activeSession.sessionId}${warning}`
    ].join("\n")
  };
}

async function handleProvider(command: ParsedSlashCommand, context: SlashCommandContext): Promise<SlashCommandResult> {
  if (!command.rawArgs) {
    return {
      ...sameRuntime(context),
      output: `Provider: ${context.config.provider}\nBase URL: ${context.config.baseUrl}`
    };
  }

  const provider = normalizeProvider(command.args[0] ?? command.rawArgs);
  const activeSession = await context.runtime.getCurrentSession();
  const nextConfig = loadRuntimeConfig({
    workspaceRoot: context.config.workspaceRoot,
    provider,
    permissionMode: context.config.permissionMode,
    outputFormat: context.config.outputFormat,
    maxTurns: context.config.maxTurns,
    maxBudgetTokens: context.config.maxBudgetTokens,
    sessionId: activeSession.sessionId,
    useLlm: context.config.useLlm,
    ...(context.config.verbose !== undefined ? { verbose: context.config.verbose } : {}),
    ...(context.config.markdown !== undefined ? { markdown: context.config.markdown } : {}),
    ...(context.config.dialogBlocks !== undefined ? { dialogBlocks: context.config.dialogBlocks } : {}),
    ...(context.config.showTokenUsage !== undefined ? { showTokenUsage: context.config.showTokenUsage } : {}),
    ...(context.config.summaryMode !== undefined ? { summaryMode: context.config.summaryMode } : {}),
    ...(context.config.terminalMode !== undefined ? { terminalMode: context.config.terminalMode } : {})
  });
  const nextRuntime = new AgentRuntime(nextConfig);
  await nextRuntime.getCurrentSession();
  return {
    config: nextConfig,
    runtime: nextRuntime,
    output: `Provider set to ${nextConfig.provider}.\nModel: ${nextConfig.model}\nBase URL: ${nextConfig.baseUrl}`
  };
}

function renderCurrentProfile(config: RuntimeConfig): string {
  return [
    `Profile: ${config.profile ?? "default"}`,
    `Provider: ${config.provider}`,
    `Model: ${config.model}`,
    `Base URL: ${config.baseUrl}`,
    `API key: ${config.apiKey ? "set" : "unset"}`
  ].join("\n");
}

function renderProfileList(config: RuntimeConfig): string {
  const summary = listRuntimeProfiles(config.workspaceRoot);
  if (summary.profiles.length === 0) {
    return "No profiles configured. Add profiles to .code-agent.json or .code-agent/settings.json.";
  }
  const current = config.profile;
  return [
    "Configured profiles:",
    "",
    ...summary.profiles.map((profile) => {
      const marker = profile.name === current ? "*" : " ";
      const defaultMark = profile.name === summary.defaultProfile ? " default" : "";
      return `${marker} ${profile.name}${defaultMark}  ${profile.provider || "provider?"}  ${profile.model || "model?"}  ${profile.baseUrl || "baseUrl?"}  key=${profile.apiKeySource}`;
    })
  ].join("\n");
}

function handleVerbose(command: ParsedSlashCommand, context: SlashCommandContext): SlashCommandResult {
  const value = command.args[0]?.toLowerCase();
  if (!value) {
    return { ...sameRuntime(context), output: `Verbose: ${context.config.verbose ? "on" : "off"}` };
  }
  if (value !== "on" && value !== "off") {
    return { ...sameRuntime(context), output: "error: invalid_verbose_value: use /verbose on or /verbose off" };
  }
  const nextConfig = { ...context.config, verbose: value === "on" };
  return { config: nextConfig, runtime: context.runtime, output: `Verbose set to ${nextConfig.verbose ? "on" : "off"}.` };
}

function handleMarkdown(command: ParsedSlashCommand, context: SlashCommandContext): SlashCommandResult {
  const value = command.args[0]?.toLowerCase();
  if (!value) {
    return { ...sameRuntime(context), output: `Markdown: ${context.config.markdown === false ? "off" : "on"}` };
  }
  if (value !== "on" && value !== "off") {
    return { ...sameRuntime(context), output: "error: invalid_markdown_value: use /markdown on or /markdown off" };
  }
  const nextConfig = { ...context.config, markdown: value === "on" };
  return { config: nextConfig, runtime: context.runtime, output: `Markdown set to ${nextConfig.markdown ? "on" : "off"}.` };
}

function handleDialogBlocks(command: ParsedSlashCommand, context: SlashCommandContext): SlashCommandResult {
  const value = command.args[0]?.toLowerCase();
  if (!value) {
    return { ...sameRuntime(context), output: `Dialog blocks: ${context.config.dialogBlocks === false ? "off" : "on"}` };
  }
  if (value !== "on" && value !== "off") {
    return { ...sameRuntime(context), output: "error: invalid_dialog_blocks_value: use /dialog-blocks on or /dialog-blocks off" };
  }
  const nextConfig = { ...context.config, dialogBlocks: value === "on" };
  return { config: nextConfig, runtime: context.runtime, output: `Dialog blocks set to ${nextConfig.dialogBlocks ? "on" : "off"}.` };
}

function handleThinking(command: ParsedSlashCommand, context: SlashCommandContext): SlashCommandResult {
  const value = command.args[0]?.toLowerCase();
  if (!value) {
    return { ...sameRuntime(context), output: `Thinking display: ${context.config.thinkingDisplay ?? "off"}` };
  }
  const thinkingDisplay = normalizeThinkingDisplayMode(value);
  const nextConfig = { ...context.config, thinkingDisplay };
  return { config: nextConfig, runtime: context.runtime, output: `Thinking display set to ${thinkingDisplay}.` };
}

async function handleTimeout(command: ParsedSlashCommand, context: SlashCommandContext): Promise<SlashCommandResult> {
  const value = command.args[0];
  if (!value) {
    return { ...sameRuntime(context), output: `LLM timeout: ${context.config.llmTimeoutMs}ms` };
  }
  const llmTimeoutMs = Number(value);
  if (!Number.isInteger(llmTimeoutMs) || llmTimeoutMs <= 0) {
    return { ...sameRuntime(context), output: "error: invalid_timeout_value: use /timeout <positive-ms>" };
  }
  const activeSession = await context.runtime.getCurrentSession();
  const nextConfig = { ...context.config, llmTimeoutMs, sessionId: activeSession.sessionId };
  const nextRuntime = new AgentRuntime(nextConfig);
  await nextRuntime.getCurrentSession();
  return { config: nextConfig, runtime: nextRuntime, output: `LLM timeout set to ${llmTimeoutMs}ms.` };
}

function handleTokenUsage(command: ParsedSlashCommand, context: SlashCommandContext): SlashCommandResult {
  const value = command.args[1]?.toLowerCase();
  if (!value) {
    return { ...sameRuntime(context), output: `Token usage display: ${context.config.showTokenUsage === false ? "off" : "on"}` };
  }
  if (value !== "on" && value !== "off") {
    return { ...sameRuntime(context), output: "error: invalid_tokens_show_value: use /tokens show on or /tokens show off" };
  }
  const nextConfig = { ...context.config, showTokenUsage: value === "on" };
  return { config: nextConfig, runtime: context.runtime, output: `Token usage display set to ${nextConfig.showTokenUsage ? "on" : "off"}.` };
}

function handleSummary(command: ParsedSlashCommand, context: SlashCommandContext): SlashCommandResult {
  const value = command.args[0]?.toLowerCase();
  if (!value) {
    return { ...sameRuntime(context), output: `Summary mode: ${context.config.summaryMode ?? "auto"}` };
  }
  const summaryMode = normalizeSummaryMode(value);
  const nextConfig = { ...context.config, summaryMode };
  return { config: nextConfig, runtime: context.runtime, output: `Summary mode set to ${summaryMode}.` };
}

function handleTerminalMode(command: ParsedSlashCommand, context: SlashCommandContext): SlashCommandResult {
  const value = command.args[0]?.toLowerCase();
  if (!value) {
    return { ...sameRuntime(context), output: `Terminal mode: ${context.config.terminalMode ?? "tui"}` };
  }
  const terminalMode = normalizeTerminalMode(value);
  const nextConfig = { ...context.config, terminalMode };
  const note = terminalMode === "scrollback"
    ? " Native scrollback mode is applied on the next REPL start; use /copy in the current TUI session."
    : "";
  return { config: nextConfig, runtime: context.runtime, output: `Terminal mode set to ${terminalMode}.${note}` };
}

async function handleTranscript(command: ParsedSlashCommand, context: SlashCommandContext): Promise<SlashCommandResult> {
  const action = command.args[0]?.toLowerCase();
  if (action === "all") {
    return { ...sameRuntime(context), output: context.transcripts.renderAll() };
  }
  if (action === "save") {
    if (!context.transcripts.hasEntries()) {
      return { ...sameRuntime(context), output: "No transcript recorded yet." };
    }
    const savedPath = await context.transcripts.save(context.config.workspaceRoot);
    return { ...sameRuntime(context), output: `Transcript saved to ${savedPath}` };
  }
  return { ...sameRuntime(context), output: context.transcripts.renderLast() };
}

async function handleCopy(command: ParsedSlashCommand, context: SlashCommandContext): Promise<SlashCommandResult> {
  const rawTarget = command.args[0]?.toLowerCase() || "last";
  const allowed = new Set<CopyTarget>(["last", "turn", "all", "selection", "transcript", "save"]);
  if (!allowed.has(rawTarget as CopyTarget)) {
    return { ...sameRuntime(context), output: "error: invalid_copy_target: use /copy last|turn|all|selection|transcript|save" };
  }
  const output = await runCopyCommand({
    target: rawTarget as CopyTarget,
    raw: command.args.includes("--raw"),
    rendered: command.args.includes("--rendered"),
    workspaceRoot: context.config.workspaceRoot,
    transcripts: context.transcripts,
    ...(context.runtimeOptions.visibleHistory !== undefined ? { visibleHistory: context.runtimeOptions.visibleHistory } : {})
  });
  return { ...sameRuntime(context), output };
}

async function handleToolSlash(
  context: SlashCommandContext,
  toolName: string,
  input: Record<string, unknown>
): Promise<SlashCommandResult> {
  const execution = await context.runtime.execTool(toolName, input);
  return { ...sameRuntime(context), output: renderSlashToolExecution(execution, context.config) };
}

function renderSlashToolExecution(execution: ToolExecution, config: RuntimeConfig): string {
  const rendered = renderTrace([
    {
      type: "ran",
      label: execution.toolName,
      ok: execution.ok,
      durationMs: execution.durationMs,
      input: execution.input,
      output: execution.output
    }
  ], false, { verbose: Boolean(config.verbose) });
  if (rendered) {
    return rendered;
  }
  const prefix = execution.ok ? "ok" : "error";
  return `${prefix}: ${JSON.stringify(execution.output, null, 2)}`;
}

async function handlePermissions(command: ParsedSlashCommand, context: SlashCommandContext): Promise<SlashCommandResult> {
  if (!command.rawArgs) {
    return { ...sameRuntime(context), output: `Permissions: ${context.config.permissionMode}` };
  }
  const requestedMode = stripOptionalArgBrackets(command.args[0] ?? command.rawArgs);
  const permissionMode = normalizePermissionMode(requestedMode);
  const activeSession = await context.runtime.getCurrentSession();
  const nextConfig: RuntimeConfig = { ...context.config, permissionMode, sessionId: activeSession.sessionId };
  const nextRuntime = new AgentRuntime(nextConfig);
  await nextRuntime.getCurrentSession();
  return { config: nextConfig, runtime: nextRuntime, output: `Permissions set to ${permissionMode}.` };
}

function stripOptionalArgBrackets(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1).trim() : trimmed;
}

async function handleResume(command: ParsedSlashCommand, context: SlashCommandContext): Promise<SlashCommandResult> {
  const allowWorkspaceSwitch = command.args.includes("--allow-workspace-switch");
  const requested = command.args.filter((arg) => arg !== "--allow-workspace-switch").join(" ").trim();
  const sessions = await context.runtime.listSessions();
  if (!requested) {
    return {
      ...sameRuntime(context),
      output: [
        sessions.length ? renderSessions(sessions) : "No saved sessions found for this workspace.",
        sessions.length ? "" : undefined,
        sessions.length ? "Use:" : undefined,
        sessions.length ? "  /resume 1" : undefined,
        sessions.length ? "  /resume \"session title\"" : undefined,
        sessions.length ? "  /resume sess_xxx" : undefined
      ].filter(Boolean).join("\n")
    };
  }

  const currentWorkspaceResolution = resolveSessionSelector(requested, sessions);
  const allSessions = currentWorkspaceResolution.kind === "none"
    ? await context.runtime.listSessions({ allWorkspaces: true })
    : sessions;
  const resolved = currentWorkspaceResolution.kind === "none"
    ? resolveSessionSelector(requested, allSessions)
    : currentWorkspaceResolution;
  if (resolved.kind === "none") {
    return { ...sameRuntime(context), output: "Session not found. Use /sessions to list available sessions." };
  }
  if (resolved.kind === "many") {
    return {
      ...sameRuntime(context),
      output: [
        "Multiple sessions matched. Use a more specific title, number, or session id.",
        "",
        renderSessions(resolved.sessions)
      ].join("\n")
    };
  }

  const target = resolved.session;
  if (!sameWorkspace(target.workspaceRoot, context.config.workspaceRoot) && !allowWorkspaceSwitch) {
    return {
      ...sameRuntime(context),
      output: [
        "This session belongs to a different workspace.",
        `Session workspace: ${target.workspaceRoot}`,
        `Current workspace: ${context.config.workspaceRoot}`,
        "Use /resume <selector> --allow-workspace-switch if you intentionally want to switch workspace."
      ].join("\n")
    };
  }

  await context.runtime.saveCurrentSessionIfMeaningful();
  const nextConfig: RuntimeConfig = {
    ...context.config,
    workspaceRoot: target.workspaceRoot,
    sessionId: target.sessionId,
    model: target.model || context.config.model,
    provider: target.provider || context.config.provider,
    ...(target.profile !== undefined ? { profile: target.profile } : {})
  };
  const nextRuntime = new AgentRuntime(nextConfig);
  const session = await nextRuntime.useSession(target.sessionId);
  const resumeState = await nextRuntime.getResumeState();
  return {
    config: nextConfig,
    runtime: nextRuntime,
    output: [`Session resumed: ${session.title ?? session.sessionId}`, `Session id: ${session.sessionId}`, "", renderResumeState(resumeState)].join("\n")
  };
}

async function handleRevert(command: ParsedSlashCommand, context: SlashCommandContext): Promise<SlashCommandResult> {
  const changes = await context.runtime.execTool("changes_summary", {});
  if (!changes.ok) {
    return { ...sameRuntime(context), output: renderSlashToolExecution(changes, context.config) };
  }
  const changeOutput = asObject(changes.output);
  const files = Array.isArray(changeOutput["files"]) ? changeOutput["files"] : [];
  if (files.length === 0) {
    return {
      ...sameRuntime(context),
      output: [
        "No agent-tracked changes to revert.",
        "Create a checkpoint first with /checkpoint, then make agent file edits before using /revert."
      ].join("\n")
    };
  }
  const execution = await context.runtime.execTool("revert_changes", {});
  return { ...sameRuntime(context), output: renderSlashToolExecution(execution, context.config) };
}

async function handleRag(command: ParsedSlashCommand, context: SlashCommandContext): Promise<SlashCommandResult> {
  const action = command.args[0];
  if (action === "index") {
    const targetPath = command.args[1] ?? ".";
    return { ...sameRuntime(context), output: renderRagIndexResult(await context.runtime.indexRag(targetPath)) };
  }
  const query = action === "search" ? command.args.slice(1).join(" ") : command.rawArgs;
  if (!query.trim()) {
    return {
      ...sameRuntime(context),
      output: "error: missing_rag_query: use /rag index [path] or /rag search <query>"
    };
  }
  return { ...sameRuntime(context), output: renderRagMatches(await context.runtime.searchRag(query, 10)) };
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
