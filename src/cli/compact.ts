export interface CompactTerminalOutputOptions {
  maxLines?: number;
  headLines?: number;
  tailLines?: number;
  maxChars?: number;
  preserveErrorLines?: boolean;
  preserveDiffHunks?: boolean;
  preservePaths?: boolean;
  showOmittedCount?: boolean;
  transcriptHint?: string;
}

export interface CompactTerminalOutputResult {
  text: string;
  omittedLines: number;
  truncated: boolean;
}

const DEFAULT_TRANSCRIPT_HINT = "Press Ctrl+T to view transcript";

export function compactTerminalOutput(
  output: string,
  options: CompactTerminalOutputOptions = {}
): CompactTerminalOutputResult {
  const maxLines = options.maxLines ?? 24;
  const headLines = options.headLines ?? 8;
  const tailLines = options.tailLines ?? 8;
  const maxChars = options.maxChars ?? 8000;
  const showOmittedCount = options.showOmittedCount ?? true;
  const transcriptHint = options.transcriptHint ?? DEFAULT_TRANSCRIPT_HINT;
  const normalized = output.length > maxChars ? output.slice(0, maxChars) : output;
  const charTruncated = output.length > maxChars;
  const lines = normalized.split(/\r?\n/);

  if (lines.length <= maxLines && !charTruncated) {
    return { text: normalized, omittedLines: 0, truncated: false };
  }

  const selected = new Map<number, string>();
  for (let index = 0; index < Math.min(headLines, lines.length); index += 1) {
    selected.set(index, lines[index] ?? "");
  }
  for (let index = Math.max(0, lines.length - tailLines); index < lines.length; index += 1) {
    selected.set(index, lines[index] ?? "");
  }

  const preserved = collectPreservedLines(lines, options);
  for (const index of preserved.slice(0, Math.max(0, maxLines - selected.size))) {
    selected.set(index, lines[index] ?? "");
  }

  const sortedIndexes = [...selected.keys()].sort((a, b) => a - b).slice(0, maxLines);
  const outputLines: string[] = [];
  let previous = -1;
  let omitted = 0;
  for (const index of sortedIndexes) {
    if (previous >= 0 && index > previous + 1) {
      const skipped = index - previous - 1;
      omitted += skipped;
      outputLines.push(omittedLine(skipped, showOmittedCount, transcriptHint));
    }
    outputLines.push(lines[index] ?? "");
    previous = index;
  }
  if (previous < lines.length - 1) {
    const skipped = lines.length - previous - 1;
    omitted += skipped;
    outputLines.push(omittedLine(skipped, showOmittedCount, transcriptHint));
  }
  if (charTruncated) {
    outputLines.push(`... output truncated at ${maxChars} characters. ${transcriptHint}`);
  }

  return {
    text: outputLines.join("\n"),
    omittedLines: omitted,
    truncated: true
  };
}

function collectPreservedLines(lines: string[], options: CompactTerminalOutputOptions): number[] {
  const preserveErrorLines = options.preserveErrorLines ?? true;
  const preserveDiffHunks = options.preserveDiffHunks ?? true;
  const preservePaths = options.preservePaths ?? true;
  const indexes: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (
      (preserveErrorLines && isErrorLike(line)) ||
      (preserveDiffHunks && isDiffLike(line)) ||
      (preservePaths && isPathLike(line))
    ) {
      indexes.push(index);
    }
  }
  return indexes;
}

function omittedLine(count: number, showCount: boolean, hint: string): string {
  return showCount ? `... ${count} lines omitted. ${hint}` : `... omitted. ${hint}`;
}

function isErrorLike(line: string): boolean {
  return /\b(error|failed|failure|exception|traceback|warning|assertion|expected|received)\b/i.test(line);
}

function isDiffLike(line: string): boolean {
  return /^(@@|\+\+\+|---|\+[^+]|-[^-])/.test(line);
}

function isPathLike(line: string): boolean {
  return /(?:[A-Za-z]:\\|\/[\w.-]+\/|[\w./\\-]+\.(?:ts|tsx|js|json|py|md|rs|toml|txt):?\d*)/.test(line);
}
