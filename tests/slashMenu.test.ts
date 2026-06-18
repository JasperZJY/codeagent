import test from "node:test";
import assert from "node:assert/strict";
import {
  backSlashMenu,
  completeSlashMenuSelection,
  createSlashMenuState,
  enterSlashMenuSelection,
  filteredSlashMenuItems,
  moveSlashMenuSelection,
  renderSlashMenu,
  updateSlashMenuFilterFromInput
} from "../src/cli/slashMenu.js";
import type { RuntimeConfig } from "../src/core/types.js";

test("slash menu renders root commands", () => {
  const output = renderSlashMenu(createSlashMenuState(), 80);
  const labels = filteredSlashMenuItems(createSlashMenuState()).map((item) => item.label);
  assert.match(output, /Commands/);
  assert.match(output, /python/);
  assert.equal(labels.includes("skills"), true);
});

test("up and down select menu entries", () => {
  let state = createSlashMenuState();
  state = moveSlashMenuSelection(state, 1);
  assert.equal(state.selectedIndex, 1);
  state = moveSlashMenuSelection(state, -1);
  assert.equal(state.selectedIndex, 0);
});

test("enter opens a second-level python menu", () => {
  let state = createSlashMenuState();
  state = updateSlashMenuFilterFromInput("/python", state);
  const entered = enterSlashMenuSelection(state);
  assert.deepEqual(entered.state.path, ["python"]);
  assert.equal(entered.input, "/python ");
  assert.match(renderSlashMenu(entered.state, 80), /run file/);
});

test("backspace helper returns to parent menu", () => {
  const state = enterSlashMenuSelection(updateSlashMenuFilterFromInput("/skills", createSlashMenuState())).state;
  const backed = backSlashMenu(state);
  assert.deepEqual(backed.path, []);
});

test("tab completion returns selected command", () => {
  const python = enterSlashMenuSelection(updateSlashMenuFilterFromInput("/python", createSlashMenuState())).state;
  assert.equal(completeSlashMenuSelection(python), "/python run ");
});

test("keyword filtering narrows menu", () => {
  const state = updateSlashMenuFilterFromInput("/skill", createSlashMenuState());
  const items = filteredSlashMenuItems(state);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.id, "skills");
});

test("single-letter slash filtering prioritizes command labels over descriptions", () => {
  const state = updateSlashMenuFilterFromInput("/s", createSlashMenuState());
  const labels = filteredSlashMenuItems(state).map((item) => item.label);

  assert.deepEqual(labels.slice(0, 5), ["status", "session", "sessions", "skills", "settings"]);
  assert.equal(labels.includes("memory"), false);
  assert.equal(labels.includes("model"), false);
});

test("root menu exposes model and dynamic profile choices", () => {
  let state = updateSlashMenuFilterFromInput("/mo", createSlashMenuState());
  let items = filteredSlashMenuItems(state, fakeConfig());
  assert.equal(items[0]?.id, "model");

  const modelMenu = enterSlashMenuSelection(state, fakeConfig());
  assert.deepEqual(modelMenu.state.path, ["model"]);
  assert.match(renderSlashMenu(modelMenu.state, 80, fakeConfig()), /qwen3:8b/);
  assert.match(renderSlashMenu(modelMenu.state, 80, fakeConfig()), /deepseek/);

  state = updateSlashMenuFilterFromInput("/model deep", modelMenu.state);
  items = filteredSlashMenuItems(state, fakeConfig());
  assert.equal(items[0]?.label, "deepseek");
  assert.equal(enterSlashMenuSelection(state, fakeConfig()).input, "/profile deepseek");
});

test("slash menu redraw preserves selection when filter is unchanged", () => {
  let state = enterSlashMenuSelection(updateSlashMenuFilterFromInput("/model", createSlashMenuState()), fakeConfig()).state;
  state = moveSlashMenuSelection(state, 1, fakeConfig());
  assert.equal(state.selectedIndex, 1);

  state = updateSlashMenuFilterFromInput("/model ", state);
  assert.equal(state.selectedIndex, 1);
  assert.match(renderSlashMenu(state, 80, fakeConfig()), /> deepseek/);
});

function fakeConfig(): RuntimeConfig {
  return {
    workspaceRoot: "E:\\demo",
    profile: "ollama",
    availableProfiles: ["deepseek", "ollama"],
    provider: "openai-compatible",
    model: "qwen3:8b",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    permissionMode: "workspace-write",
    outputFormat: "text",
    maxTurns: 4,
    maxBudgetTokens: 2000,
    useLlm: true
  };
}
