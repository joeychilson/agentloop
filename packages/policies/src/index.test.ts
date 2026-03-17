import { describe, expect, it } from "vitest";
import type { RunContext, ResponseInfo, Usage } from "@agentloop/core";
import { maxSteps, maxRetries, maxTokens, maxDuration } from "./index.ts";

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

function makeUsage(totalTokens: number): Usage {
  return { inputTokens: 0, outputTokens: 0, totalTokens };
}

function makeResponseInfo(totalUsage: Usage): ResponseInfo {
  return {
    message: { role: "assistant", content: [] },
    messages: [],
    usage: makeUsage(0),
    totalUsage: totalUsage,
    finishReason: "stop",
  };
}

describe("maxSteps", () => {
  it("allows steps below the limit", () => {
    const policy = maxSteps(3);
    expect(policy.beforeStep!(makeCtx({ step: 0 }), {} as never)).toBeUndefined();
    expect(policy.beforeStep!(makeCtx({ step: 1 }), {} as never)).toBeUndefined();
    expect(policy.beforeStep!(makeCtx({ step: 2 }), {} as never)).toBeUndefined();
  });

  it("stops at the limit", () => {
    const policy = maxSteps(3);
    const result = policy.beforeStep!(makeCtx({ step: 3 }), {} as never);
    expect(result).toEqual({ action: "stop", reason: "Maximum steps (3) reached" });
  });

  it("stops above the limit", () => {
    const policy = maxSteps(1);
    const result = policy.beforeStep!(makeCtx({ step: 5 }), {} as never);
    expect(result).toEqual({ action: "stop", reason: "Maximum steps (1) reached" });
  });
});

describe("maxRetries", () => {
  it("allows retries below the limit", () => {
    const policy = maxRetries(2);
    expect(policy.beforeStep!(makeCtx({ retries: 0 }), {} as never)).toBeUndefined();
    expect(policy.beforeStep!(makeCtx({ retries: 1 }), {} as never)).toBeUndefined();
  });

  it("stops at the limit", () => {
    const policy = maxRetries(2);
    const result = policy.beforeStep!(makeCtx({ retries: 2 }), {} as never);
    expect(result).toEqual({ action: "stop", reason: "Maximum retries (2) reached" });
  });
});

describe("maxTokens", () => {
  it("allows usage below the limit", () => {
    const policy = maxTokens(1000);
    const result = policy.afterResponse!(makeCtx(), makeResponseInfo(makeUsage(500)));
    expect(result).toBeUndefined();
  });

  it("stops at the limit", () => {
    const policy = maxTokens(1000);
    const result = policy.afterResponse!(makeCtx(), makeResponseInfo(makeUsage(1000)));
    expect(result).toEqual({ action: "stop", reason: "Token budget (1000) exceeded" });
  });

  it("stops above the limit", () => {
    const policy = maxTokens(1000);
    const result = policy.afterResponse!(makeCtx(), makeResponseInfo(makeUsage(1500)));
    expect(result).toEqual({ action: "stop", reason: "Token budget (1000) exceeded" });
  });
});

describe("maxDuration", () => {
  it("allows calls within the duration", () => {
    const policy = maxDuration(5000);
    const result = policy.beforeStep!(makeCtx(), {} as never);
    expect(result).toBeUndefined();
  });

  it("stops after the duration", async () => {
    const policy = maxDuration(10);
    await new Promise((r) => setTimeout(r, 20));
    const result = policy.beforeStep!(makeCtx(), {} as never);
    expect(result).toEqual({ action: "stop", reason: "Duration limit (10ms) exceeded" });
  });
});
