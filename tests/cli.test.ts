import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli/args.js";

test("no-argument CLI starts interactive mode", () => {
  assert.equal(parseArgs([]).action.type, "interactive");
});

test("explicit repl command starts interactive mode", () => {
  assert.equal(parseArgs(["repl"]).action.type, "interactive");
});

test("help command still renders help", () => {
  assert.equal(parseArgs(["help"]).action.type, "help");
});

test("mcp command starts mcp server action", () => {
  assert.equal(parseArgs(["mcp-server"]).action.type, "mcp-server");
  assert.equal(parseArgs(["mcp"]).action.type, "mcp-server");
});

test("parses context compression flags", () => {
  const parsed = parseArgs(["--context-compression=headroom", "--headroom-base-url", "http://localhost:8787"]);
  assert.equal(parsed.overrides.contextCompression, "headroom");
  assert.equal(parsed.overrides.headroomBaseUrl, "http://localhost:8787");
});

test("parses verbose flags", () => {
  assert.equal(parseArgs(["--verbose"]).overrides.verbose, true);
  assert.equal(parseArgs(["--no-verbose"]).overrides.verbose, false);
});

test("parses markdown rendering flags", () => {
  assert.equal(parseArgs(["--markdown"]).overrides.markdown, true);
  assert.equal(parseArgs(["--no-markdown"]).overrides.markdown, false);
});

test("parses terminal UX flags", () => {
  const parsed = parseArgs(["--no-dialog-blocks", "--no-token-usage", "--summary", "off", "--terminal-mode", "scrollback", "--thinking", "verbose"]);
  assert.equal(parsed.overrides.dialogBlocks, false);
  assert.equal(parsed.overrides.showTokenUsage, false);
  assert.equal(parsed.overrides.summaryMode, "off");
  assert.equal(parsed.overrides.terminalMode, "scrollback");
  assert.equal(parsed.overrides.thinkingDisplay, "verbose");
});

test("parses profile flag", () => {
  assert.equal(parseArgs(["--profile", "deepseek"]).overrides.profile, "deepseek");
  assert.equal(parseArgs(["--profile=ollama"]).overrides.profile, "ollama");
});
