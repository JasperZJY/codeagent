#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./cli/args.js";
import { runRepl } from "./cli/repl.js";
import {
  publicConfig,
  render,
  renderHelp,
  renderMatches,
  renderTurnSummary
} from "./cli/render.js";
import { shouldRenderTerminalMarkdown } from "./cli/markdownRenderer.js";
import { commandCatalog } from "./core/catalog.js";
import { loadRuntimeConfig } from "./core/config.js";
import { routePrompt } from "./core/router.js";
import { AgentRuntime } from "./core/runtime.js";
import type { TurnSummary } from "./core/types.js";
import { runMcpServer } from "./mcp/server.js";
import { toolCatalog } from "./tools/registry.js";
import { parseJsonPayload } from "./utils/json.js";

async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const config = loadRuntimeConfig(parsed.overrides);
  const runtime = new AgentRuntime(config);

  switch (parsed.action.type) {
    case "interactive":
      await runRepl(config);
      return;
    case "help":
      console.log(renderHelp());
      return;
    case "summary":
      console.log(
        render(
          {
            name: "code-agent",
            workspaceRoot: config.workspaceRoot,
            model: config.model,
            permissionMode: config.permissionMode,
            outputFormat: config.outputFormat,
            commands: commandCatalog.length,
            tools: toolCatalog.length
          },
          config.outputFormat
        )
      );
      return;
    case "manifest":
      console.log(
        render(
          {
            commands: commandCatalog,
            tools: toolCatalog
          },
          config.outputFormat
        )
      );
      return;
    case "commands":
      console.log(renderList(commandCatalog, parsed.action.query, parsed.action.limit, config.outputFormat));
      return;
    case "tools":
      console.log(renderList(toolCatalog, parsed.action.query, parsed.action.limit, config.outputFormat));
      return;
    case "route":
      console.log(renderMatches(routePrompt(parsed.action.prompt, parsed.action.limit), config.outputFormat));
      return;
    case "bootstrap": {
      const report = await runtime.bootstrap(parsed.action.prompt, parsed.action.limit);
      console.log(render(report, config.outputFormat));
      applyLlmFailure([report.turn]);
      return;
    }
    case "turn-loop": {
      const turns = await runtime.runTurnLoop(parsed.action.prompt, parsed.action.limit);
      console.log(render(turns, config.outputFormat));
      applyLlmFailure(turns);
      return;
    }
    case "prompt": {
      const turn = await runtime.runTurn(parsed.action.prompt, parsed.action.limit);
      console.log(renderTurnSummary(turn, config.outputFormat, {
        config,
        verbose: Boolean(config.verbose),
        markdown: shouldRenderTerminalMarkdown(config, config.outputFormat),
        useColor: Boolean(process.stdout.isTTY && process.env["NO_COLOR"] !== "1"),
        width: Math.max(40, process.stdout.columns ?? 100)
      }));
      applyLlmFailure([turn]);
      return;
    }
    case "exec-tool": {
      const payload = parseJsonPayload(parsed.action.payload);
      console.log(render(await runtime.execTool(parsed.action.name, payload), config.outputFormat));
      return;
    }
    case "session-list":
      console.log(render(await runtime.listSessions(), config.outputFormat));
      return;
    case "session-load":
      console.log(render(await runtime.loadSession(parsed.action.sessionId), config.outputFormat));
      return;
    case "mcp-server":
      await runMcpServer(config);
      return;
    case "doctor":
      console.log(render(runDoctor(config), config.outputFormat));
      return;
  }
}

/**
 * A fallback answer is still printed, but the process must not report success:
 * scripts and CI have to be able to tell "model answered" from "model was down".
 */
function applyLlmFailure(turns: TurnSummary[]): void {
  const failure = turns.find((turn) => turn.llmFailure !== undefined)?.llmFailure;
  if (failure === undefined) {
    return;
  }
  process.exitCode = 1;
  console.error(`error: llm_unavailable: ${failure}`);
}

function renderList<T extends { name: string; description: string }>(
  values: T[],
  query: string | undefined,
  limit: number,
  outputFormat: "text" | "json" | "markdown"
): string {
  const filtered = query
    ? values.filter((value) =>
        `${value.name} ${value.description}`.toLowerCase().includes(query.toLowerCase())
      )
    : values;
  const selected = filtered.slice(0, limit);
  if (outputFormat === "json") {
    return render({ total: values.length, entries: selected }, outputFormat);
  }
  return [`Entries: ${values.length}`, "", ...selected.map((value) => `- ${value.name}: ${value.description}`)].join("\n");
}

function runDoctor(config: ReturnType<typeof loadRuntimeConfig>) {
  const python = spawnSync("python", ["--version"], { encoding: "utf8" });
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  return {
    status: "ok",
    node: process.version,
    python: python.stdout.trim() || python.stderr.trim() || "unavailable",
    config: publicConfig(config),
    sessionDirectoryReady: existsSync(config.workspaceRoot),
    pythonBridgePresent: existsSync(path.join(projectRoot, "py", "agent_bridge.py"))
  };
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const jsonMode = process.argv.some((arg) => arg === "--output-format=json" || arg === "--output-format" && process.argv[process.argv.indexOf(arg) + 1] === "json");
  if (jsonMode) {
    console.log(JSON.stringify({ type: "error", message }, null, 2));
  } else {
    console.error(`error: ${message}`);
  }
  process.exitCode = 1;
});
