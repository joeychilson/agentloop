import { describe, expect, it } from "vitest";
import { text } from "./content.ts";
import type { EmitFn } from "./emit.ts";
import type { Message } from "./message.ts";
import type { Model, StreamPart, Usage } from "./model.ts";
import type { ObserverEvent } from "./observer.ts";
import type { Policy } from "./policy.ts";
import type { Schema } from "./schema.ts";
import type { Tool } from "./tool.ts";
import type { AgentConfig } from "./agent.ts";
import { executeRun } from "./loop.ts";

const DEFAULT_USAGE: Usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

/** Create stream parts for a simple text response. */
function textParts(value: string, usage: Usage = DEFAULT_USAGE): StreamPart[] {
  return [
    { type: "text_start" },
    { type: "text_delta", text: value },
    { type: "text_end" },
    { type: "finish", finishReason: "stop", usage },
  ];
}

/** Create stream parts for a response with tool calls. */
function toolCallParts(
  calls: { id: string; name: string; args: Record<string, unknown> }[],
  usage: Usage = DEFAULT_USAGE,
): StreamPart[] {
  const parts: StreamPart[] = [];
  for (const call of calls) {
    parts.push(
      { type: "tool_call_start", id: call.id, name: call.name },
      { type: "tool_call_delta", id: call.id, args: JSON.stringify(call.args) },
      { type: "tool_call_end", id: call.id },
    );
  }
  parts.push({ type: "finish", finishReason: "tool_call", usage });
  return parts;
}

/** Create a mock model that returns a sequence of responses (one per step). */
function mockModel(responses: StreamPart[][]): Model {
  let call = 0;
  return {
    name: "test-model",
    stream() {
      const parts = responses[call] ?? textParts("(no more responses)");
      call++;
      return (async function* () {
        for (const part of parts) yield part;
      })();
    },
  };
}

function schema(valid = true): Schema {
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
    execute: () => "tool result",
    ...overrides,
  };
}

function collectEvents(): { events: ObserverEvent[]; emit: EmitFn } {
  const events: ObserverEvent[] = [];
  return { events, emit: (e: ObserverEvent) => events.push(e) };
}

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    model: mockModel([textParts("hello")]),
    ...overrides,
  };
}

describe("executeRun", () => {
  it("completes a single text response", async () => {
    const { events, emit } = collectEvents();
    const result = await executeRun(makeConfig(), "hi", {}, emit);

    expect(result.text).toBe("hello");
    expect(result.finishReason).toBe("stop");
    expect(result.steps).toBe(1);
    expect(result.usage.totalTokens).toBe(15);
    expect(result.error).toBeUndefined();
    expect(result.transcript).toHaveLength(2);
    expect(result.duration).toBeGreaterThan(0);

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("runStart");
    expect(types[types.length - 1]).toBe("runFinish");
    expect(types).toContain("stepStart");
    expect(types).toContain("textDelta");
    expect(types).toContain("responseFinish");
    expect(types).toContain("stepFinish");
  });

  it("handles empty prompt", async () => {
    const { emit } = collectEvents();
    const result = await executeRun(makeConfig(), undefined, {}, emit);

    expect(result.text).toBe("hello");
    expect(result.transcript).toHaveLength(1);
  });

  it("prepends transcript from options", async () => {
    const { emit } = collectEvents();
    const existing: Message[] = [
      { role: "user", content: [text("previous")] },
      { role: "assistant", content: [text("earlier")] },
    ];
    const result = await executeRun(makeConfig(), "new message", { transcript: existing }, emit);

    expect(result.transcript).toHaveLength(4);
  });

  it("executes tool calls and loops back to model", async () => {
    const tool = makeTool({
      name: "greet",
      execute: () => "greeting result",
    });

    const model = mockModel([
      toolCallParts([{ id: "c1", name: "greet", args: { name: "world" } }]),
      textParts("done"),
    ]);

    const { events, emit } = collectEvents();
    const result = await executeRun(makeConfig({ model, tools: [tool] }), "hi", {}, emit);

    expect(result.text).toBe("done");
    expect(result.steps).toBe(2);
    expect(result.transcript).toHaveLength(4);

    const types = events.map((e) => e.type);
    expect(types).toContain("toolRunStart");
    expect(types).toContain("toolRunEnd");
  });

  it("handles multiple tool calls in parallel", async () => {
    const order: string[] = [];
    const toolA = makeTool({
      name: "a",
      async execute() {
        order.push("a");
        return "a-result";
      },
    });
    const toolB = makeTool({
      name: "b",
      async execute() {
        order.push("b");
        return "b-result";
      },
    });

    const model = mockModel([
      toolCallParts([
        { id: "c1", name: "a", args: {} },
        { id: "c2", name: "b", args: {} },
      ]),
      textParts("done"),
    ]);

    const { emit } = collectEvents();
    const result = await executeRun(makeConfig({ model, tools: [toolA, toolB] }), "go", {}, emit);

    expect(result.text).toBe("done");
    expect(order).toContain("a");
    expect(order).toContain("b");
  });

  it("stops before step via beforeStep policy", async () => {
    const policy: Policy = {
      name: "limiter",
      beforeStep: () => ({ action: "stop", reason: "limit reached" }),
    };

    const { emit } = collectEvents();
    const result = await executeRun(makeConfig({ policies: [policy] }), "hi", {}, emit);

    expect(result.finishReason).toBe("stop");
    expect(result.stoppedBy).toBe("limiter");
    expect(result.steps).toBe(1);
    expect(result.transcript).toHaveLength(1);
  });

  it("stops after response via afterResponse policy", async () => {
    const policy: Policy = {
      name: "checker",
      afterResponse: () => ({ action: "stop", reason: "bad response" }),
    };

    const { emit } = collectEvents();
    const result = await executeRun(makeConfig(), "hi", { policies: [policy] }, emit);

    expect(result.finishReason).toBe("stop");
    expect(result.stoppedBy).toBe("checker");
  });

  it("retries step via afterResponse policy", async () => {
    let calls = 0;
    const model = mockModel([textParts("bad"), textParts("good")]);

    const policy: Policy = {
      name: "retrier",
      afterResponse() {
        calls++;
        if (calls === 1) return { action: "retry", reason: "try again" };
      },
    };

    const { events, emit } = collectEvents();
    const result = await executeRun(makeConfig({ model, policies: [policy] }), "hi", {}, emit);

    expect(result.text).toBe("good");
    expect(events.some((e) => e.type === "stepRetry")).toBe(true);
  });

  it("replaces response via afterResponse policy", async () => {
    const policy: Policy = {
      name: "replacer",
      afterResponse: () => ({
        action: "replace",
        message: { role: "assistant", content: [{ type: "text", text: "replaced" }] },
      }),
    };

    const { emit } = collectEvents();
    const result = await executeRun(makeConfig(), "hi", { policies: [policy] }, emit);

    expect(result.text).toBe("replaced");
  });

  it("stops after step via afterStep policy", async () => {
    const tool = makeTool({ name: "t", execute: () => "ok" });
    const model = mockModel([toolCallParts([{ id: "c1", name: "t", args: {} }])]);

    const policy: Policy = {
      name: "step-stopper",
      afterStep: () => ({ action: "stop", reason: "enough" }),
    };

    const { emit } = collectEvents();
    const result = await executeRun(
      makeConfig({ model, tools: [tool], policies: [policy] }),
      "hi",
      {},
      emit,
    );

    expect(result.stoppedBy).toBe("step-stopper");
  });

  it("injects messages via afterStep policy", async () => {
    let stepCount = 0;
    const model = mockModel([textParts("first"), textParts("second")]);

    const policy: Policy = {
      name: "injector",
      afterStep() {
        stepCount++;
        if (stepCount === 1) {
          return {
            action: "inject",
            messages: [{ role: "user", content: [{ type: "text", text: "injected" }] }],
          };
        }
      },
    };

    const { emit } = collectEvents();
    const result = await executeRun(makeConfig({ model, policies: [policy] }), "hi", {}, emit);

    expect(result.text).toBe("second");
    expect(result.steps).toBe(2);
    expect(result.transcript).toHaveLength(4);
  });

  it("catches model stream errors and produces error result", async () => {
    const model: Model = {
      name: "broken",
      stream() {
        return (async function* () {
          yield { type: "error" as const, error: new Error("stream failed") };
        })();
      },
    };

    const { events, emit } = collectEvents();
    const result = await executeRun(makeConfig({ model }), "hi", {}, emit);

    expect(result.finishReason).toBe("error");
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toBe("stream failed");
    expect(events.some((e) => e.type === "error" && e.source === "provider")).toBe(true);
  });

  it("never throws even on unexpected errors", async () => {
    const model: Model = {
      name: "throws",
      stream() {
        throw new Error("sync explosion");
      },
    };

    const { emit } = collectEvents();
    const result = await executeRun(makeConfig({ model }), "hi", {}, emit);

    expect(result.finishReason).toBe("error");
    expect(result.error!.message).toBe("sync explosion");
  });

  it("catches policy errors and treats them as stop", async () => {
    const policy: Policy = {
      name: "crasher",
      beforeStep() {
        throw new Error("policy exploded");
      },
    };

    const { events, emit } = collectEvents();
    const result = await executeRun(makeConfig({ policies: [policy] }), "hi", {}, emit);

    expect(result.finishReason).toBe("stop");
    expect(result.stoppedBy).toBe("crasher");
    expect(events.some((e) => e.type === "error" && e.source === "policy")).toBe(true);
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort("cancelled by user");

    const { events, emit } = collectEvents();
    const result = await executeRun(makeConfig(), "hi", { signal: controller.signal }, emit);

    expect(result.finishReason).toBe("cancelled");
    expect(events.some((e) => e.type === "abort")).toBe(true);
  });

  it("parses structured output when schema is provided", async () => {
    const model = mockModel([textParts('{"name":"test","value":42}')]);
    const outputSchema: Schema<{ name: string; value: number }> = {
      safeParse(value: unknown) {
        if (typeof value === "object" && value !== null && "name" in value) {
          return { success: true, data: value as { name: string; value: number } };
        }
        return { success: false, error: "invalid" };
      },
    };

    const { emit } = collectEvents();
    const result = await executeRun(makeConfig({ model }), "hi", { output: outputSchema }, emit);

    expect(result.object).toEqual({ name: "test", value: 42 });
  });

  it("returns null object on invalid structured output", async () => {
    const model = mockModel([textParts("not json")]);

    const { events, emit } = collectEvents();
    const result = await executeRun(makeConfig({ model }), "hi", { output: schema() }, emit);

    expect(result.object).toBeNull();
    expect(events.some((e) => e.type === "error" && e.source === "validation")).toBe(true);
  });

  it("increments steps correctly across tool call loops", async () => {
    const tool = makeTool({ name: "t", execute: () => "ok" });
    const model = mockModel([
      toolCallParts([{ id: "c1", name: "t", args: {} }]),
      toolCallParts([{ id: "c2", name: "t", args: {} }]),
      textParts("done"),
    ]);

    const { emit } = collectEvents();
    const result = await executeRun(makeConfig({ model, tools: [tool] }), "hi", {}, emit);

    expect(result.steps).toBe(3);
    expect(result.text).toBe("done");
  });

  it("emits events in correct order for a tool call step", async () => {
    const tool = makeTool({ name: "t", execute: () => "ok" });
    const model = mockModel([
      toolCallParts([{ id: "c1", name: "t", args: {} }]),
      textParts("done"),
    ]);

    const { events, emit } = collectEvents();
    await executeRun(makeConfig({ model, tools: [tool] }), "hi", {}, emit);

    const types = events.map((e) => e.type);

    // Verify key ordering constraints
    const runStartIdx = types.indexOf("runStart");
    const stepStartIdx = types.indexOf("stepStart");
    const toolCallStartIdx = types.indexOf("toolCallStart");
    const responseFinishIdx = types.indexOf("responseFinish");
    const toolRunStartIdx = types.indexOf("toolRunStart");
    const toolRunEndIdx = types.indexOf("toolRunEnd");
    const stepFinishIdx = types.indexOf("stepFinish");
    const runFinishIdx = types.indexOf("runFinish");

    expect(runStartIdx).toBeLessThan(stepStartIdx);
    expect(stepStartIdx).toBeLessThan(toolCallStartIdx);
    expect(toolCallStartIdx).toBeLessThan(responseFinishIdx);
    expect(responseFinishIdx).toBeLessThan(toolRunStartIdx);
    expect(toolRunStartIdx).toBeLessThan(toolRunEndIdx);
    expect(toolRunEndIdx).toBeLessThan(stepFinishIdx);
    expect(stepFinishIdx).toBeLessThan(runFinishIdx);
  });

  it("rolls back step messages on afterStep retry", async () => {
    let stepCount = 0;
    const tool = makeTool({ name: "t", execute: () => "ok" });
    const model = mockModel([
      toolCallParts([{ id: "c1", name: "t", args: {} }]),
      textParts("final"),
    ]);

    const policy: Policy = {
      name: "retry-once",
      afterStep() {
        stepCount++;
        if (stepCount === 1) return { action: "retry", reason: "redo" };
      },
    };

    const { emit } = collectEvents();
    const result = await executeRun(
      makeConfig({ model, tools: [tool], policies: [policy] }),
      "hi",
      {},
      emit,
    );

    expect(result.text).toBe("final");
    expect(result.transcript.filter((m) => m.role === "tool")).toHaveLength(0);
  });

  it("uses tools from plan after beforeStep policy mutation", async () => {
    let executedTool: string | undefined;
    const dynamicTool = makeTool({
      name: "dynamic",
      execute() {
        executedTool = "dynamic";
        return "dynamic result";
      },
    });

    const model = mockModel([
      toolCallParts([{ id: "c1", name: "dynamic", args: {} }]),
      textParts("done"),
    ]);

    const policy: Policy = {
      name: "tool-adder",
      beforeStep(_ctx, plan) {
        plan.tools.push(dynamicTool);
      },
    };

    const { emit } = collectEvents();
    const result = await executeRun(makeConfig({ model, policies: [policy] }), "hi", {}, emit);

    expect(executedTool).toBe("dynamic");
    expect(result.text).toBe("done");
  });
});
