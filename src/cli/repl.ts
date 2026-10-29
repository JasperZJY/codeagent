import { stdin, stdout } from "node:process";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { AgentRuntime } from "../core/runtime.js";
import type { RuntimeConfig } from "../core/types.js";
import { renderBanner } from "./banner.js";
import {
  parseSlashCommand,
  suggestSlashCommands
} from "./slash.js";
import {
  backSlashMenu,
  completeSlashMenuSelectionForConfig,
  createSlashMenuState,
  enterSlashMenuSelection,
  filteredSlashMenuItems,
  moveSlashMenuSelection,
  renderSlashMenu,
  slashMenuIsActive,
  slashMenuInputPrefix,
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
import { dispatchSlashCommand } from "./slashDispatcher.js";

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
        const result = await dispatchSlashCommand(slash, {
          config,
          runtime,
          transcripts,
          runtimeOptions: {}
        });
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
          const result = await dispatchSlashCommand(slash, {
            config,
            runtime,
            transcripts,
            runtimeOptions: { visibleHistory: ui.plainHistory() }
          });
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
        let streamedText = "";
        let pendingPlainStream = "";
        const renderStreamedMarkdown = shouldRenderTerminalMarkdown(config);
        const openAgentStreamBlock = (): void => {
          if (sawTextDelta) {
            return;
          }
          ui.appendLine(renderAgentStreamHeader({
            enabled: config.dialogBlocks !== false,
            useColor: false,
            width: Math.max(40, process.stdout.columns ?? 100)
          }));
          ui.appendLine("");
          sawTextDelta = true;
        };
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
            if (renderStreamedMarkdown) {
              streamedText += delta;
              if (!hasVisibleAssistantText(streamedText)) {
                return;
              }
              openAgentStreamBlock();
            } else {
              pendingPlainStream += delta;
              if (!hasVisibleAssistantText(pendingPlainStream)) {
                return;
              }
              openAgentStreamBlock();
              ui.appendText(pendingPlainStream);
              pendingPlainStream = "";
              redraw();
            }
          }
        });
        transcripts.recordTurn(trimmed, turn);
        if (!sawTextDelta) {
          ui.appendBlock(renderAssistantAnswer(turn, renderAnswerOptions(config, turn)));
        } else {
          if (streamedText && hasVisibleAssistantText(streamedText)) {
            if (renderStreamedMarkdown) {
              ui.appendBlock(renderMarkdownForTerminal(streamedText, {
                enabled: true,
                useColor: Boolean(process.stdout.isTTY && process.env["NO_COLOR"] !== "1"),
                width: Math.max(40, process.stdout.columns ?? 100)
              }));
            }
            ui.appendLine("");
          }
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
          if (input.trim() === "/" || filteredSlashMenuItems(slashMenuState, config).length === 0) {
            const submitted = input;
            input = "";
            slashMenuOpen = false;
            slashMenuState = createSlashMenuState();
            redraw();
            void submit(submitted);
            return;
          }
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
        if (menuActive && input.trim() === slashMenuInputPrefix(slashMenuState).trim() && slashMenuState.path.length > 0) {
          slashMenuState = backSlashMenu(slashMenuState);
          input = slashMenuInputPrefix(slashMenuState);
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

function hasVisibleAssistantText(value: string): boolean {
  return value.replace(/\u001b\[[0-9;]*m/g, "").trim().length > 0;
}
