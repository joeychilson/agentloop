/* eslint-disable no-await-in-loop */
import type { Content, ToolCallPart, ToolResultPart } from "./content.ts";
import { text } from "./content.ts";
import type { RunContext, ToolContext } from "./context.ts";
import type { EmitFn } from "./emit.ts";
import type {
  ErrorEvent,
  ToolRunEndEvent,
  ToolRunStartEvent,
  ToolRunUpdateEvent,
  ToolSkipEvent,
} from "./observer.ts";
import type {
  AfterToolRunAction,
  BeforeToolRunAction,
  Policy,
  ToolCallInfo,
  ToolResultInfo,
} from "./policy.ts";
import type { Tool } from "./tool.ts";
import { normalizeToolReturn } from "./tool.ts";
import { runPolicies } from "./pipeline.ts";

/** Internal result from executing a single tool call. */
interface ToolExecResult {
  output: Content[];
  isError: boolean;
  stopRun?: string;
}

/**
 * Execute all tool calls from a model response in parallel.
 *
 * Returns assembled {@link ToolResultPart} entries (one per call, preserving
 * call order) and an optional `stopRun` policy name if any tool or policy
 * signaled a stop.
 */
export async function executeToolCalls(
  calls: ToolCallPart[],
  toolMap: Map<string, Tool>,
  policies: Policy[],
  ctx: RunContext,
  emit: EmitFn,
): Promise<{ results: ToolResultPart[]; stopRun?: string }> {
  const promises = calls.map((call) => {
    const tool = toolMap.get(call.name);
    if (tool === undefined) {
      emit({
        type: "error",
        ...base(ctx),
        error: new Error(`Tool "${call.name}" is not available`),
        source: "tool",
        toolCall: call,
      } satisfies ErrorEvent);
      return Promise.resolve<ToolExecResult>({
        output: [
          text(
            `Tool "${call.name}" is not available. Available tools: ${[...toolMap.keys()].join(", ")}`,
          ),
        ],
        isError: true,
      });
    }
    return executeTool(call, tool, policies, ctx, emit);
  });

  const settled = await Promise.all(promises);

  let stopRun: string | undefined;
  const results: ToolResultPart[] = [];

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i]!;
    const exec = settled[i]!;

    results.push({
      type: "tool_result",
      id: call.id,
      name: call.name,
      output: exec.output,
      isError: exec.isError ? true : undefined,
    });

    if (exec.stopRun !== undefined && stopRun === undefined) {
      stopRun = exec.stopRun;
    }
  }

  return { results, stopRun };
}

async function executeTool(
  call: ToolCallPart,
  tool: Tool,
  policies: Policy[],
  ctx: RunContext,
  emit: EmitFn,
): Promise<ToolExecResult> {
  const callInfo: ToolCallInfo = {
    id: call.id,
    name: call.name,
    arguments: { ...call.arguments },
  };

  const beforePol = await runPolicies<BeforeToolRunAction>(policies, (p) =>
    p.beforeToolRun?.(ctx, callInfo),
  );

  if (beforePol != null) {
    if (beforePol.error) {
      emitError(emit, ctx, beforePol.error, "policy", call, beforePol.policy);
    }
    emitSkip(emit, ctx, call, beforePol.action.action, "policy", beforePol.action.reason);
    return {
      output: beforePol.action.output ?? [],
      isError: false,
      stopRun: beforePol.action.action === "stop" ? beforePol.policy : undefined,
    };
  }

  const parsed = tool.schema.safeParse(callInfo.arguments);
  if (!parsed.success) {
    const msg = `Invalid arguments for tool "${tool.name}": ${String(parsed.error)}`;
    emitError(emit, ctx, new Error(msg), "validation", call);
    return { output: [text(msg)], isError: true };
  }

  try {
    const beforeAction = await tool.before?.(parsed.data, ctx);
    if (beforeAction != null) {
      emitSkip(emit, ctx, call, beforeAction.action, "tool", beforeAction.reason);
      return {
        output: beforeAction.output ?? [],
        isError: false,
        stopRun: beforeAction.action === "stop" ? tool.name : undefined,
      };
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    emitError(emit, ctx, error, "tool", call);
    return {
      output: [text(`Error in "${tool.name}" before hook: ${error.message}`)],
      isError: true,
    };
  }

  const execStart = Date.now();

  emit({
    type: "toolRunStart",
    ...base(ctx),
    id: call.id,
    name: call.name,
    arguments: callInfo.arguments,
  } satisfies ToolRunStartEvent);

  let output: Content[] = [];
  let error: Error | undefined;
  let stopRun: string | undefined;
  let currentArgs: unknown = parsed.data;
  for (;;) {
    const toolSignal =
      tool.timeout !== undefined
        ? AbortSignal.any([ctx.signal, AbortSignal.timeout(tool.timeout)])
        : ctx.signal;

    const toolCtx: ToolContext = {
      ...ctx,
      signal: toolSignal,
      id: call.id,
      update(data) {
        emit({
          type: "toolRunUpdate",
          ...base(ctx),
          id: call.id,
          name: call.name,
          data,
        } satisfies ToolRunUpdateEvent);
      },
    };

    try {
      const raw = await raceAbort((async () => tool.execute(currentArgs, toolCtx))(), toolSignal);
      output = normalizeToolReturn(raw);
      error = undefined;
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      output = [text(`Error in tool "${tool.name}": ${error.message}`)];
      emitError(emit, ctx, error, "tool", call);
    }

    let shouldRetry = false;

    if (tool.after !== undefined) {
      try {
        const action = await tool.after(currentArgs, output, ctx);
        if (action != null) {
          const r = applyAfterAction(action, tool, currentArgs);
          if (r.output !== undefined) {
            output = r.output;
            error = undefined;
          }
          if (r.retry) {
            currentArgs = r.nextArgs;
            stopRun = undefined;
            shouldRetry = true;
          }
          if (r.stop) {
            stopRun = tool.name;
          }
          if (r.validationError) {
            error = r.validationError;
            output = [text(error.message)];
            break;
          }
        }
      } catch (err) {
        emitError(emit, ctx, err instanceof Error ? err : new Error(String(err)), "tool", call);
      }
    }

    if (shouldRetry) continue;

    const resultInfo: ToolResultInfo = {
      id: call.id,
      name: call.name,
      arguments: callInfo.arguments,
      output,
      isError: error !== undefined,
    };

    const afterPol = await runPolicies<AfterToolRunAction>(policies, (p) =>
      p.afterToolRun?.(ctx, resultInfo),
    );

    if (afterPol != null) {
      if (afterPol.error) {
        emitError(emit, ctx, afterPol.error, "policy", call, afterPol.policy);
      }
      const r = applyAfterAction(afterPol.action, tool, currentArgs);
      if (r.output !== undefined) {
        output = r.output;
        error = undefined;
      }
      if (r.retry) {
        currentArgs = r.nextArgs;
        stopRun = undefined;
        continue;
      }
      if (r.stop) {
        stopRun = afterPol.policy;
      }
      if (r.validationError) {
        error = r.validationError;
        output = [text(error.message)];
        break;
      }
    }

    break;
  }

  emit({
    type: "toolRunEnd",
    ...base(ctx),
    id: call.id,
    name: call.name,
    output,
    error,
    duration: Date.now() - execStart,
  } satisfies ToolRunEndEvent);

  return { output, isError: error !== undefined, stopRun };
}

/** Shared result of interpreting an {@link AfterToolRunAction}. */
interface AfterActionResult {
  output?: Content[];
  retry: boolean;
  nextArgs: unknown;
  stop: boolean;
  validationError?: Error;
}

/**
 * Interpret an {@link AfterToolRunAction} from either `tool.after` or
 * `policy.afterToolRun`. Handles rewrite, retry (with optional re-validation),
 * and stop uniformly so the two call sites stay DRY.
 */
function applyAfterAction(
  action: AfterToolRunAction,
  tool: Tool,
  currentArgs: unknown,
): AfterActionResult {
  switch (action.action) {
    case "rewrite":
      return { output: action.output, retry: false, nextArgs: currentArgs, stop: false };

    case "retry": {
      if (action.arguments !== undefined) {
        const reparsed = tool.schema.safeParse(action.arguments);
        if (!reparsed.success) {
          return {
            retry: false,
            nextArgs: currentArgs,
            stop: false,
            validationError: new Error(
              `Invalid retry arguments for "${tool.name}": ${String(reparsed.error)}`,
            ),
          };
        }
        return { retry: true, nextArgs: reparsed.data, stop: false };
      }
      return { retry: true, nextArgs: currentArgs, stop: false };
    }

    case "stop":
      return { retry: false, nextArgs: currentArgs, stop: true };
  }
}

/** Create the base fields shared by all observer events. */
function base(ctx: RunContext) {
  return { runId: ctx.runId, step: ctx.step, agent: ctx.agent, timestamp: Date.now() };
}

/** Emit an {@link ErrorEvent}. */
function emitError(
  emit: EmitFn,
  ctx: RunContext,
  error: Error,
  source: ErrorEvent["source"],
  toolCall?: ToolCallPart,
  policy?: string,
): void {
  emit({ type: "error", ...base(ctx), error, source, toolCall, policy } satisfies ErrorEvent);
}

/** Emit a {@link ToolSkipEvent}. */
function emitSkip(
  emit: EmitFn,
  ctx: RunContext,
  call: ToolCallPart,
  action: "skip" | "stop",
  source: "policy" | "tool",
  reason?: string,
): void {
  emit({
    type: "toolSkip",
    ...base(ctx),
    id: call.id,
    name: call.name,
    arguments: call.arguments,
    action,
    source,
    reason,
  } satisfies ToolSkipEvent);
}

/**
 * Race a promise against an {@link AbortSignal}, with proper listener cleanup.
 *
 * If the signal is already aborted, rejects immediately. Otherwise, whichever
 * settles first wins, and the abort listener is removed to prevent leaks.
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("Aborted"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("Aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}
