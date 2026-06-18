import { stripAnsi, takeAnsiSequence, visualLength } from "./markdownRenderer.js";

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  blue: "\x1b[34m",
  green: "\x1b[32m"
};

export type DialogBlockKind = "You" | "Agent";

export interface DialogBlockOptions {
  enabled?: boolean;
  useColor?: boolean;
  width?: number;
}

export function renderDialogBlock(
  kind: DialogBlockKind,
  content: string,
  options: DialogBlockOptions = {}
): string {
  if (options.enabled === false) {
    return content;
  }
  const useColor = options.useColor ?? false;
  const width = Math.max(28, Math.min(96, options.width ?? 80));
  if (!useColor && (!process.stdout.isTTY || options.width === undefined)) {
    return [`[${kind}]`, content].join("\n");
  }
  const title = colorTitle(kind, useColor);
  const plainTitle = kind;
  const top = `╭─ ${title} ${"─".repeat(Math.max(0, width - plainTitle.length - 5))}╮`;
  const bottom = `╰${"─".repeat(width - 2)}╯`;
  const innerWidth = width - 4;
  const lines = wrapPlainLines(content || "", innerWidth)
    .map((line) => `│ ${padRight(line, innerWidth)} │`);
  return [top, ...(lines.length ? lines : [`│ ${padRight("", innerWidth)} │`]), bottom].join("\n");
}

export function renderUserBlock(content: string, options: DialogBlockOptions = {}): string {
  return renderDialogBlock("You", content, options);
}

export function renderAgentBlock(content: string, options: DialogBlockOptions = {}): string {
  return renderDialogBlock("Agent", content, options);
}

export function renderAgentStreamHeader(options: DialogBlockOptions = {}): string {
  if (options.enabled === false) {
    return "[Agent]";
  }
  const useColor = options.useColor ?? false;
  const width = Math.max(28, Math.min(96, options.width ?? 80));
  if (!useColor && (!process.stdout.isTTY || options.width === undefined)) {
    return "[Agent]";
  }
  const title = colorTitle("Agent", useColor);
  return `╭─ ${title} ${"─".repeat(Math.max(0, width - "Agent".length - 5))}╮`;
}

export function renderAgentStreamFooter(options: DialogBlockOptions = {}): string {
  if (options.enabled === false) {
    return "";
  }
  const useColor = options.useColor ?? false;
  const width = Math.max(28, Math.min(96, options.width ?? 80));
  if (!useColor && (!process.stdout.isTTY || options.width === undefined)) {
    return "";
  }
  return `╰${"─".repeat(width - 2)}╯`;
}

export function stripTerminalDecorations(value: string): string {
  return stripAnsi(value)
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^[╭╰].*[╮╯]$/u, "")
      .replace(/^│\s?(.*?)\s?│$/u, "$1")
      .replace(/^●\s*/, "")
      .replace(/^\s*⎿\s*/, ""))
    .filter((line) => line.length > 0)
    .join("\n");
}

function colorTitle(kind: DialogBlockKind, useColor: boolean): string {
  if (!useColor) {
    return kind;
  }
  const color = kind === "You" ? ansi.blue : ansi.green;
  return `${ansi.bold}${color}${kind}${ansi.reset}`;
}

function wrapPlainLines(value: string, width: number): string[] {
  return value.split(/\r?\n/).flatMap((line) => wrapLine(line, width));
}

function wrapLine(line: string, width: number): string[] {
  if (!line) {
    return [""];
  }
  const output: string[] = [];
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
    if (visualLength(current + char) > width) {
      output.push(current);
      current = char;
    } else {
      current += char;
    }
    index += char.length;
  }
  output.push(current);
  return output;
}

function padRight(value: string, width: number): string {
  const length = visualLength(value);
  return length >= width ? value : `${value}${" ".repeat(width - length)}`;
}
