import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdownForTerminal, stripAnsi } from "../src/cli/markdownRenderer.js";

test("renders first-level heading with ANSI styling", () => {
  const output = renderMarkdownForTerminal("# Title", { useColor: true, width: 80 });
  assert.match(output, /\x1b\[/);
  assert.match(stripAnsi(output), /Title/);
});

test("renders second-level heading with underline", () => {
  const output = renderMarkdownForTerminal("## Section", { useColor: false, width: 40 });
  assert.match(output, /Section/);
  assert.match(output, /────/);
});

test("renders unordered and ordered lists", () => {
  const output = renderMarkdownForTerminal("- one\n1. two", { useColor: false, width: 80 });
  assert.match(output, /• one/);
  assert.match(output, /1\. two/);
});

test("renders inline code and bold text", () => {
  const output = renderMarkdownForTerminal("Use `npm test` and **verify**.", { useColor: true, width: 80 });
  assert.match(output, /\x1b\[7m npm test \x1b\[0m/);
  assert.match(output, /\x1b\[1mverify\x1b\[0m/);
});

test("renders fenced code block with a terminal border", () => {
  const output = renderMarkdownForTerminal("```ts\nconst ok = true;\n```", { useColor: false, width: 80 });
  assert.match(output, /╭ ts/);
  assert.match(output, /│ const ok = true;/);
  assert.match(output, /╰/);
});

test("renders quote block prefix", () => {
  const output = renderMarkdownForTerminal("> quoted text", { useColor: false, width: 80 });
  assert.match(output, /│ quoted text/);
});

test("renders simple markdown tables without throwing", () => {
  const output = renderMarkdownForTerminal("| Name | Value |\n| --- | --- |\n| A | 1 |", { useColor: false, width: 80 });
  assert.match(output, /Name/);
  assert.match(output, /Value/);
  assert.match(output, /A/);
});

test("returns original markdown when disabled", () => {
  const input = "# Raw\n\n- item";
  assert.equal(renderMarkdownForTerminal(input, { enabled: false, useColor: true }), input);
});
