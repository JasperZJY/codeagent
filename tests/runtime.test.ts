import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { fileURLToPath } from "node:url";
import type { Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { AgentRuntime } from "../src/core/runtime.js";
import type { RuntimeConfig } from "../src/core/types.js";

test("runtime reads inferred file and persists session", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-runtime-"));
  await writeFile(path.join(workspace, "README.md"), "# Demo\nhello", "utf8");
  const config: RuntimeConfig = {
    workspaceRoot: workspace,
    provider: "openai-compatible",
    model: "qwen3:8b",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    permissionMode: "workspace-write",
    outputFormat: "json",
    maxTurns: 4,
    maxBudgetTokens: 2000,
    useLlm: false
  };
  const runtime = new AgentRuntime(config);
  const turn = await runtime.runTurn("read README.md", 5);
  assert.equal(turn.stopReason, "completed");
  assert.equal(turn.toolResults.length >= 1, true);
  assert.equal(turn.trace?.some((event) => event.type === "running" && event.label === "route"), true);
  assert.equal(turn.trace?.some((event) => event.type === "ran" && event.label === "read_file"), true);
  assert.equal(turn.trace?.some((event) => event.label === "reflection"), false);
  assert.equal(turn.reflectionDecision?.level, "none");
  assert.equal(turn.turnUsage?.source, "estimated");
  assert.equal(turn.trace?.some((event) => event.type === "ran" && event.label === "save"), true);
  assert.equal((await runtime.getGoals()).some((goal) => goal.status === "done"), true);
  const sessions = await runtime.listSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.sessionId, turn.sessionId);
});

test("runtime loads matching skill workflow for python tasks", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-runtime-skill-"));
  const runtime = new AgentRuntime({
    workspaceRoot: workspace,
    provider: "openai-compatible",
    model: "qwen3:8b",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    permissionMode: "workspace-write",
    outputFormat: "json",
    maxTurns: 4,
    maxBudgetTokens: 2000,
    useLlm: false
  });
  const turn = await runtime.runTurn("write a python script to count project files", 5);
  assert.equal(turn.loadedSkills?.some((skill) => skill.name === "python-data-analysis"), true);
  assert.equal(turn.trace?.some((event) => event.label === "skill"), true);
});

test("runtime does not fabricate generated files when llm is disabled", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-write-turn-"));
  const config: RuntimeConfig = {
    workspaceRoot: workspace,
    provider: "openai-compatible",
    model: "qwen3:8b",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    permissionMode: "workspace-write",
    outputFormat: "json",
    maxTurns: 4,
    maxBudgetTokens: 2000,
    useLlm: false
  };
  const runtime = new AgentRuntime(config);
  const turn = await runtime.runTurn("请给我编写一段N皇后问题的C语言代码保存到 TEST.py", 5);
  assert.equal(turn.stopReason, "completed");
  assert.equal(turn.trace?.some((event) => event.type === "ran" && event.label === "write_file"), false);
  await assert.rejects(() => readFile(path.join(workspace, "TEST.py"), "utf8"));
});

test("runtime executes model-planned write_file actions", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-planned-write-"));
  const server = await startMockOpenAiServer();
  const config: RuntimeConfig = {
    workspaceRoot: workspace,
    provider: "openai-compatible",
    model: "mock-model",
    baseUrl: server.baseUrl,
    apiKey: "test",
    permissionMode: "workspace-write",
    outputFormat: "json",
    maxTurns: 4,
    maxBudgetTokens: 2000,
    useLlm: true
  };

  try {
    const runtime = new AgentRuntime(config);
    const turn = await runtime.runTurn("请生成一个 C 程序保存到 TEST.c", 5);
    assert.equal(turn.stopReason, "completed");
    assert.equal(turn.trace?.some((event) => event.type === "ran" && event.label === "planner" && event.ok), true);
    assert.equal(turn.trace?.some((event) => event.type === "ran" && event.label === "write_file" && event.ok), true);
    assert.equal(turn.turnUsage?.source, "api");
    assert.equal(turn.turnUsage?.inputTokens, 30);
    assert.equal(turn.turnUsage?.outputTokens, 5);
    assert.equal(turn.llmFailure, undefined);
    assert.equal(await readFile(path.join(workspace, "TEST.c"), "utf8"), "int main(void) { return 0; }\n");
  } finally {
    await server.close();
  }
});

test("runtime executes labeled write_file text from planner and creates local file", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-labeled-write-"));
  const server = await startLabeledWriteOpenAiServer();
  const runtime = new AgentRuntime({
    workspaceRoot: workspace,
    provider: "openai-compatible",
    model: "mock-model",
    baseUrl: server.baseUrl,
    apiKey: "test",
    permissionMode: "workspace-write",
    outputFormat: "json",
    maxTurns: 4,
    maxBudgetTokens: 2000,
    useLlm: true
  });

  try {
    const turn = await runtime.runTurn("你给我保存在我的demo01.py文件里面，如果不存在创建一个", 5);
    assert.equal(turn.trace?.some((event) => event.type === "ran" && event.label === "write_file" && event.ok), true);
    assert.equal(await readFile(path.join(workspace, "demo01.py"), "utf8"), "print(1)\n");
  } finally {
    await server.close();
  }
});

test("runtime returns when llm request times out", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-llm-timeout-"));
  const server = await startHangingOpenAiServer();
  const runtime = new AgentRuntime({
    workspaceRoot: workspace,
    provider: "openai-compatible",
    model: "slow-model",
    baseUrl: server.baseUrl,
    apiKey: "test",
    permissionMode: "workspace-write",
    outputFormat: "json",
    maxTurns: 4,
    maxBudgetTokens: 2000,
    llmTimeoutMs: 50,
    useLlm: true
  });

  try {
    const turn = await runtime.runTurn("hello", 5);
    const block = turn.assistantMessages[0]?.blocks[0];
    assert.equal(turn.stopReason, "completed");
    assert.equal(block?.type, "text");
    assert.match(block?.type === "text" ? block.text : "", /LLM unavailable: request timed out after 50ms/);
    assert.match(turn.llmFailure ?? "", /request timed out after 50ms/);
  } finally {
    await server.close();
  }
});

test("runtime treats streaming llm timeout as idle timeout", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-stream-idle-timeout-"));
  const server = await startDelayedStreamingOpenAiServer([
    { choices: [{ delta: { content: "part one " } }] },
    { choices: [{ delta: { content: "part two" } }] }
  ], 35);
  const runtime = new AgentRuntime({
    workspaceRoot: workspace,
    provider: "openai-compatible",
    model: "streaming-model",
    baseUrl: server.baseUrl,
    apiKey: "test",
    permissionMode: "workspace-write",
    outputFormat: "json",
    maxTurns: 4,
    maxBudgetTokens: 2000,
    llmTimeoutMs: 50,
    useLlm: true
  });
  const streamed: string[] = [];

  try {
    const turn = await runtime.runTurn("hello", 5, { onTextDelta: (delta) => streamed.push(delta) });
    const text = turn.assistantMessages
      .flatMap((message) => message.blocks)
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    assert.equal(text, "part one part two");
    assert.equal(streamed.join(""), "part one part two");
  } finally {
    await server.close();
  }
});

test("runtime answers simple current date questions without model or tools", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-date-fast-path-"));
  const server = await startHangingOpenAiServer();
  const runtime = new AgentRuntime({
    workspaceRoot: workspace,
    provider: "openai-compatible",
    model: "slow-model",
    baseUrl: server.baseUrl,
    apiKey: "test",
    permissionMode: "danger-full-access",
    outputFormat: "json",
    maxTurns: 4,
    maxBudgetTokens: 2000,
    llmTimeoutMs: 50,
    useLlm: true
  });
  const now = new Date();
  const expectedDate = `今天是${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

  try {
    const turn = await runtime.runTurn("\u4eca\u5929\u662f\u51e0\u6708\u51e0\u65e5", 5);
    const block = turn.assistantMessages[0]?.blocks[0];
    assert.equal(turn.stopReason, "completed");
    assert.equal(turn.toolResults.length, 0);
    assert.equal(turn.trace?.some((event) => event.label === "fast_path" && event.detail === "local_current_date"), true);
    assert.equal(turn.trace?.some((event) => event.label === "llm"), false);
    assert.match(block?.type === "text" ? block.text : "", new RegExp(expectedDate));
  } finally {
    await server.close();
  }
});

test("runtime stops streams that only emit reasoning before the idle timeout can refresh forever", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-reasoning-hard-timeout-"));
  const server = await startEndlessReasoningOpenAiServer(20);
  const runtime = new AgentRuntime({
    workspaceRoot: workspace,
    provider: "openai-compatible",
    model: "reasoning-loop",
    baseUrl: server.baseUrl,
    apiKey: "test",
    permissionMode: "workspace-write",
    outputFormat: "json",
    maxTurns: 4,
    maxBudgetTokens: 2000,
    llmTimeoutMs: 50,
    useLlm: true
  });

  try {
    const turn = await runtime.runTurn("hello", 5);
    const text = turn.assistantMessages
      .flatMap((message) => message.blocks)
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    assert.match(text, /request exceeded maximum duration after 150ms/);
    assert.equal(turn.trace?.some((event) => event.label === "thinking"), true);
  } finally {
    await server.close();
  }
});

test("runtime executes simple delete file prompt through deterministic fast path", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-fast-delete-"));
  await writeFile(path.join(workspace, "tmp_secret_test.txt"), "remove me", "utf8");
  const server = await startHangingOpenAiServer();
  const runtime = new AgentRuntime({
    workspaceRoot: workspace,
    provider: "openai-compatible",
    model: "slow-model",
    baseUrl: server.baseUrl,
    apiKey: "test",
    permissionMode: "workspace-write",
    outputFormat: "json",
    maxTurns: 4,
    maxBudgetTokens: 2000,
    llmTimeoutMs: 50,
    useLlm: true
  });

  try {
    const turn = await runtime.runTurn("delete tmp_secret_test.txt", 5);
    assert.equal(turn.stopReason, "completed");
    assert.equal(turn.trace?.some((event) => event.label === "fast_path"), true);
    assert.equal(turn.trace?.some((event) => event.label === "planner"), false);
    assert.equal(turn.trace?.some((event) => event.label === "llm"), false);
    assert.equal(turn.trace?.some((event) => event.type === "ran" && event.label === "delete_file" && event.ok), true);
    assert.equal(turn.loadedSkills, undefined);
    const block = turn.assistantMessages[0]?.blocks[0];
    assert.match(block?.type === "text" ? block.text : "", /Deleted/);
    await assert.rejects(() => readFile(path.join(workspace, "tmp_secret_test.txt"), "utf8"));
  } finally {
    await server.close();
  }
});

test("runtime folds streaming reasoning content into thinking trace", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-thinking-stream-"));
  const server = await startStreamingOpenAiServer([
    { choices: [{ delta: { reasoning_content: "private reasoning step" } }] },
    { choices: [{ delta: { content: "Visible answer." } }] },
    { choices: [], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } }
  ]);
  const runtime = new AgentRuntime({
    workspaceRoot: workspace,
    provider: "openai-compatible",
    model: "reasoning-model",
    baseUrl: server.baseUrl,
    apiKey: "test",
    permissionMode: "workspace-write",
    outputFormat: "json",
    maxTurns: 4,
    maxBudgetTokens: 2000,
    useLlm: true
  });
  const streamed: string[] = [];

  try {
    const turn = await runtime.runTurn("hello", 5, { onTextDelta: (delta) => streamed.push(delta) });
    const text = turn.assistantMessages
      .flatMap((message) => message.blocks)
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    assert.equal(text, "Visible answer.");
    assert.equal(streamed.join(""), "Visible answer.");
    assert.equal(turn.trace?.some((event) => event.label === "thinking"), true);
    assert.equal(JSON.stringify(turn).includes("private reasoning step"), false);
  } finally {
    await server.close();
  }
});

test("runtime strips qwen style think tags from streamed visible text", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-thinking-tags-"));
  const server = await startStreamingOpenAiServer([
    { choices: [{ delta: { content: "<thi" } }] },
    { choices: [{ delta: { content: "nk>hidden chain</think>Answer" } }] }
  ]);
  const runtime = new AgentRuntime({
    workspaceRoot: workspace,
    provider: "openai-compatible",
    model: "qwen3:8b",
    baseUrl: server.baseUrl,
    apiKey: "test",
    permissionMode: "workspace-write",
    outputFormat: "json",
    maxTurns: 4,
    maxBudgetTokens: 2000,
    useLlm: true
  });
  const streamed: string[] = [];

  try {
    const turn = await runtime.runTurn("hello", 5, { onTextDelta: (delta) => streamed.push(delta) });
    assert.equal(streamed.join(""), "Answer");
    assert.equal(JSON.stringify(turn).includes("hidden chain"), false);
    assert.equal(turn.trace?.some((event) => event.label === "thinking"), true);
  } finally {
    await server.close();
  }
});

test("runtime web_search reads API keys from project .env when workspace differs", async () => {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-web-env-"));
  const envPath = path.join(projectRoot, ".env");
  const previousEnv = await readFile(envPath, "utf8").catch(() => undefined);
  const previousBaiduKey = process.env["BAIDU_AI_SEARCH_API_KEY"];
  const previousSearchKey = process.env["CODE_AGENT_WEB_SEARCH_API_KEY"];
  const previousProvider = process.env["CODE_AGENT_WEB_SEARCH_PROVIDER"];
  delete process.env["BAIDU_AI_SEARCH_API_KEY"];
  delete process.env["CODE_AGENT_WEB_SEARCH_API_KEY"];
  delete process.env["CODE_AGENT_WEB_SEARCH_PROVIDER"];

  try {
    await writeFile(envPath, "CODE_AGENT_WEB_SEARCH_PROVIDER=mock\nBAIDU_AI_SEARCH_API_KEY=from-project-env\n", "utf8");
    const runtime = new AgentRuntime({
      workspaceRoot: workspace,
      provider: "openai-compatible",
      model: "qwen3:8b",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "ollama",
      permissionMode: "workspace-write",
      outputFormat: "json",
      maxTurns: 4,
      maxBudgetTokens: 2000,
      useLlm: false
    });

    const result = await runtime.execTool("web_search", { query: "今天有什么新闻" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.output, {
      provider: "mock",
      query: "今天有什么新闻",
      result: "Mock search result for 今天有什么新闻"
    });
  } finally {
    if (previousEnv === undefined) {
      await rmIfExists(envPath);
    } else {
      await writeFile(envPath, previousEnv, "utf8");
    }
    restoreEnv("BAIDU_AI_SEARCH_API_KEY", previousBaiduKey);
    restoreEnv("CODE_AGENT_WEB_SEARCH_API_KEY", previousSearchKey);
    restoreEnv("CODE_AGENT_WEB_SEARCH_PROVIDER", previousProvider);
  }
});

test("runtime executes JSON tool calls emitted as assistant text", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "code-agent-text-tool-call-"));
  const previousProvider = process.env["CODE_AGENT_WEB_SEARCH_PROVIDER"];
  process.env["CODE_AGENT_WEB_SEARCH_PROVIDER"] = "mock";
  const server = await startSequentialStreamingOpenAiServer([
    [
      { choices: [{ delta: { content: "```json\n[" } }] },
      { choices: [{ delta: { content: "{\"name\":\"web_search\",\"arguments\":{\"query\":\"今天有什么新闻\"}}]" } }] },
      { choices: [{ delta: { content: "\n```" } }] }
    ],
    [{ choices: [{ delta: { content: "今天的新闻摘要：测试搜索结果。" } }] }]
  ]);
  const runtime = new AgentRuntime({
    workspaceRoot: workspace,
    provider: "openai-compatible",
    model: "qwen3:8b",
    baseUrl: server.baseUrl,
    apiKey: "test",
    permissionMode: "workspace-write",
    outputFormat: "json",
    maxTurns: 4,
    maxBudgetTokens: 2000,
    useLlm: true
  });
  const streamed: string[] = [];

  try {
    const turn = await runtime.runTurn("帮我回答", 5, { onTextDelta: (delta) => streamed.push(delta) });
    const answer = turn.assistantMessages.flatMap((message) => message.blocks).find((block) => block.type === "text");
    assert.equal(answer?.type === "text" ? answer.text : "", "今天的新闻摘要：测试搜索结果。");
    assert.equal(streamed.join(""), "今天的新闻摘要：测试搜索结果。");
    assert.equal(streamed.join("").includes("web_search"), false);
    assert.equal(turn.trace?.some((event) => event.label === "tool_text_plan"), true);
    assert.equal(turn.toolResults.some((message) => message.blocks.some((block) => block.type === "tool_result" && block.toolName === "web_search")), true);
  } finally {
    if (previousProvider === undefined) {
      delete process.env["CODE_AGENT_WEB_SEARCH_PROVIDER"];
    } else {
      process.env["CODE_AGENT_WEB_SEARCH_PROVIDER"] = previousProvider;
    }
    await server.close();
  }
});

async function rmIfExists(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function startMockOpenAiServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  let plannerCalls = 0;
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      const systemPrompt = body.messages?.[0]?.content ?? "";
      const content = systemPrompt.includes("coordinator router")
        ? JSON.stringify({ intent: "write_file", strategy: "react", tools: ["write_file"], reason: "create file" })
        : systemPrompt.includes("planning layer")
          ? plannerResponse(plannerCalls++)
          : "已写入 `TEST.c`。";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function startLabeledWriteOpenAiServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  let plannerCalls = 0;
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      const systemPrompt = body.messages?.[0]?.content ?? "";
      const content = systemPrompt.includes("coordinator router")
        ? JSON.stringify({ intent: "write_file", strategy: "react", tools: ["write_file"], reason: "create file" })
        : systemPrompt.includes("planning layer")
          ? labeledWritePlannerResponse(plannerCalls++)
          : "已写入 demo01.py。";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function startHangingOpenAiServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const server = http.createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "content-type": "application/json" });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve, reject) => {
      for (const socket of sockets) {
        socket.destroy();
      }
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

async function startStreamingOpenAiServer(chunks: unknown[]): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return await startSequentialStreamingOpenAiServer([chunks]);
}

async function startDelayedStreamingOpenAiServer(
  chunks: unknown[],
  delayMs: number
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(async (request, response) => {
    request.resume();
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache"
    });
    for (const chunk of chunks) {
      response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      await delay(delayMs);
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function startEndlessReasoningOpenAiServer(delayMs: number): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const timers = new Set<ReturnType<typeof setInterval>>();
  const server = http.createServer((request, response) => {
    request.resume();
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache"
    });
    const timer = setInterval(() => {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "thinking" } }] })}\n\n`);
    }, delayMs);
    timers.add(timer);
    response.on("close", () => {
      clearInterval(timer);
      timers.delete(timer);
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve, reject) => {
      for (const timer of timers) {
        clearInterval(timer);
      }
      for (const socket of sockets) {
        socket.destroy();
      }
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

async function startSequentialStreamingOpenAiServer(responses: unknown[][]): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  let call = 0;
  const server = http.createServer((request, response) => {
    request.resume();
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache"
    });
    const chunks = responses[Math.min(call, responses.length - 1)] ?? [];
    call += 1;
    for (const chunk of chunks) {
      response.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

function labeledWritePlannerResponse(call: number): string {
  if (call === 0) {
    return 'Tool use write_file: {"file_path":"demo01.py","content":"print(1)\\n"}';
  }
  return JSON.stringify({ actions: [], final: "file written" });
}

function plannerResponse(call: number): string {
  if (call === 0) {
    return JSON.stringify({
      actions: [
        {
          tool: "write_file",
          input: {
            path: "TEST.c",
            content: "int main(void) { return 0; }\n"
          },
          reason: "create requested file"
        }
      ]
    });
  }
  return JSON.stringify({ actions: [], final: "file written" });
}
