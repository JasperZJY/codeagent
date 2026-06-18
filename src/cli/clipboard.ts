import { spawn } from "node:child_process";

export interface ClipboardResult {
  ok: boolean;
  message: string;
}

export async function writeClipboard(text: string, platform = process.platform): Promise<ClipboardResult> {
  if (process.env["CODE_AGENT_TEST_CLIPBOARD"] === "1") {
    return { ok: true, message: `Copied ${text.length} characters to clipboard.` };
  }
  if (platform === "win32") {
    return await pipeToCommand(text, "powershell.exe", ["-NoProfile", "-Command", "Set-Clipboard"]);
  }
  if (platform === "darwin") {
    return await pipeToCommand(text, "pbcopy", []);
  }
  const wl = await pipeToCommand(text, "wl-copy", []);
  if (wl.ok) {
    return wl;
  }
  const xclip = await pipeToCommand(text, "xclip", ["-selection", "clipboard"]);
  if (xclip.ok) {
    return xclip;
  }
  return {
    ok: false,
    message: "Clipboard command unavailable. Use /copy save to write the content to .code-agent/transcripts/."
  };
}

function pipeToCommand(text: string, command: string, args: string[]): Promise<ClipboardResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ ok: false, message: error.message });
    });
    child.on("close", (code) => {
      resolve(code === 0
        ? { ok: true, message: `Copied ${text.length} characters to clipboard.` }
        : { ok: false, message: stderr.trim() || `${command} exited with code ${code}` });
    });
    child.stdin.end(text, "utf8");
  });
}
