import { describe, expect, it, vi } from "vitest";
import type { ToolCallPart } from "./content.ts";
import { text } from "./content.ts";
import type { RunContext, ToolContext } from "./context.ts";
import type { ObserverEvent } from "./observer.ts";
import type { Policy } from "./policy.ts";
import type { Tool } from "./tool.ts";
import { executeToolCalls } from "./execute.ts";

function schema(valid = true) {
  return {
    safeParse(value: unknown) {
      return valid
        ? { success: true as const, data: value }
        : { success: false as const, error: "validation failed" };
    },
  };
}

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: "test_tool",
    description: "A test tool",
    schema: schema(),
    execute: () => "ok",
    ...overrides,
  };
}

function makeCall(overrides: Partial<ToolCallPart> = {}): ToolCallPart {
  return {
    type: "tool_call",
    id: "call_1",
    name: "test_tool",
    arguments: { input: "hello" },
    ...overrides,
  };
}

function makeCtx(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: "run-1",
    step: 0,
    state: {},
    retries: 0,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function collectEmit(): { events: ObserverEvent[]; emit: (e: ObserverEvent) => void } {
  const events: ObserverEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

function run(
  calls: ToolCallPart[],
  tools: Tool[],
  opts: { policies?: Policy[]; ctx?: RunContext } = {},
) {
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const { events, emit } = collectEmit();
  const ctx = opts.ctx ?? makeCtx();
  const promise = executeToolCalls(calls, toolMap, opts.policies ?? [], ctx, emit);
  return { promise, events };
}

describe("executeToolCalls", () => {
  it("executes a tool and returns its output", async () => {
    const tool = makeTool({ execute: () => "result text" });
    const { promise, events } = run([makeCall()], [tool]);

    const { results, stopRun } = await promise;

    expect(results).toHaveLength(1);
    expect(results[0]!.output).toEqual([text("result text")]);
    expect(results[0]!.isError).toBeUndefined();
    expect(stopRun).toBeUndefined();
    expect(events.some((e) => e.type === "toolRunStart")).toBe(true);
    expect(events.some((e) => e.type === "toolRunEnd")).toBe(true);
  });

  it("returns error result for unknown tool", async () => {
    const { promise, events } = run([makeCall({ name: "missing" })], []);

    const { results } = await promise;

    expect(results).toHaveLength(1);
    expect(results[0]!.isError).toBe(true);
    expect(results[0]!.output[0]!.type).toBe("text");
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  it("returns error result on schema validation failure", async () => {
    const tool = makeTool({ schema: schema(false) });
    const { promise, events } = run([makeCall()], [tool]);

    const { results } = await promise;

    expect(results[0]!.isError).toBe(true);
    expect(events.some((e) => e.type === "error" && e.source === "validation")).toBe(true);
  });

  it("catches tool execution errors and returns error content", async () => {
    const tool = makeTool({
      execute: () => {
        throw new Error("tool crashed");
      },
    });
    const { promise } = run([makeCall()], [tool]);

    const { results } = await promise;

    expect(results[0]!.isError).toBe(true);
    expect((results[0]!.output[0] as { type: "text"; text: string }).text).toContain(
      "tool crashed",
    );
  });

  it("catches async tool execution errors", async () => {
    const tool = makeTool({
      async execute() {
        throw new Error("async crash");
      },
    });
    const { promise } = run([makeCall()], [tool]);

    const { results } = await promise;

    expect(results[0]!.isError).toBe(true);
  });

  it("executes multiple tools in parallel", async () => {
    const order: string[] = [];
    const toolA = makeTool({
      name: "a",
      async execute() {
        order.push("a-start");
        await new Promise((r) => setTimeout(r, 10));
        order.push("a-end");
        return "a-result";
      },
    });
    const toolB = makeTool({
      name: "b",
      async execute() {
        order.push("b-start");
        await new Promise((r) => setTimeout(r, 10));
        order.push("b-end");
        return "b-result";
      },
    });

    const calls = [makeCall({ id: "c1", name: "a" }), makeCall({ id: "c2", name: "b" })];
    const { promise } = run(calls, [toolA, toolB]);

    const { results } = await promise;

    expect(order.indexOf("a-start")).toBeLessThan(order.indexOf("a-end"));
    expect(order.indexOf("b-start")).toBeLessThan(order.indexOf("b-end"));
    expect(order.indexOf("b-start")).toBeLessThan(order.indexOf("a-end"));

    expect(results).toHaveLength(2);
    expect(results[0]!.output).toEqual([text("a-result")]);
    expect(results[1]!.output).toEqual([text("b-result")]);
  });

  it("preserves result order matching call order", async () => {
    const slow = makeTool({
      name: "slow",
      async execute() {
        await new Promise((r) => setTimeout(r, 20));
        return "slow";
      },
    });
    const fast = makeTool({ name: "fast", execute: () => "fast" });

    const calls = [makeCall({ id: "c1", name: "slow" }), makeCall({ id: "c2", name: "fast" })];
    const { promise } = run(calls, [slow, fast]);

    const { results } = await promise;

    expect(results[0]!.name).toBe("slow");
    expect(results[1]!.name).toBe("fast");
  });

  it("skips tool when policy returns skip", async () => {
    const tool = makeTool({ execute: vi.fn() });
    const policy: Policy = {
      name: "gate",
      beforeToolRun: () => ({ action: "skip", reason: "not allowed" }),
    };
    const { promise, events } = run([makeCall()], [tool], { policies: [policy] });

    const { results } = await promise;

    expect(tool.execute).not.toHaveBeenCalled();
    expect(results[0]!.isError).toBeUndefined();
    expect(events.some((e) => e.type === "toolSkip" && e.source === "policy")).toBe(true);
  });

  it("stops run when policy returns stop", async () => {
    const policy: Policy = {
      name: "stopper",
      beforeToolRun: () => ({
        action: "stop",
        output: [text("blocked")],
        reason: "forbidden",
      }),
    };
    const { promise, events } = run([makeCall()], [makeTool()], { policies: [policy] });

    const { results, stopRun } = await promise;

    expect(stopRun).toBe("stopper");
    expect(results[0]!.output).toEqual([text("blocked")]);
    expect(events.some((e) => e.type === "toolSkip" && e.action === "stop")).toBe(true);
  });

  it("allows policy to mutate arguments via ToolCallInfo", async () => {
    let receivedArgs: unknown;
    const tool = makeTool({
      execute(args) {
        receivedArgs = args;
        return "done";
      },
    });
    const policy: Policy = {
      name: "sanitizer",
      beforeToolRun(_ctx, call) {
        call.arguments = { sanitized: true };
      },
    };
    const { promise } = run([makeCall()], [tool], { policies: [policy] });

    await promise;

    expect(receivedArgs).toEqual({ sanitized: true });
  });

  it("skips when tool.before returns skip", async () => {
    const executeFn = vi.fn(() => "ok");
    const tool = makeTool({
      execute: executeFn,
      before: () => ({ action: "skip", output: [text("skipped")] }),
    });
    const { promise, events } = run([makeCall()], [tool]);

    const { results } = await promise;

    expect(executeFn).not.toHaveBeenCalled();
    expect(results[0]!.output).toEqual([text("skipped")]);
    expect(events.some((e) => e.type === "toolSkip" && e.source === "tool")).toBe(true);
  });

  it("returns error when tool.before throws", async () => {
    const tool = makeTool({
      before: () => {
        throw new Error("before broke");
      },
    });
    const { promise } = run([makeCall()], [tool]);

    const { results } = await promise;

    expect(results[0]!.isError).toBe(true);
    expect((results[0]!.output[0] as { type: "text"; text: string }).text).toContain(
      "before broke",
    );
  });

  it("rewrites output via tool.after", async () => {
    const tool = makeTool({
      execute: () => "original",
      after: () => ({ action: "rewrite", output: [text("rewritten")] }),
    });
    const { promise } = run([makeCall()], [tool]);

    const { results } = await promise;

    expect(results[0]!.output).toEqual([text("rewritten")]);
    expect(results[0]!.isError).toBeUndefined();
  });

  it("retries via tool.after up to max retries", async () => {
    let attempts = 0;
    const tool = makeTool({
      execute: () => {
        attempts++;
        return `attempt-${attempts}`;
      },
      after: () => (attempts < 3 ? { action: "retry" } : undefined),
    });
    const { promise } = run([makeCall()], [tool]);

    const { results } = await promise;

    expect(attempts).toBe(3);
    expect(results[0]!.output).toEqual([text("attempt-3")]);
  });

  it("stops run via tool.after", async () => {
    const tool = makeTool({
      execute: () => "done",
      after: () => ({ action: "stop" }),
    });
    const { promise } = run([makeCall()], [tool]);

    const { results, stopRun } = await promise;

    expect(stopRun).toBe("test_tool");
    expect(results[0]!.output).toEqual([text("done")]);
  });

  it("rewrites output via policy afterToolRun", async () => {
    const policy: Policy = {
      name: "rewriter",
      afterToolRun: () => ({ action: "rewrite", output: [text("policy-rewritten")] }),
    };
    const { promise } = run([makeCall()], [makeTool()], { policies: [policy] });

    const { results } = await promise;

    expect(results[0]!.output).toEqual([text("policy-rewritten")]);
  });

  it("stops run via policy afterToolRun", async () => {
    const policy: Policy = {
      name: "halter",
      afterToolRun: () => ({ action: "stop" }),
    };
    const { promise } = run([makeCall()], [makeTool()], { policies: [policy] });

    const { stopRun } = await promise;

    expect(stopRun).toBe("halter");
  });

  it("emits toolRunUpdate events via ctx.update", async () => {
    const tool = makeTool({
      execute(_args, ctx: ToolContext) {
        ctx.update({ progress: 50 });
        ctx.update({ progress: 100 });
        return "done";
      },
    });
    const { promise, events } = run([makeCall()], [tool]);

    await promise;

    const updates = events.filter((e) => e.type === "toolRunUpdate");
    expect(updates).toHaveLength(2);
  });

  it("aborts tool execution when timeout is exceeded", async () => {
    const tool = makeTool({
      timeout: 50,
      async execute(_args, ctx: ToolContext) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 5000);
          ctx.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(ctx.signal.reason ?? new Error("Aborted"));
          });
        });
        return "should not reach";
      },
    });
    const { promise } = run([makeCall()], [tool]);

    const { results } = await promise;

    expect(results[0]!.isError).toBe(true);
  }, 10_000);

  it("races against signal for tools that ignore abort", async () => {
    const tool = makeTool({
      timeout: 50,
      execute: () =>
        new Promise(() => {
          // Never resolves, never checks signal
        }),
    });
    const { promise } = run([makeCall()], [tool]);

    const { results } = await promise;

    expect(results[0]!.isError).toBe(true);
  }, 10_000);

  it("returns first stopRun in call order", async () => {
    const toolA = makeTool({
      name: "a",
      async execute() {
        await new Promise((r) => setTimeout(r, 20));
        return "a";
      },
      after: () => ({ action: "stop" }),
    });
    const toolB = makeTool({
      name: "b",
      execute: () => "b",
      after: () => ({ action: "stop" }),
    });

    const calls = [makeCall({ id: "c1", name: "a" }), makeCall({ id: "c2", name: "b" })];
    const { promise } = run(calls, [toolA, toolB]);

    const { stopRun } = await promise;

    expect(stopRun).toBe("a");
  });
});
