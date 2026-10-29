import test from "node:test";
import assert from "node:assert/strict";
import { parseKeepMessages, parseSlashCommand, slashCommandHelp, suggestSlashCommands } from "../src/cli/slash.js";
import { slashMenuRoot, type SlashMenuItem } from "../src/cli/slashMenu.js";
import { registeredSlashCommands } from "../src/cli/slashDispatcher.js";

test("parses slash command aliases and args", () => {
  const command = parseSlashCommand("/compress 4");
  assert.ok(command);
  assert.equal(command.name, "compact");
  assert.deepEqual(command.args, ["4"]);
  assert.equal(parseKeepMessages(command), 4);
});

test("ignores non-slash prompt input", () => {
  assert.equal(parseSlashCommand("read README.md"), undefined);
});

test("empty slash input parses to unknown fallback instead of help", () => {
  const command = parseSlashCommand("/");
  assert.ok(command);
  assert.equal(command.name, "unknown");
  assert.equal(command.rawName, "");
});

test("rejects invalid compact keep count", () => {
  const command = parseSlashCommand("/compact nope");
  assert.ok(command);
  assert.throws(() => parseKeepMessages(command), /invalid_compact_keep/);
});

test("suggests slash commands while typing command prefix", () => {
  const suggestions = suggestSlashCommands("/co");
  assert.equal(suggestions[0]?.usage, "/compact [keep]");
  assert.equal(suggestSlashCommands("/per")[0]?.usage, "/permissions [mode]");
  assert.equal(suggestSlashCommands("/re")[0]?.usage, "/resume [selector]");
  assert.equal(suggestSlashCommands("read README.md").length, 0);
  assert.equal(suggestSlashCommands("/compact 4").length, 0);
});

test("parses new project intelligence slash commands", () => {
  assert.equal(parseSlashCommand("/goals")?.name, "goals");
  assert.equal(parseSlashCommand("/memory recovery")?.name, "memory");
  assert.equal(parseSlashCommand("/rag search planner")?.name, "rag");
  assert.equal(parseSlashCommand("/python run demo.py")?.name, "python");
  assert.equal(parseSlashCommand("/py exec print(1)")?.name, "python");
  assert.equal(parseSlashCommand("/skills list")?.name, "skills");
  assert.equal(parseSlashCommand("/skill use python-data-analysis")?.name, "skills");
});

test("parses verbose and transcript slash commands", () => {
  assert.equal(parseSlashCommand("/profile deepseek")?.name, "profile");
  assert.equal(parseSlashCommand("/profiles")?.name, "profile");
  assert.equal(parseSlashCommand("/prof list")?.name, "profile");
  assert.equal(parseSlashCommand("/verbose on")?.name, "verbose");
  assert.equal(parseSlashCommand("/debug off")?.name, "verbose");
  assert.equal(parseSlashCommand("/markdown off")?.name, "markdown");
  assert.equal(parseSlashCommand("/md on")?.name, "markdown");
  assert.equal(parseSlashCommand("/transcript all")?.name, "transcript");
  assert.equal(parseSlashCommand("/t")?.name, "transcript");
  assert.equal(parseSlashCommand("/dialog-blocks off")?.name, "dialog-blocks");
  assert.equal(parseSlashCommand("/thinking verbose")?.name, "thinking");
  assert.equal(parseSlashCommand("/think off")?.name, "thinking");
  assert.equal(parseSlashCommand("/timeout 5000")?.name, "timeout");
  assert.equal(parseSlashCommand("/summary auto")?.name, "summary");
  assert.equal(parseSlashCommand("/terminal-mode scrollback")?.name, "terminal-mode");
  assert.equal(parseSlashCommand("/copy last")?.name, "copy");
  assert.equal(parseSlashCommand("/tokens show off")?.name, "tokens");
});

test("parses git safety slash commands", () => {
  assert.equal(parseSlashCommand("/diff")?.name, "diff");
  assert.equal(parseSlashCommand("/changes")?.name, "changes");
  assert.equal(parseSlashCommand("/checkpoint")?.name, "checkpoint");
  assert.equal(parseSlashCommand("/revert")?.name, "revert");
  assert.equal(parseSlashCommand("/rollback")?.name, "revert");
  assert.equal(parseSlashCommand("/commit-msg")?.name, "commit-msg");
  assert.equal(parseSlashCommand("/commitmsg")?.name, "commit-msg");
  const risk = parseSlashCommand("/risk rm -rf dist");
  assert.equal(risk?.name, "risk");
  assert.equal(risk?.rawArgs, "rm -rf dist");
});

test("parses task plan slash commands", () => {
  assert.equal(parseSlashCommand("/plan")?.name, "plan");
  assert.equal(parseSlashCommand("/todo")?.name, "todo");
  assert.equal(parseSlashCommand("/tasks")?.name, "todo");
  assert.equal(parseSlashCommand("/task add implement validation")?.name, "task");
  assert.equal(parseSlashCommand("/task done T1")?.name, "task");
  assert.equal(parseSlashCommand("/task block T2")?.name, "task");
  assert.equal(parseSlashCommand("/task reset")?.name, "task");
  assert.equal(parseSlashCommand("/resume-task")?.name, "resume-task");
});

test("parses stage 3 project context slash commands", () => {
  assert.equal(parseSlashCommand("/init")?.name, "init");
  assert.equal(parseSlashCommand("/context")?.name, "context");
  assert.equal(parseSlashCommand("/ctx")?.name, "context");
  assert.equal(parseSlashCommand("/tokens")?.name, "tokens");
  assert.equal(parseSlashCommand("/token")?.name, "tokens");
  assert.equal(parseSlashCommand("/cost")?.name, "cost");
});

test("slash help and menu commands all parse to known handlers", () => {
  for (const entry of slashCommandHelp) {
    const command = entry.usage.split(/\s+/, 1)[0] ?? "";
    const parsed = parseSlashCommand(command);
    assert.ok(parsed, `help command should parse: ${command}`);
    assert.notEqual(parsed?.name, "unknown", `help command should parse: ${command}`);
    if (parsed.name !== "unknown") {
      assert.equal(registeredSlashCommands().includes(parsed.name), true, `help command should have handler: ${command}`);
    }
  }

  for (const command of menuCommands(slashMenuRoot)) {
    const parsed = parseSlashCommand(command.trim());
    assert.ok(parsed, `menu command should parse: ${command}`);
    assert.notEqual(parsed?.name, "unknown", `menu command should parse: ${command}`);
    if (parsed.name !== "unknown") {
      assert.equal(registeredSlashCommands().includes(parsed.name), true, `menu command should have handler: ${command}`);
    }
  }
});

function menuCommands(items: SlashMenuItem[]): string[] {
  return items.flatMap((item) => [
    ...(item.command?.startsWith("/") ? [item.command] : []),
    ...(item.children ? menuCommands(item.children) : [])
  ]);
}
