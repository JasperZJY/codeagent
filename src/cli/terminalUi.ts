import { stdout } from "node:process";
import type { Writable } from "node:stream";
import type { PersistedSession } from "../core/session.js";
import type { RuntimeConfig } from "../core/types.js";
import type { SlashCommandHelpEntry } from "./slash.js";
import { takeAnsiSequence, visualLength } from "./markdownRenderer.js";
import { stripTerminalDecorations } from "./terminalBlocks.js";
import { renderFooter } from "./trace.js";

// ── ANSI escape sequences ──────────────────────────────────────────
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CURSOR_HOME = "\x1b[H";
const ERASE_DOWN = "\x1b[J";
const ENTER_ALT_SCREEN = "\x1b[?1049h";
const EXIT_ALT_SCREEN = "\x1b[?1049l";

const RENDER_DEBOUNCE_MS = 80;

/**
 * Detect whether the terminal likely supports the ANSI escape sequences
 * we need for TUI rendering (cursor positioning, screen erase, etc.).
 *
 * On Windows the legacy console host (conhost.exe) may not have VT
 * processing enabled, which would cause escape codes to print as
 * literal text and create the "repeated printing" bug.
 */
export function terminalSupportsTui(): boolean {
  if (!process.stdout.isTTY) return false;

  // Non-Windows: assume VT100+ support
  if (process.platform !== "win32") return true;

  // Windows Terminal sets WT_SESSION
  if (process.env["WT_SESSION"]) return true;
  // ConEmu / Windows Terminal Preview
  if (process.env["ConEmuANSI"] === "ON") return true;
  // VS Code integrated terminal
  if (process.env["TERM_PROGRAM"] === "vscode") return true;
  // Alacritty, WezTerm, etc.
  if (process.env["TERM_PROGRAM"] === "Alacritty" || process.env["TERM_PROGRAM"] === "WezTerm") return true;
  // TERM=xterm-256color usually implies VT support
  if (process.env["TERM"]?.includes("xterm")) return true;

  // Windows 10+ should have VT processing enabled by default for conhost,
  // but it's not guaranteed. Use hasColors() as a heuristic.
  if (typeof process.stdout.hasColors === "function") {
    return process.stdout.hasColors();
  }

  // Fallback: assume true on Windows 10+ (NT 10.0+)
  const release = process.env["OS"]?.match(/10\.0/);
  return !!release;
}

export class TerminalUi {
  private historyLines: string[] = [];
  private input = "";
  private workingStatus = "";
  private suggestions: SlashCommandHelpEntry[] = [];
  private menuBlock = "";
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private renderPending = false;
  private altScreenActive = false;
  private scrollOffset = 0;
  private lastViewportRows = 1;

  constructor(
    private config: RuntimeConfig,
    private session: PersistedSession,
    private readonly output: Writable & { columns?: number; rows?: number } = stdout
  ) {
    // Only enter alternate screen buffer on terminals known to support it.
    // On Windows legacy console (conhost) this sequence would be printed as
    // literal text, making the display much worse.
    if (shouldUseAltScreen(this.config)) {
      this.output.write(`${ENTER_ALT_SCREEN}${HIDE_CURSOR}`);
      this.altScreenActive = true;
    } else {
      this.output.write(HIDE_CURSOR);
    }
  }

  setConfig(config: RuntimeConfig, session: PersistedSession): void {
    this.config = config;
    this.session = session;
  }

  setInput(input: string): void {
    this.input = input;
  }

  setWorkingStatus(status: string): void {
    this.workingStatus = status;
  }

  setSuggestions(suggestions: SlashCommandHelpEntry[]): void {
    this.suggestions = suggestions;
  }

  setMenuBlock(menuBlock: string): void {
    this.menuBlock = menuBlock;
  }

  appendLine(line: string): void {
    this.historyLines.push(line);
    this.preserveScrollPosition(1);
  }

  appendBlock(block: string): void {
    const lines = block.split(/\r?\n/);
    for (const line of lines) {
      this.historyLines.push(line);
    }
    this.preserveScrollPosition(lines.length);
  }

  appendText(text: string): void {
    if (this.historyLines.length === 0) {
      this.historyLines.push("");
    }
    const parts = text.split(/\r?\n/);
    const first = parts.shift() ?? "";
    this.historyLines[this.historyLines.length - 1] = `${this.historyLines[this.historyLines.length - 1] ?? ""}${first}`;
    for (const part of parts) {
      this.historyLines.push(part);
    }
    this.preserveScrollPosition(parts.length);
  }

  clearHistory(): void {
    this.historyLines = [];
    this.scrollOffset = 0;
  }

  plainHistory(): string {
    return stripTerminalDecorations(this.historyLines.join("\n"));
  }

  scrollHistory(deltaRows: number): void {
    this.scrollOffset = Math.max(0, this.scrollOffset + deltaRows);
  }

  scrollPage(direction: "up" | "down"): void {
    const rows = Math.max(1, this.lastViewportRows - 1);
    this.scrollHistory(direction === "up" ? rows : -rows);
  }

  scrollToTop(): void {
    this.scrollOffset = Number.MAX_SAFE_INTEGER;
  }

  scrollToBottom(): void {
    this.scrollOffset = 0;
  }

  render(): void {
    // Debounce rapid renders (e.g. multiple trace events in quick succession).
    // The first call renders immediately; subsequent calls within the debounce
    // window are batched into a single follow-up render.
    if (this.renderTimer) {
      this.renderPending = true;
      return;
    }
    this.renderPending = false;
    this.doRender();
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      if (this.renderPending) {
        this.renderPending = false;
        this.doRender();
      }
    }, RENDER_DEBOUNCE_MS);
  }

  /** Force an immediate render, bypassing the debounce. Use for critical updates. */
  renderNow(): void {
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = undefined;
    }
    this.renderPending = false;
    this.doRender();
  }

  /**
   * Repaint the visible TUI buffer while keeping setup/teardown sequences
   * out of the hot path. Re-sending alternate-screen and cursor sequences on
   * every trace event is what makes Windows Terminal scrollback look like the
   * whole UI was printed repeatedly.
   */
  private doRender(): void {
    const columns = Math.max(40, this.output.columns ?? 100);
    const rows = Math.max(12, this.output.rows ?? 30);
    const inputBox = renderInputBox(this.input, columns);
    const palette = this.menuBlock || renderCommandPalette(this.suggestions, columns);
    const footer = renderFooter(this.config, false);
    const workingLine = this.workingStatus ? `• ${this.workingStatus}` : "";
    const reservedRows =
      inputBox.split("\n").length +
      palette.split("\n").filter(Boolean).length +
      1 +
      (workingLine ? 1 : 0);
    const availableRows = Math.max(1, rows - reservedRows);
    this.lastViewportRows = availableRows;
    const wrappedHistory = wrapLines(this.historyLines, columns);
    const maxScrollOffset = Math.max(0, wrappedHistory.length - availableRows);
    this.scrollOffset = Math.min(this.scrollOffset, maxScrollOffset);
    const historyEnd = Math.max(0, wrappedHistory.length - this.scrollOffset);
    const historyStart = Math.max(0, historyEnd - availableRows);
    const visibleHistory = wrappedHistory.slice(historyStart, historyEnd);
    const history = visibleHistory.join("\n");

    const topPadding = "\n".repeat(Math.max(0, availableRows - visibleHistory.length));

    const screen = [
      CURSOR_HOME,
      ERASE_DOWN,
      history,
      topPadding,
      history || topPadding ? "\n" : "",
      workingLine ? `${workingLine}\n` : "",
      palette ? `${palette}\n` : "",
      inputBox,
      "\n",
      footer,
      ERASE_DOWN
    ].join("");

    this.output.write(screen);
  }

  private preserveScrollPosition(addedRows: number): void {
    if (this.scrollOffset > 0) {
      this.scrollOffset += addedRows;
    }
  }

  close(): void {
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = undefined;
    }
    this.output.write(SHOW_CURSOR);
    // Exit alternate screen buffer to restore the original terminal content
    if (this.altScreenActive) {
      this.output.write(EXIT_ALT_SCREEN);
      this.altScreenActive = false;
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function shouldUseAltScreen(config?: RuntimeConfig): boolean {
  if (config?.terminalMode === "scrollback") {
    return false;
  }
  // Only use alternate screen buffer on terminals that are known to
  // support it.  On Windows legacy console, the \x1b[?1049h sequence
  // would be printed as garbage text.
  if (process.platform === "win32") {
    return Boolean(
      process.env["WT_SESSION"] ||
      process.env["ConEmuANSI"] === "ON" ||
      process.env["TERM_PROGRAM"] === "vscode" ||
      process.env["TERM"]?.includes("xterm")
    );
  }
  return true;
}

export function renderInputBox(input: string, columns: number): string {
  const width = Math.max(24, columns - 2);
  const innerWidth = Math.max(10, width - 4);
  const visibleInput = fitTail(input, innerWidth - 2);
  return [
    `╭${"─".repeat(width)}╮`,
    `│ › ${padRight(visibleInput, innerWidth)} │`,
    `╰${"─".repeat(width)}╯`
  ].join("\n");
}

export function renderCommandPalette(suggestions: SlashCommandHelpEntry[], columns: number): string {
  if (suggestions.length === 0) {
    return "";
  }
  const width = Math.max(24, columns - 2);
  const innerWidth = Math.max(10, width - 4);
  const commandWidth = Math.min(18, Math.max(...suggestions.map((entry) => entry.usage.split(/\s+/, 1)[0]?.length ?? 0)));
  const rows = suggestions.map((entry, index) => {
    const command = entry.usage.split(/\s+/, 1)[0] ?? entry.usage;
    const marker = index === 0 ? ">" : " ";
    const text = `${marker} ${command.padEnd(commandWidth)} ${entry.description}`;
    return `│ ${padRight(fitTail(text, innerWidth), innerWidth)} │`;
  });
  return [
    `╭${"─".repeat(width)}╮`,
    ...rows,
    `╰${"─".repeat(width)}╯`
  ].join("\n");
}

function wrapLines(lines: string[], columns: number): string[] {
  return lines.flatMap((line) => wrapLine(line, columns));
}

function wrapLine(line: string, columns: number): string[] {
  if (!line) {
    return [""];
  }
  const wrapped: string[] = [];
  let current = "";
  let index = 0;
  while (index < line.length) {
    const sequence = takeAnsiSequence(line, index);
    if (sequence) {
      current += sequence;
      index += sequence.length;
      continue;
    }
    const char = [...line.slice(index)][0] ?? "";
    if (visualLength(current + char) > columns) {
      wrapped.push(current);
      current = char;
    } else {
      current += char;
    }
    index += char.length;
  }
  wrapped.push(current);
  return wrapped;
}

function fitTail(value: string, width: number): string {
  if (visualLength(value) <= width) {
    return value;
  }
  let output = "";
  for (const char of [...value].reverse()) {
    if (visualLength(`...${char}${output}`) > width) {
      break;
    }
    output = `${char}${output}`;
  }
  return `...${output}`;
}

function padRight(value: string, width: number): string {
  const length = visualLength(value);
  return length >= width ? value : `${value}${" ".repeat(width - length)}`;
}
