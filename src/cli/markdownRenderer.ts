import type { OutputFormat, RuntimeConfig } from "../core/types.js";

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  inverse: "\x1b[7m"
};

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export interface TerminalMarkdownOptions {
  enabled?: boolean;
  useColor?: boolean;
  width?: number;
}

export function shouldRenderTerminalMarkdown(
  config: Pick<RuntimeConfig, "markdown" | "outputFormat">,
  outputFormat: OutputFormat = config.outputFormat,
  isTty = Boolean(process.stdout.isTTY)
): boolean {
  return config.markdown !== false && outputFormat !== "json" && isTty;
}

export function renderMarkdownForTerminal(markdown: string, options: TerminalMarkdownOptions = {}): string {
  if (options.enabled === false) {
    return markdown;
  }
  const useColor = options.useColor ?? shouldUseColor();
  const width = Math.max(24, options.width ?? terminalWidth());
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const rendered: string[] = [];
  let inCodeBlock = false;
  let codeFenceLabel = "";
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) {
      return;
    }
    const text = paragraph.join(" ").trim();
    if (text) {
      rendered.push(...wrapStyledText(renderInline(text, useColor), width));
    }
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      flushParagraph();
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeFenceLabel = fence[1]?.trim() ?? "";
        rendered.push(codeBorder("top", codeFenceLabel, width, useColor));
      } else {
        rendered.push(codeBorder("bottom", "", width, useColor));
        inCodeBlock = false;
        codeFenceLabel = "";
      }
      continue;
    }

    if (inCodeBlock) {
      rendered.push(formatCodeLine(line, width, useColor));
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      if (rendered.at(-1) !== "") {
        rendered.push("");
      }
      continue;
    }

    const tableBlock = collectTableBlock(lines, index);
    if (tableBlock) {
      flushParagraph();
      rendered.push(...renderTable(tableBlock.rows, width, useColor));
      index = tableBlock.endIndex;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      rendered.push(...renderHeading(heading[1]?.length ?? 1, heading[2] ?? "", width, useColor));
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      flushParagraph();
      rendered.push(color("─".repeat(Math.min(width, 72)), ansi.dim, useColor));
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      rendered.push(...wrapStyledText(renderInline(quote[1] ?? "", useColor), width, "│ "));
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      rendered.push(...wrapStyledText(renderInline(unordered[1] ?? "", useColor), width, "• ", "  "));
      continue;
    }

    const ordered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      const marker = `${ordered[1] ?? "1"}. `;
      rendered.push(...wrapStyledText(renderInline(ordered[2] ?? "", useColor), width, marker, " ".repeat(visualLength(marker))));
      continue;
    }

    paragraph.push(line.trim());
  }
  flushParagraph();
  if (inCodeBlock) {
    rendered.push(codeBorder("bottom", "", width, useColor));
  }
  return trimOuterBlankLines(rendered).join("\n");
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, "");
}

export function visualLength(value: string): number {
  let total = 0;
  for (const char of stripAnsi(value)) {
    total += char.charCodeAt(0) > 127 ? 2 : 1;
  }
  return total;
}

export function takeAnsiSequence(value: string, index: number): string | undefined {
  const match = value.slice(index).match(/^\x1b\[[0-9;?]*[ -/]*[@-~]/);
  return match?.[0];
}

function renderHeading(level: number, text: string, width: number, useColor: boolean): string[] {
  const clean = renderInline(text.trim(), useColor);
  if (level === 1) {
    return ["", color(clean, `${ansi.bold}${ansi.cyan}`, useColor), ""];
  }
  if (level === 2) {
    const plain = stripAnsi(clean);
    return [
      color(clean, `${ansi.bold}${ansi.blue}`, useColor),
      color("─".repeat(Math.min(width, Math.max(plain.length, 12))), ansi.dim, useColor)
    ];
  }
  return [color(clean, `${ansi.bold}${ansi.green}`, useColor)];
}

function renderInline(value: string, useColor: boolean): string {
  let output = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
  output = output.replace(/`([^`]+)`/g, (_match, code: string) => color(` ${code} `, ansi.inverse, useColor));
  output = output.replace(/\*\*([^*]+)\*\*/g, (_match, text: string) => color(text, ansi.bold, useColor));
  return output;
}

function renderTable(rows: string[][], width: number, useColor: boolean): string[] {
  if (rows.length === 0) {
    return [];
  }
  const columnCount = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_, column) =>
    Math.min(
      32,
      Math.max(
        3,
        ...rows.map((row) => visualLength(row[column] ?? ""))
      )
    )
  );
  return rows.flatMap((row, rowIndex) => {
    const cells = widths.map((cellWidth, column) => padRight(renderInline(row[column] ?? "", useColor), cellWidth));
    const line = cells.join("  ");
    const styled = rowIndex === 0 ? color(line, ansi.bold, useColor) : line;
    return wrapStyledText(styled, width);
  });
}

function collectTableBlock(lines: string[], startIndex: number): { rows: string[][]; endIndex: number } | undefined {
  const first = lines[startIndex] ?? "";
  const second = lines[startIndex + 1] ?? "";
  if (!isTableRow(first) || !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(second)) {
    return undefined;
  }
  const rows: string[][] = [parseTableRow(first)];
  let index = startIndex + 2;
  while (index < lines.length && isTableRow(lines[index] ?? "")) {
    rows.push(parseTableRow(lines[index] ?? ""));
    index += 1;
  }
  return { rows, endIndex: index - 1 };
}

function isTableRow(line: string): boolean {
  return line.includes("|") && line.trim().split("|").filter((cell) => cell.trim()).length >= 2;
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function codeBorder(position: "top" | "bottom", label: string, width: number, useColor: boolean): string {
  const inner = Math.max(12, Math.min(width - 2, 76));
  const title = position === "top" && label ? ` ${label} ` : "";
  const line = position === "top"
    ? `╭${title}${"─".repeat(Math.max(0, inner - title.length))}╮`
    : `╰${"─".repeat(inner)}╯`;
  return color(line, ansi.dim, useColor);
}

function formatCodeLine(line: string, width: number, useColor: boolean): string {
  const inner = Math.max(12, Math.min(width - 4, 74));
  const clipped = visualLength(line) > inner ? `${sliceVisible(line, inner - 1)}…` : line;
  return color("│", ansi.dim, useColor) + ` ${clipped}`;
}

function wrapStyledText(value: string, width: number, firstPrefix = "", restPrefix = firstPrefix): string[] {
  const maxWidth = Math.max(8, width);
  const words = value.split(/(\s+)/).filter((part) => part.length > 0);
  const lines: string[] = [];
  let current = firstPrefix;
  let currentPrefix = firstPrefix;
  for (const word of words) {
    const candidate = current === currentPrefix ? `${current}${word.trimStart()}` : `${current}${word}`;
    if (visualLength(candidate) > maxWidth && current !== currentPrefix) {
      lines.push(current.trimEnd());
      currentPrefix = restPrefix;
      current = `${currentPrefix}${word.trimStart()}`;
      continue;
    }
    current = candidate;
  }
  if (current.trim()) {
    lines.push(current.trimEnd());
  }
  return lines.length ? lines : [firstPrefix.trimEnd()];
}

function sliceVisible(value: string, maxVisible: number): string {
  let output = "";
  let total = 0;
  for (const char of value) {
    const width = char.charCodeAt(0) > 127 ? 2 : 1;
    if (total + width > maxVisible) {
      break;
    }
    total += width;
    output += char;
  }
  return output;
}

function padRight(value: string, width: number): string {
  const length = visualLength(value);
  return length >= width ? value : `${value}${" ".repeat(width - length)}`;
}

function color(value: string, code: string, useColor: boolean): string {
  return useColor ? `${code}${value}${ansi.reset}` : value;
}

function trimOuterBlankLines(lines: string[]): string[] {
  const output = [...lines];
  while (output[0] === "") {
    output.shift();
  }
  while (output.at(-1) === "") {
    output.pop();
  }
  return output;
}

function terminalWidth(): number {
  return Math.max(40, process.stdout.columns ?? 100);
}

function shouldUseColor(): boolean {
  return Boolean(process.stdout.isTTY && process.env["NO_COLOR"] !== "1");
}
