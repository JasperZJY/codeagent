import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listRuntimeProfiles, loadRuntimeConfig } from "../src/core/config.js";

test("loads default and named runtime profiles with apiKeyEnv", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-config-"));
  await writeFile(
    path.join(workspace, ".code-agent.json"),
    JSON.stringify({
      defaultProfile: "ollama",
      profiles: {
        ollama: {
          provider: "openai-compatible",
          baseUrl: "http://localhost:11434/v1",
          apiKey: "ollama",
          model: "qwen3:8b",
          useLlm: true
        },
        deepseek: {
          provider: "deepseek",
          baseUrl: "https://api.deepseek.com",
          apiKeyEnv: "DEEPSEEK_API_KEY",
          model: "deepseek-v4-flash",
          useLlm: true
        }
      },
      permissionMode: "workspace-write"
    }, null, 2),
    "utf8"
  );

  const previousKey = process.env["DEEPSEEK_API_KEY"];
  process.env["DEEPSEEK_API_KEY"] = "sk-test";
  try {
    const defaultConfig = loadRuntimeConfig({ workspaceRoot: workspace });
    assert.equal(defaultConfig.profile, "ollama");
    assert.equal(defaultConfig.model, "qwen3:8b");

    const deepseek = loadRuntimeConfig({ workspaceRoot: workspace, profile: "deepseek" });
    assert.equal(deepseek.profile, "deepseek");
    assert.equal(deepseek.provider, "openai-compatible");
    assert.equal(deepseek.baseUrl, "https://api.deepseek.com");
    assert.equal(deepseek.model, "deepseek-v4-flash");
    assert.equal(deepseek.apiKey, "sk-test");

    const profiles = listRuntimeProfiles(workspace);
    assert.equal(profiles.defaultProfile, "ollama");
    assert.equal(profiles.profiles.some((profile) => profile.name === "deepseek" && profile.apiKeySource === "DEEPSEEK_API_KEY:set"), true);
  } finally {
    if (previousKey === undefined) {
      delete process.env["DEEPSEEK_API_KEY"];
    } else {
      process.env["DEEPSEEK_API_KEY"] = previousKey;
    }
  }
});

test("loads terminal ui config from ui block", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-config-ui-"));
  await writeFile(path.join(workspace, ".code-agent.json"), JSON.stringify({
    ui: {
      dialogBlocks: false,
      showTokenUsage: false,
      summaryMode: "always",
      terminalMode: "scrollback"
    }
  }), "utf8");

  const config = loadRuntimeConfig({ workspaceRoot: workspace });
  assert.equal(config.dialogBlocks, false);
  assert.equal(config.showTokenUsage, false);
  assert.equal(config.summaryMode, "always");
  assert.equal(config.terminalMode, "scrollback");
});

test("explicit endpoint overrides do not inherit default profile endpoint", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-config-override-"));
  await writeFile(
    path.join(workspace, ".code-agent.json"),
    JSON.stringify({
      defaultProfile: "ollama",
      profiles: {
        ollama: {
          provider: "openai-compatible",
          baseUrl: "http://localhost:11434/v1",
          apiKey: "ollama",
          model: "qwen3:8b"
        }
      }
    }),
    "utf8"
  );

  const config = loadRuntimeConfig({
    workspaceRoot: workspace,
    provider: "anthropic",
    apiKey: "anthropic-test"
  });

  assert.equal(config.profile, undefined);
  assert.equal(config.provider, "anthropic");
  assert.equal(config.baseUrl, "https://api.anthropic.com");
  assert.equal(config.model, "claude-sonnet-4-6");
});

test("profile endpoint and model are overridable per profile through env vars", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-config-env-"));
  await writeFile(
    path.join(workspace, ".code-agent.json"),
    JSON.stringify({
      defaultProfile: "ollama",
      profiles: {
        ollama: {
          provider: "openai-compatible",
          baseUrl: "http://localhost:11434/v1",
          baseUrlEnv: "TEST_OLLAMA_BASE_URL",
          model: "qwen3:8b",
          modelEnv: "TEST_OLLAMA_MODEL"
        },
        deepseek: {
          provider: "openai-compatible",
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-chat"
        }
      }
    }),
    "utf8"
  );

  const previousBase = process.env["TEST_OLLAMA_BASE_URL"];
  const previousModel = process.env["TEST_OLLAMA_MODEL"];
  process.env["TEST_OLLAMA_BASE_URL"] = "http://192.168.1.105:11434/v1";
  process.env["TEST_OLLAMA_MODEL"] = "qwen3.6:27b";
  try {
    const local = loadRuntimeConfig({ workspaceRoot: workspace });
    assert.equal(local.baseUrl, "http://192.168.1.105:11434/v1");
    assert.equal(local.model, "qwen3.6:27b");

    // The override belongs to one profile and must not leak into another.
    const remote = loadRuntimeConfig({ workspaceRoot: workspace, profile: "deepseek" });
    assert.equal(remote.baseUrl, "https://api.deepseek.com");
    assert.equal(remote.model, "deepseek-chat");

    const profiles = listRuntimeProfiles(workspace);
    assert.equal(profiles.profiles.find((profile) => profile.name === "ollama")?.baseUrl, "http://192.168.1.105:11434/v1");
  } finally {
    for (const [key, value] of [["TEST_OLLAMA_BASE_URL", previousBase], ["TEST_OLLAMA_MODEL", previousModel]] as const) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("profile falls back to its committed endpoint when the env var is unset", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-config-env-unset-"));
  await writeFile(
    path.join(workspace, ".code-agent.json"),
    JSON.stringify({
      profiles: {
        ollama: {
          provider: "openai-compatible",
          baseUrl: "http://localhost:11434/v1",
          baseUrlEnv: "TEST_UNSET_BASE_URL",
          model: "qwen3:8b",
          modelEnv: "TEST_UNSET_MODEL"
        }
      },
      defaultProfile: "ollama"
    }),
    "utf8"
  );

  const config = loadRuntimeConfig({ workspaceRoot: workspace });
  assert.equal(config.baseUrl, "http://localhost:11434/v1");
  assert.equal(config.model, "qwen3:8b");
});

test("missing runtime profile throws a clear error", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-config-missing-"));
  await writeFile(path.join(workspace, ".code-agent.json"), JSON.stringify({ profiles: {} }), "utf8");

  assert.throws(() => loadRuntimeConfig({ workspaceRoot: workspace, profile: "missing" }), /profile_not_found: missing/);
});
