import { stdin, stdout } from "node:process";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
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
import {
  parseKeepMessages,
  parseSlashCommand,
  suggestSlashCommands,
  type ParsedSlashCommand
} from "./slash.js";
import {
  backSlashMenu,
  completeSlashMenuSelectionForConfig,
  createSlashMenuState,
  enterSlashMenuSelection,
  moveSlashMenuSelection,
  renderSlashMenu,
  slashMenuIsActive,
  updateSlashMenuFilterFromInput,
  type SlashMenuState
} from "./slashMenu.js";
import { TerminalUi, terminalSupportsTui } from "./terminalUi.js";
import { TranscriptBuffer } from "./transcript.js";
import {
  renderAnswerOptions,
  renderAssistantAnswer,
  renderInteractiveAnswer,
  renderTokenUsageLine,
  renderTrace,
  renderTurnBriefSummary,
  renderTurnOutcomeSummary
} from "./trace.js";
import { renderMarkdownForTerminal, shouldRenderTerminalMarkdown } from "./markdownRenderer.js";
import { renderAgentStreamFooter, renderAgentStreamHeader, renderUserBlock } from "./terminalBlocks.js";
import { runCopyCommand, type CopyTarget } from "./copyManager.js";

export async function runRepl(initialConfig: RuntimeConfig): Promise<void> {
  let config = initialConfig;
  let runtime = new AgentRuntime(config);
  let session = await runtime.getCurrentSession();
  const transcripts = new TranscriptBuffer();

  if (stdin.isTTY && stdout.isTTY && terminalSupportsTui() && config.terminalMode !== "scrollback") {
    await runTerminalUiRepl(config, runtime, session, transcripts);
    return;
  }

  console.log(renderBanner(config, session));

  const rl = createInterface({ input: stdin, output: stdout, historySize: 500 });
  const shouldPrompt = Boolean(stdin.isTTY && stdout.isTTY);
  if (shouldPrompt) {
    rl.setPrompt("> ");
    rl.prompt();
  }
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        promptIfNeeded(rl, shouldPrompt);
        continue;
      }

      const slash = parseSlashCommand(trimmed);
      if (slash) {
        const result = await handleSlashCommand(slash, config, runtime, transcripts);
        config = result.config;
        runtime = result.runtime;
        if (result.clear) {
          console.clear();
        }
        if (result.output) {
          console.log(result.output);
        }
        if (result.exit) {
          break;
        }
        promptIfNeeded(rl, shouldPrompt);
        continue;
      }

      try {
        console.log(renderUserBlock(trimmed, {
          enabled: config.dialogBlocks !== false,
          useColor: Boolean(process.stdout.isTTY && process.env["NO_COLOR"] !== "1"),
          width: Math.max(40, process.stdout.columns ?? 100)
        }));
        const turn = await runtime.runTurn(trimmed, 10, {
          onTrace: (event) => {
            const rendered = renderTrace([event], undefined, { verbose: Boolean(config.verbose) });
            if (rendered) {
              console.log(rendered);
            }
          }
        });
        transcripts.recordTurn(trimmed, turn);
        console.log(renderInteractiveAnswer(turn, config));
      } catch (error) {
        console.error(`error: ${errorMessage(error)}`);
      }
      promptIfNeeded(rl, shouldPrompt);
    }
  } finally {
    rl.close();
  }
}

interface SlashCommandResult {
  config: RuntimeConfig;
  runtime: AgentRuntime;
  output?: string;
  exit?: boolean;
  clear?: boolean;
}

interface SlashCommandRuntimeOptions {
  visibleHistory?: string;
}

async function runTerminalUiRepl(
  initialConfig: RuntimeConfig,
  initialRuntime: AgentRuntime,
  initialSession: Awaited<ReturnType<AgentRuntime["getCurrentSession"]>>,
  transcripts: TranscriptBuffer
): Promise<void> {
  let config = initialConfig;
  let runtime = initialRuntime;
  let input = "";
  let busy = false;
  let slashMenuOpen = false;
  let slashMenuState: SlashMenuState = createSlashMenuState();
  const ui = new TerminalUi(config, initialSession);
  ui.appendBlock(renderBanner(config, initialSession));
  ui.render();

  emitKeypressEvents(stdin);
  const previousRawMode = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();

  await new Promise<void>((resolve) => {
    const cleanup = (): void => {
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(previousRawMode);
      ui.close();
      resolve();
    };

    const redraw = (): void => {
      ui.setInput(input);
      const showSlashMenu = !busy && slashMenuOpen && slashMenuIsActive(input);
      if (showSlashMenu) {
        slashMenuState = updateSlashMenuFilterFromInput(input, slashMenuState);
      }
      ui.setMenuBlock(showSlashMenu ? renderSlashMenu(slashMenuState, process.stdout.columns ?? 100, config) : "");
      ui.setSuggestions(!showSlashMenu && !busy && input.trimStart().startsWith("/") ? suggestSlashCommands(input) : []);
      ui.render();
    };

    const redrawNow = (): void => {
      ui.setInput(input);
      const showSlashMenu = !busy && slashMenuOpen && slashMenuIsActive(input);
      if (showSlashMenu) {
        slashMenuState = updateSlashMenuFilterFromInput(input, slashMenuState);
      }
      ui.setMenuBlock(showSlashMenu ? renderSlashMenu(slashMenuState, process.stdout.columns ?? 100, config) : "");
      ui.setSuggestions(!showSlashMenu && !busy && input.trimStart().startsWith("/") ? suggestSlashCommands(input) : []);
      ui.renderNow();
    };

    const submit = async (value: string): Promise<void> => {
      if (busy) {
        ui.appendLine("Task is still running. Wait for it to finish before sending another prompt.");
        redraw();
        return;
      }
      const trimmed = value.trim();
      if (!trimmed) {
        redraw();
        return;
      }

      busy = true;
      ui.scrollToBottom();
      ui.appendBlock(renderUserBlock(trimmed, {
        enabled: config.dialogBlocks !== false,
        useColor: false,
        width: Math.max(40, process.stdout.columns ?? 100)
      }));
      redraw();

      let activeWork: { label: string; startedAt: number; timer: ReturnType<typeof setInterval> } | undefined;
      const stopWorking = (): void => {
        if (activeWork) {
          clearInterval(activeWork.timer);
          activeWork = undefined;
        }
        ui.setWorkingStatus("");
      };
      const startWorking = (label: string): void => {
        stopWorking();
        const startedAt = Date.now();
        const update = (): void => {
          const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
          ui.setWorkingStatus(`Working ${label}... ${elapsedSeconds}s elapsed`);
          redraw();
        };
        activeWork = { label, startedAt, timer: setInterval(update, 1000) };
        update();
      };

      try {
        const slash = parseSlashCommand(trimmed);
        if (slash) {
          const result = await handleSlashCommand(slash, config, runtime, transcripts, { visibleHistory: ui.plainHistory() });
          config = result.config;
          runtime = result.runtime;
          if (result.clear) {
            ui.clearHistory();
          }
          const session = await runtime.getCurrentSession();
          ui.setConfig(config, session);
          if (result.output) {
            ui.appendBlock(result.output);
          }
          if (result.exit) {
            redrawNow();
            cleanup();
            return;
          }
          busy = false;
          redrawNow();
          return;
        }

        let sawTextDelta = false;
        const turn = await runtime.runTurn(trimmed, 10, {
          onTrace: (event) => {
            if (event.type === "running" && (event.label === "llm" || event.label === "planner" || event.label === "coordinator")) {
              startWorking(formatWorkingLabel(event.label, Boolean(config.verbose)));
            }
            if (
              event.type === "ran" &&
              (activeWork?.label === event.label ||
                (activeWork?.label === "summary" && (event.label === "llm" || event.label === "planner" || event.label === "coordinator")))
            ) {
              stopWorking();
            }
            const rendered = renderTrace([event], false, {
              verbose: Boolean(config.verbose),
              thinkingDisplay: config.thinkingDisplay
            });
            if (rendered) {
              ui.appendLine(rendered);
            }
            redraw();
          },
          onTextDelta: (delta) => {
            if (!sawTextDelta) {
              ui.appendLine(renderAgentStreamHeader({
                enabled: config.dialogBlocks !== false,
                useColor: false,
                width: Math.max(40, process.stdout.columns ?? 100)
              }));
              ui.appendLine("");
              sawTextDelta = true;
            }
            ui.appendText(delta);
            redraw();
          }
        });
        transcripts.recordTurn(trimmed, turn);
        if (!sawTextDelta) {
          ui.appendBlock(renderAssistantAnswer(turn, renderAnswerOptions(config, turn)));
        } else {
          ui.appendLine("");
          const footer = renderAgentStreamFooter({
            enabled: config.dialogBlocks !== false,
            useColor: false,
            width: Math.max(40, process.stdout.columns ?? 100)
          });
          if (footer) {
            ui.appendLine(footer);
          }
          const summary = config.verbose
            ? ""
            : turn.summary?.style === "full"
              ? renderTurnOutcomeSummary(turn)
              : turn.summary?.style === "brief"
                ? renderTurnBriefSummary(turn)
                : "";
          if (summary) {
            ui.appendBlock(renderMarkdownForTerminal(summary, {
              enabled: shouldRenderTerminalMarkdown(config),
              useColor: Boolean(process.stdout.isTTY && process.env["NO_COLOR"] !== "1"),
              width: Math.max(40, process.stdout.columns ?? 100)
            }));
          }
        }
        const usageLine = renderTokenUsageLine(turn, config, false);
        if (usageLine) {
          ui.appendLine(usageLine);
        }
        const session = await runtime.getCurrentSession();
        ui.setConfig(config, session);
      } catch (error) {
        ui.appendLine(`error: ${errorMessage(error)}`);
      } finally {
        stopWorking();
        busy = false;
        redrawNow();
      }
    };

    const onKeypress = (str: string, key: { name?: string; ctrl?: boolean; sequence?: string }): void => {
      if (key.ctrl && key.name === "c") {
        ui.appendLine("Session saved. Bye.");
        redrawNow();
        cleanup();
        return;
      }
      if (key.ctrl && key.name === "l") {
        ui.clearHistory();
        redraw();
        return;
      }
      if (key.ctrl && key.name === "t") {
        ui.appendBlock(transcripts.renderLast());
        redrawNow();
        return;
      }
      const menuActive = slashMenuOpen && slashMenuIsActive(input) && !busy;
      if (key.name === "up") {
        if (menuActive) {
          slashMenuState = moveSlashMenuSelection(slashMenuState, -1, config);
          redrawNow();
          return;
        }
        ui.scrollHistory(1);
        redrawNow();
        return;
      }
      if (key.name === "down") {
        if (menuActive) {
          slashMenuState = moveSlashMenuSelection(slashMenuState, 1, config);
          redrawNow();
          return;
        }
        ui.scrollHistory(-1);
        redrawNow();
        return;
      }
      if (key.name === "pageup") {
        ui.scrollPage("up");
        redrawNow();
        return;
      }
      if (key.name === "pagedown") {
        ui.scrollPage("down");
        redrawNow();
        return;
      }
      if (key.name === "home") {
        ui.scrollToTop();
        redrawNow();
        return;
      }
      if (key.name === "end") {
        ui.scrollToBottom();
        redrawNow();
        return;
      }
      if (key.name === "return") {
        if (menuActive) {
          const selection = enterSlashMenuSelection(slashMenuState, config);
          slashMenuState = selection.state;
          input = selection.input;
          slashMenuOpen = selection.input.endsWith(" ");
          if (selection.submitted) {
            const submitted = input;
            input = "";
            slashMenuOpen = false;
            slashMenuState = createSlashMenuState();
            redraw();
            void submit(submitted);
            return;
          }
          redrawNow();
          return;
        }
        const submitted = input;
        input = "";
        slashMenuOpen = false;
        slashMenuState = createSlashMenuState();
        redraw();
        void submit(submitted);
        return;
      }
      if (key.name === "backspace") {
        if (menuActive && input.trim() === `/${slashMenuState.path.join(" ")}`.trim() && slashMenuState.path.length > 0) {
          slashMenuState = backSlashMenu(slashMenuState);
          input = slashMenuState.path.length ? `/${slashMenuState.path.join(" ")} ` : "/";
          redrawNow();
          return;
        }
        input = [...input].slice(0, -1).join("");
        if (!slashMenuIsActive(input)) {
          slashMenuOpen = false;
          slashMenuState = createSlashMenuState();
        }
        redraw();
        return;
      }
      if (key.name === "escape") {
        if (menuActive) {
          slashMenuOpen = false;
          if (input.trim() === "/") {
            input = "";
          }
          redraw();
          return;
        }
        input = "";
        redraw();
        return;
      }
      if (key.name === "tab") {
        if (menuActive) {
          input = completeSlashMenuSelectionForConfig(slashMenuState, config);
          slashMenuOpen = input.endsWith(" ");
          redrawNow();
          return;
        }
        const firstSuggestion = suggestSlashCommands(input, 1)[0];
        const command = firstSuggestion?.usage.split(/\s+/, 1)[0];
        if (command) {
          input = `${command} `;
          redraw();
        }
        return;
      }
      if (str && !key.ctrl && key.name !== "tab") {
        input += str;
        if (slashMenuIsActive(input)) {
          slashMenuOpen = true;
        }
        redraw();
      }
    };

    stdin.on("keypress", onKeypress);
  });
}

async function handleSlashCommand(
  command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime,
  transcripts: TranscriptBuffer,
  runtimeOptions: SlashCommandRuntimeOptions = {}
): Promise<SlashCommandResult> {
  try {
    switch (command.name) {
      case "help":
        return { config, runtime, output: renderInteractiveHelp() };
      case "status":
        return { config, runtime, output: renderStatus(config, await runtime.getCurrentSession()) };
      case "model":
        return await handleModel(command, config, runtime);
      case "profile":
        return await handleProfile(command, config, runtime);
      case "provider":
        return await handleProvider(command, config, runtime);
      case "permissions":
        return await handlePermissions(command, config, runtime);
      case "session":
        return { config, runtime, output: renderSessionSummary(config, await runtime.getCurrentSession()) };
      case "sessions":
        return { config, runtime, output: renderSessions(await runtime.listSessions()) };
      case "resume":
        return await handleResume(command, config, runtime);
      case "init":
        return { config, runtime, output: renderProjectInit(await runtime.initializeProject()) };
      case "context":
        return { config, runtime, output: renderContextReport(await runtime.getContextReport(), "context") };
      case "tokens":
        if (command.args[0]?.toLowerCase() === "show") {
          return handleTokenUsage(command, config, runtime);
        }
        return { config, runtime, output: renderContextReport(await runtime.getContextReport(), "tokens") };
      case "cost":
        return { config, runtime, output: renderContextReport(await runtime.getContextReport(), "cost") };
      case "compact": {
        const keepMessages = parseKeepMessages(command);
        const report = await runtime.compactContext(keepMessages);
        return { config, runtime, output: renderCompactionReport(report) };
      }
      case "goals":
        return { config, runtime, output: renderGoals(await runtime.getGoals()) };
      case "memory":
        return { config, runtime, output: renderMemory(await runtime.listMemory(command.rawArgs || undefined)) };
      case "rag":
        return await handleRag(command, config, runtime);
      case "python":
        return await handlePython(command, config, runtime);
      case "skills":
        return await handleSkills(command, config, runtime);
      case "verbose":
        return handleVerbose(command, config, runtime);
      case "markdown":
        return handleMarkdown(command, config, runtime);
      case "dialog-blocks":
        return handleDialogBlocks(command, config, runtime);
      case "thinking":
        return handleThinking(command, config, runtime);
      case "summary":
        return handleSummary(command, config, runtime);
      case "terminal-mode":
        return handleTerminalMode(command, config, runtime);
      case "copy":
        return await handleCopy(command, config, runtime, transcripts, runtimeOptions);
      case "transcript":
        return await handleTranscript(command, config, runtime, transcripts);
      case "diff":
        return await handleToolSlash(command, config, runtime, "git_diff", command.rawArgs ? { path: command.rawArgs } : {});
      case "changes":
        return await handleToolSlash(command, config, runtime, "changes_summary", {});
      case "checkpoint":
        return await handleToolSlash(command, config, runtime, "checkpoint_create", { reason: command.rawArgs || "manual" });
      case "revert":
        return await handleToolSlash(command, config, runtime, "revert_changes", {});
      case "commit-msg":
        return await handleToolSlash(command, config, runtime, "git_commit_message", {});
      case "risk":
        if (!command.rawArgs.trim()) {
          return { config, runtime, output: "error: missing_command: usage is /risk <command>" };
        }
        return await handleToolSlash(command, config, runtime, "risk_analyze", { command: command.rawArgs });
      case "plan":
      case "todo":
        return { config, runtime, output: renderTaskPlan(await runtime.getTaskPlan()) };
      case "task":
        return await handleTask(command, config, runtime);
      case "resume-task":
        return { config, runtime, output: renderTaskPlan(await runtime.resumeTaskPlan()) };
      case "clear": {
        const session = await runtime.getCurrentSession();
        return { config, runtime, output: renderBanner(config, session), clear: true };
      }
      case "exit":
        return { config, runtime, output: "Session saved. Bye.", exit: true };
      case "unknown":
        return {
          config,
          runtime,
          output: `Unknown command: /${command.rawName}. Type /help for commands.`
        };
    }
  } catch (error) {
    return { config, runtime, output: `error: ${errorMessage(error)}` };
  }
}

async function handlePython(
  command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime
): Promise<SlashCommandResult> {
  const action = command.args[0]?.toLowerCase();
  if (!action) {
    return {
      config,
      runtime,
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
      return { config, runtime, output: "error: missing_python_file: usage is /python run <file>" };
    }
    return await handleToolSlash(command, config, runtime, "python_run_file", { path: file });
  }
  if (action === "exec") {
    const code = command.rawArgs.replace(/^exec\s+/i, "").trim();
    if (!code) {
      return { config, runtime, output: "error: missing_python_code: usage is /python exec <code>" };
    }
    return await handleToolSlash(command, config, runtime, "python_exec", { code });
  }
  if (action === "last") {
    return await handleToolSlash(command, config, runtime, "python_last_result", {});
  }
  if (action === "clean") {
    return await handleToolSlash(command, config, runtime, "python_clean_tmp", {});
  }
  return { config, runtime, output: "error: invalid_python_command: use /python run <file>, /python exec <code>, /python last, or /python clean" };
}

async function handleSkills(
  command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime
): Promise<SlashCommandResult> {
  const action = command.args[0]?.toLowerCase() || "list";
  if (action === "list") {
    return await handleToolSlash(command, config, runtime, "skill_list", {});
  }
  if (action === "search") {
    const query = command.args.slice(1).join(" ").trim();
    if (!query) {
      return { config, runtime, output: "error: missing_skill_query: usage is /skills search <query>" };
    }
    return await handleToolSlash(command, config, runtime, "skill_search", { query });
  }
  if (action === "use" || action === "read" || action === "create") {
    const name = command.args[1];
    if (!name) {
      return { config, runtime, output: `error: missing_skill_name: usage is /skills ${action} <name>` };
    }
    const toolName = action === "use" ? "skill_use" : action === "read" ? "skill_read" : "skill_create";
    return await handleToolSlash(command, config, runtime, toolName, { name });
  }
  if (action === "reload") {
    return await handleToolSlash(command, config, runtime, "skill_reload", {});
  }
  if (action === "init") {
    return await handleToolSlash(command, config, runtime, "skill_init", {});
  }
  return { config, runtime, output: "error: invalid_skills_command: use /skills list|search|use|read|create|reload|init" };
}

async function handleTask(
  command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime
): Promise<SlashCommandResult> {
  const action = command.args[0]?.toLowerCase();
  if (action === "add") {
    const content = command.args.slice(1).join(" ").trim();
    if (!content) {
      return { config, runtime, output: "error: missing_task_content: usage is /task add <content>" };
    }
    return { config, runtime, output: renderTaskPlan(await runtime.addTask(content)) };
  }
  if (action === "done") {
    const id = command.args[1];
    if (!id) {
      return { config, runtime, output: "error: missing_task_id: usage is /task done <id>" };
    }
    return { config, runtime, output: renderTaskPlan(await runtime.updateTask(id, "done")) };
  }
  if (action === "block") {
    const id = command.args[1];
    if (!id) {
      return { config, runtime, output: "error: missing_task_id: usage is /task block <id>" };
    }
    return { config, runtime, output: renderTaskPlan(await runtime.updateTask(id, "blocked")) };
  }
  if (action === "reset") {
    await runtime.resetTasks();
    return { config, runtime, output: "Task plan reset." };
  }
  return {
    config,
    runtime,
    output: "error: invalid_task_command: use /task add <content>, /task done <id>, /task block <id>, or /task reset"
  };
}

async function handleModel(
  command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime
): Promise<SlashCommandResult> {
  if (!command.rawArgs) {
    return { config, runtime, output: `Model: ${config.model}` };
  }
  const activeSession = await runtime.getCurrentSession();
  const nextConfig: RuntimeConfig = { ...config, model: command.rawArgs, sessionId: activeSession.sessionId };
  const nextRuntime = new AgentRuntime(nextConfig);
  await nextRuntime.getCurrentSession();
  return { config: nextConfig, runtime: nextRuntime, output: `Model set to ${nextConfig.model}.` };
}

async function handleProfile(
  command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime
): Promise<SlashCommandResult> {
  const action = command.args[0]?.toLowerCase();
  if (!action || action === "current") {
    return { config, runtime, output: renderCurrentProfile(config) };
  }
  if (action === "list" || action === "ls") {
    return { config, runtime, output: renderProfileList(config) };
  }

  const profileName = command.args[0] ?? action;
  const activeSession = await runtime.getCurrentSession();
  const nextConfig = loadRuntimeConfig({
    workspaceRoot: config.workspaceRoot,
    profile: profileName,
    permissionMode: config.permissionMode,
    outputFormat: config.outputFormat,
    maxTurns: config.maxTurns,
    maxBudgetTokens: config.maxBudgetTokens,
    sessionId: activeSession.sessionId,
    ...(config.verbose !== undefined ? { verbose: config.verbose } : {}),
    ...(config.markdown !== undefined ? { markdown: config.markdown } : {}),
    ...(config.dialogBlocks !== undefined ? { dialogBlocks: config.dialogBlocks } : {}),
    ...(config.showTokenUsage !== undefined ? { showTokenUsage: config.showTokenUsage } : {}),
    ...(config.summaryMode !== undefined ? { summaryMode: config.summaryMode } : {}),
    ...(config.terminalMode !== undefined ? { terminalMode: config.terminalMode } : {}),
    ...(config.contextCompression !== undefined ? { contextCompression: config.contextCompression } : {}),
    ...(config.headroomBaseUrl !== undefined ? { headroomBaseUrl: config.headroomBaseUrl } : {})
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

async function handleProvider(
  command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime
): Promise<SlashCommandResult> {
  if (!command.rawArgs) {
    return {
      config,
      runtime,
      output: `Provider: ${config.provider}\nBase URL: ${config.baseUrl}`
    };
  }

  const provider = normalizeProvider(command.args[0] ?? command.rawArgs);
  const activeSession = await runtime.getCurrentSession();
  const nextConfig = loadRuntimeConfig({
    workspaceRoot: config.workspaceRoot,
    provider,
    permissionMode: config.permissionMode,
    outputFormat: config.outputFormat,
    maxTurns: config.maxTurns,
    maxBudgetTokens: config.maxBudgetTokens,
    sessionId: activeSession.sessionId,
    useLlm: config.useLlm,
    ...(config.verbose !== undefined ? { verbose: config.verbose } : {}),
    ...(config.markdown !== undefined ? { markdown: config.markdown } : {}),
    ...(config.dialogBlocks !== undefined ? { dialogBlocks: config.dialogBlocks } : {}),
    ...(config.showTokenUsage !== undefined ? { showTokenUsage: config.showTokenUsage } : {}),
    ...(config.summaryMode !== undefined ? { summaryMode: config.summaryMode } : {}),
    ...(config.terminalMode !== undefined ? { terminalMode: config.terminalMode } : {})
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

function handleVerbose(
  command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime
): SlashCommandResult {
  const value = command.args[0]?.toLowerCase();
  if (!value) {
    return { config, runtime, output: `Verbose: ${config.verbose ? "on" : "off"}` };
  }
  if (value !== "on" && value !== "off") {
    return { config, runtime, output: "error: invalid_verbose_value: use /verbose on or /verbose off" };
  }
  const nextConfig = { ...config, verbose: value === "on" };
  return { config: nextConfig, runtime, output: `Verbose set to ${nextConfig.verbose ? "on" : "off"}.` };
}

function handleMarkdown(
  command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime
): SlashCommandResult {
  const value = command.args[0]?.toLowerCase();
  if (!value) {
    return { config, runtime, output: `Markdown: ${config.markdown === false ? "off" : "on"}` };
  }
  if (value !== "on" && value !== "off") {
    return { config, runtime, output: "error: invalid_markdown_value: use /markdown on or /markdown off" };
  }
  const nextConfig = { ...config, markdown: value === "on" };
  return { config: nextConfig, runtime, output: `Markdown set to ${nextConfig.markdown ? "on" : "off"}.` };
}

function handleDialogBlocks(
  command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime
): SlashCommandResult {
  const value = command.args[0]?.toLowerCase();
  if (!value) {
    return { config, runtime, output: `Dialog blocks: ${config.dialogBlocks === false ? "off" : "on"}` };
  }
  if (value !== "on" && value !== "off") {
    return { config, runtime, output: "error: invalid_dialog_blocks_value: use /dialog-blocks on or /dialog-blocks off" };
  }
  const nextConfig = { ...config, dialogBlocks: value === "on" };
  return { config: nextConfig, runtime, output: `Dialog blocks set to ${nextConfig.dialogBlocks ? "on" : "off"}.` };
}

function handleThinking(
  command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime
): SlashCommandResult {
  const value = command.args[0]?.toLowerCase();
  if (!value) {
    return { config, runtime, output: `Thinking display: ${config.thinkingDisplay ?? "summary"}` };
  }
  const thinkingDisplay = normalizeThinkingDisplayMode(value);
  const nextConfig = { ...config, thinkingDisplay };
  return { config: nextConfig, runtime, output: `Thinking display set to ${thinkingDisplay}.` };
}

function handleTokenUsage(
  command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime
): SlashCommandResult {
  const value = command.args[1]?.toLowerCase();
  if (!value) {
    return { config, runtime, output: `Token usage display: ${config.showTokenUsage === false ? "off" : "on"}` };
  }
  if (value !== "on" && value !== "off") {
    return { config, runtime, output: "error: invalid_tokens_show_value: use /tokens show on or /tokens show off" };
  }
  const nextConfig = { ...config, showTokenUsage: value === "on" };
  return { config: nextConfig, runtime, output: `Token usage display set to ${nextConfig.showTokenUsage ? "on" : "off"}.` };
}

function handleSummary(
  command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime
): SlashCommandResult {
  const value = command.args[0]?.toLowerCase();
  if (!value) {
    return { config, runtime, output: `Summary mode: ${config.summaryMode ?? "auto"}` };
  }
  const summaryMode = normalizeSummaryMode(value);
  const nextConfig = { ...config, summaryMode };
  return { config: nextConfig, runtime, output: `Summary mode set to ${summaryMode}.` };
}

function handleTerminalMode(
  command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime
): SlashCommandResult {
  const value = command.args[0]?.toLowerCase();
  if (!value) {
    return { config, runtime, output: `Terminal mode: ${config.terminalMode ?? "tui"}` };
  }
  const terminalMode = normalizeTerminalMode(value);
  const nextConfig = { ...config, terminalMode };
  const note = terminalMode === "scrollback"
    ? " Native scrollback mode is applied on the next REPL start; use /copy in the current TUI session."
    : "";
  return { config: nextConfig, runtime, output: `Terminal mode set to ${terminalMode}.${note}` };
}

async function handleTranscript(
  command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime,
  transcripts: TranscriptBuffer
): Promise<SlashCommandResult> {
  const action = command.args[0]?.toLowerCase();
  if (action === "all") {
    return { config, runtime, output: transcripts.renderAll() };
  }
  if (action === "save") {
    if (!transcripts.hasEntries()) {
      return { config, runtime, output: "No transcript recorded yet." };
    }
    const savedPath = await transcripts.save(config.workspaceRoot);
    return { config, runtime, output: `Transcript saved to ${savedPath}` };
  }
  return { config, runtime, output: transcripts.renderLast() };
}

async function handleCopy(
  command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime,
  transcripts: TranscriptBuffer,
  runtimeOptions: SlashCommandRuntimeOptions
): Promise<SlashCommandResult> {
  const rawTarget = command.args[0]?.toLowerCase() || "last";
  const allowed = new Set<CopyTarget>(["last", "turn", "all", "selection", "transcript", "save"]);
  if (!allowed.has(rawTarget as CopyTarget)) {
    return { config, runtime, output: "error: invalid_copy_target: use /copy last|turn|all|selection|transcript|save" };
  }
  const output = await runCopyCommand({
    target: rawTarget as CopyTarget,
    raw: command.args.includes("--raw"),
    rendered: command.args.includes("--rendered"),
    workspaceRoot: config.workspaceRoot,
    transcripts,
    ...(runtimeOptions.visibleHistory !== undefined ? { visibleHistory: runtimeOptions.visibleHistory } : {})
  });
  return { config, runtime, output };
}

async function handleToolSlash(
  _command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime,
  toolName: string,
  input: Record<string, unknown>
): Promise<SlashCommandResult> {
  const execution = await runtime.execTool(toolName, input);
  return { config, runtime, output: renderSlashToolExecution(execution, config) };
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

async function handlePermissions(
  command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime
): Promise<SlashCommandResult> {
  if (!command.rawArgs) {
    return { config, runtime, output: `Permissions: ${config.permissionMode}` };
  }
  const permissionMode = normalizePermissionMode(command.args[0] ?? command.rawArgs);
  const activeSession = await runtime.getCurrentSession();
  const nextConfig: RuntimeConfig = { ...config, permissionMode, sessionId: activeSession.sessionId };
  const nextRuntime = new AgentRuntime(nextConfig);
  await nextRuntime.getCurrentSession();
  return { config: nextConfig, runtime: nextRuntime, output: `Permissions set to ${permissionMode}.` };
}

async function handleResume(
  command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime
): Promise<SlashCommandResult> {
  const sessionId = command.args[0];
  if (!sessionId) {
    return {
      config,
      runtime,
      output: "error: missing_session_id: usage is /resume <id>"
    };
  }
  const nextConfig: RuntimeConfig = { ...config, sessionId };
  const nextRuntime = new AgentRuntime(nextConfig);
  const session = await nextRuntime.useSession(sessionId);
  const resumeState = await nextRuntime.getResumeState();
  return {
    config: nextConfig,
    runtime: nextRuntime,
    output: [`Resumed session ${session.sessionId}.`, "", renderResumeState(resumeState)].join("\n")
  };
}

async function handleRag(
  command: ParsedSlashCommand,
  config: RuntimeConfig,
  runtime: AgentRuntime
): Promise<SlashCommandResult> {
  const action = command.args[0];
  if (action === "index") {
    const targetPath = command.args[1] ?? ".";
    return { config, runtime, output: renderRagIndexResult(await runtime.indexRag(targetPath)) };
  }
  const query = action === "search" ? command.args.slice(1).join(" ") : command.rawArgs;
  if (!query.trim()) {
    return {
      config,
      runtime,
      output: "error: missing_rag_query: use /rag index [path] or /rag search <query>"
    };
  }
  return { config, runtime, output: renderRagMatches(await runtime.searchRag(query, 10)) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function promptIfNeeded(rl: ReturnType<typeof createInterface>, shouldPrompt: boolean): void {
  if (shouldPrompt) {
    rl.prompt();
  }
}

function formatWorkingLabel(label: string, verbose: boolean): string {
  if (verbose) {
    return label;
  }
  if (label === "llm") {
    return "answer";
  }
  if (label === "planner" || label === "coordinator") {
    return "planning";
  }
  return label;
}
