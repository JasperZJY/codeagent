import { stdin, stdout } from "node:process";
import type { Readable, Writable } from "node:stream";
import type { RuntimeConfig } from "../core/types.js";
import { defaultToolRegistry, executeTool } from "../tools/registry.js";

interface JsonRpcMessage {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export async function runMcpServer(config: RuntimeConfig): Promise<void> {
  const transport = new StdioJsonRpcTransport(stdin, stdout, async (message) => {
    const response = await handleMcpMessage(message, config);
    return response;
  });
  await transport.run();
}

export async function handleMcpMessage(
  message: JsonRpcMessage,
  config: RuntimeConfig
): Promise<JsonRpcMessage | undefined> {
  if (!message.id && message.method?.startsWith("notifications/")) {
    return undefined;
  }

  try {
    switch (message.method) {
      case "initialize":
        return result(message.id, {
          protocolVersion: protocolVersion(message.params),
          capabilities: { tools: {} },
          serverInfo: {
            name: "code-agent",
            version: "0.1.0"
          }
        });
      case "tools/list":
        return result(message.id, {
          tools: defaultToolRegistry.schemaForMcp()
        });
      case "tools/call":
        return await callTool(message, config);
      case "ping":
        return result(message.id, {});
      default:
        return error(message.id, -32601, `method not found: ${message.method ?? "<missing>"}`);
    }
  } catch (caught) {
    return error(message.id, -32603, caught instanceof Error ? caught.message : String(caught));
  }
}

async function callTool(message: JsonRpcMessage, config: RuntimeConfig): Promise<JsonRpcMessage> {
  const params = asRecord(message.params);
  const name = typeof params["name"] === "string" ? params["name"] : "";
  const args = asRecord(params["arguments"]);
  if (!name) {
    return error(message.id, -32602, "tools/call requires params.name");
  }
  const execution = await executeTool(name, args, {
    permissionMode: config.permissionMode,
    workspaceRoot: config.workspaceRoot,
    cwd: config.workspaceRoot
  });
  return result(message.id, {
    content: [
      {
        type: "text",
        text: typeof execution.output === "string"
          ? execution.output
          : JSON.stringify(execution.output, null, 2)
      }
    ],
    isError: !execution.ok
  });
}

class StdioJsonRpcTransport {
  private buffer = Buffer.alloc(0);

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
    private readonly handler: (message: JsonRpcMessage) => Promise<JsonRpcMessage | undefined>
  ) {}

  async run(): Promise<void> {
    for await (const chunk of this.input) {
      this.buffer = Buffer.concat([this.buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))]);
      for (;;) {
        const frame = this.readFrame();
        if (!frame) {
          break;
        }
        const message = JSON.parse(frame) as JsonRpcMessage;
        const response = await this.handler(message);
        if (response) {
          this.writeMessage(response);
        }
      }
    }
  }

  private readFrame(): string | undefined {
    const separator = this.buffer.indexOf("\r\n\r\n");
    if (separator < 0) {
      return undefined;
    }
    const header = this.buffer.subarray(0, separator).toString("ascii");
    const contentLength = header
      .split(/\r\n/)
      .map((line) => line.match(/^content-length:\s*(\d+)$/i)?.[1])
      .find(Boolean);
    if (!contentLength) {
      throw new Error("invalid_mcp_frame: missing Content-Length");
    }
    const length = Number(contentLength);
    const bodyStart = separator + 4;
    const bodyEnd = bodyStart + length;
    if (this.buffer.length < bodyEnd) {
      return undefined;
    }
    const body = this.buffer.subarray(bodyStart, bodyEnd).toString("utf8");
    this.buffer = this.buffer.subarray(bodyEnd);
    return body;
  }

  private writeMessage(message: JsonRpcMessage): void {
    const body = JSON.stringify(message);
    this.output.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }
}

function result(id: JsonRpcMessage["id"], payload: unknown): JsonRpcMessage {
  return { jsonrpc: "2.0", id: id ?? null, result: payload } as JsonRpcMessage;
}

function error(id: JsonRpcMessage["id"], code: number, message: string): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message }
  } as JsonRpcMessage;
}

function protocolVersion(params: unknown): string {
  const object = asRecord(params);
  return typeof object["protocolVersion"] === "string" ? object["protocolVersion"] : "2024-11-05";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
