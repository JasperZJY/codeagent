import test from "node:test";
import assert from "node:assert/strict";
import { HookManager } from "../src/core/hooks.js";
import { ToolPipeline } from "../src/core/toolPipeline.js";
import type { ToolDefinition } from "../src/core/types.js";

test("tool pipeline runs pre hooks before handler and can deny", async () => {
  const events: string[] = [];
  const hooks = new HookManager();
  hooks.register("preToolUse", () => {
    events.push("pre");
    return { ok: false, action: "deny", reason: "blocked" };
  });
  const tool = fakeTool(() => {
    events.push("handler");
    return "should not run";
  });
  const pipeline = new ToolPipeline({ getTool: () => tool }, hooks);
  const result = await pipeline.executeToolCall(
    { name: "demo", input: {} },
    { permissionMode: "danger-full-access", workspaceRoot: process.cwd() }
  );

  assert.deepEqual(events, ["pre"]);
  assert.equal(result.ok, false);
  assert.equal(result.output, "blocked");
});

test("tool pipeline lets post hooks redact or modify output", async () => {
  const hooks = new HookManager();
  hooks.register("postToolUse", () => ({ ok: true, action: "modify", modifiedOutput: "redacted" }));
  const pipeline = new ToolPipeline({ getTool: () => fakeTool(() => "secret") }, hooks);
  const result = await pipeline.executeToolCall(
    { name: "demo", input: {} },
    { permissionMode: "danger-full-access", workspaceRoot: process.cwd() }
  );

  assert.equal(result.ok, true);
  assert.equal(result.output, "redacted");
});

test("tool pipeline routes handler errors through onToolError", async () => {
  const hooks = new HookManager();
  hooks.register("onToolError", () => ({ ok: false, action: "observe", reason: "clean error" }));
  const pipeline = new ToolPipeline({
    getTool: () => fakeTool(() => {
      throw new Error("raw secret");
    })
  }, hooks);
  const result = await pipeline.executeToolCall(
    { name: "demo", input: {} },
    { permissionMode: "danger-full-access", workspaceRoot: process.cwd() }
  );

  assert.equal(result.ok, false);
  assert.equal(result.output, "clean error");
});

test("tool pipeline normalizes common tool aliases before lookup", async () => {
  const pipeline = new ToolPipeline({
    getTool: (name) => name === "read_file" ? fakeTool((input) => input, "read_file") : undefined
  });
  const result = await pipeline.executeToolCall(
    { name: "file", input: { operation: "read", file_path: "README.md" } },
    { permissionMode: "danger-full-access", workspaceRoot: process.cwd() }
  );

  assert.equal(result.ok, true);
  assert.equal(result.toolName, "read_file");
  assert.deepEqual(result.output, { operation: "read", path: "README.md" });
});

test("tool pipeline returns an actionable fallback for unknown tools", async () => {
  const pipeline = new ToolPipeline({ getTool: () => undefined });
  const result = await pipeline.executeToolCall(
    { name: "does_not_exist", input: {} },
    { permissionMode: "danger-full-access", workspaceRoot: process.cwd() }
  );

  assert.equal(result.ok, false);
  assert.match(String(result.output), /Unknown tool: does_not_exist/);
  assert.match(String(result.output), /read_file/);
  assert.match(String(result.output), /python_exec/);
});

function fakeTool(handler: ToolDefinition["handler"], name = "demo"): ToolDefinition {
  return {
    name,
    description: "Demo tool",
    requiredPermission: "read-only",
    permission: "read",
    risk: "safe",
    inputSchema: { type: "object", required: [] },
    routeHints: [],
    handler
  };
}
