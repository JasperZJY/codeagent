import type {
  ParsedError,
  TestFixLoopResult,
  ToolExecution,
  ValidationCommandResult
} from "./types.js";
import { parseErrorLog } from "./errorParser.js";

export interface TestFixLoopOptions {
  commands: string[];
  maxFixAttempts?: number;
  runCommand: (command: string, attempt: number) => Promise<ToolExecution>;
  fixAttempt?: (failure: TestFixFailure, attempt: number) => Promise<boolean>;
}

export interface TestFixFailure {
  command: string;
  attempt: number;
  errors: ParsedError[];
  output: string;
}

export async function runTestFixLoop(options: TestFixLoopOptions): Promise<TestFixLoopResult> {
  const maxFixAttempts = options.maxFixAttempts ?? 3;
  const allResults: ValidationCommandResult[] = [];
  let lastErrors: ParsedError[] = [];
  let fixAttempts = 0;

  if (options.commands.length === 0) {
    return {
      status: "warning",
      attempts: 0,
      fixAttempts: 0,
      commands: [],
      errors: [],
      message: "No validation commands were inferred for this workspace.",
      needsUserIntervention: false
    };
  }

  for (let attempt = 0; attempt <= maxFixAttempts; attempt += 1) {
    const failure = await runValidationPass(options.commands, attempt + 1, options.runCommand, allResults);
    if (!failure) {
      return {
        status: "passed",
        attempts: attempt + 1,
        fixAttempts,
        commands: allResults,
        errors: [],
        message: "All inferred validation commands passed.",
        needsUserIntervention: false
      };
    }

    lastErrors = failure.errors;
    if (attempt >= maxFixAttempts) {
      return {
        status: "failed",
        attempts: attempt + 1,
        fixAttempts,
        commands: allResults,
        errors: lastErrors,
        message: `Validation failed after ${maxFixAttempts} fix attempts: ${failure.command}`,
        needsUserIntervention: true
      };
    }

    if (!options.fixAttempt) {
      return {
        status: "blocked",
        attempts: attempt + 1,
        fixAttempts,
        commands: allResults,
        errors: lastErrors,
        message: `Validation failed and no automatic fix callback is available: ${failure.command}`,
        needsUserIntervention: true
      };
    }

    fixAttempts += 1;
    const didAttemptFix = await options.fixAttempt(failure, fixAttempts);
    if (!didAttemptFix) {
      return {
        status: "blocked",
        attempts: attempt + 1,
        fixAttempts,
        commands: allResults,
        errors: lastErrors,
        message: `Validation failed and the planner did not produce a repair action: ${failure.command}`,
        needsUserIntervention: true
      };
    }
  }

  return {
    status: "failed",
    attempts: maxFixAttempts + 1,
    fixAttempts,
    commands: allResults,
    errors: lastErrors,
    message: "Validation failed.",
    needsUserIntervention: true
  };
}

export function shellExecutionSucceeded(execution: ToolExecution): boolean {
  if (!execution.ok) {
    return false;
  }
  if (execution.output && typeof execution.output === "object") {
    const code = (execution.output as Record<string, unknown>)["code"];
    return typeof code === "number" ? code === 0 : true;
  }
  return true;
}

export function shellOutputText(output: unknown): string {
  if (!output || typeof output !== "object") {
    return String(output ?? "");
  }
  const object = output as Record<string, unknown>;
  return [object["stdout"], object["stderr"]]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");
}

async function runValidationPass(
  commands: string[],
  attempt: number,
  runCommand: (command: string, attempt: number) => Promise<ToolExecution>,
  allResults: ValidationCommandResult[]
): Promise<TestFixFailure | undefined> {
  for (const command of commands) {
    const execution = await runCommand(command, attempt);
    const ok = shellExecutionSucceeded(execution);
    const output = shellOutputText(execution.output);
    const errors = ok ? [] : parseErrorLog(output, command);
    const result: ValidationCommandResult = {
      command,
      ok,
      attempt,
      durationMs: execution.durationMs,
      errors,
      outputPreview: compact(output)
    };
    allResults.push(result);
    if (!ok) {
      return {
        command,
        attempt,
        errors,
        output
      };
    }
  }
  return undefined;
}

function compact(value: string, limit = 1200): string {
  const normalized = value.trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
}
