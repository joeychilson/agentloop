import { describe, expect, it } from "vitest";
import type { Usage } from "./model.ts";
import { addUsage, emptyUsage } from "./model.ts";

describe("emptyUsage", () => {
  it("returns zeroed usage", () => {
    expect(emptyUsage()).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });
});

describe("addUsage", () => {
  it("adds two usage objects", () => {
    const a: Usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
    const b: Usage = { inputTokens: 20, outputTokens: 10, totalTokens: 30 };
    expect(addUsage(a, b)).toEqual({ inputTokens: 30, outputTokens: 15, totalTokens: 45 });
  });

  it("adds cache tokens when present", () => {
    const a: Usage = {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cacheReadTokens: 100,
      cacheWriteTokens: 50,
    };
    const b: Usage = {
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      cacheReadTokens: 200,
      cacheWriteTokens: 0,
    };
    expect(addUsage(a, b)).toEqual({
      inputTokens: 30,
      outputTokens: 15,
      totalTokens: 45,
      cacheReadTokens: 300,
      cacheWriteTokens: 50,
    });
  });

  it("omits cache tokens when both are zero or undefined", () => {
    const a: Usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
    const b: Usage = { inputTokens: 20, outputTokens: 10, totalTokens: 30 };
    const result = addUsage(a, b);
    expect(result.cacheReadTokens).toBeUndefined();
    expect(result.cacheWriteTokens).toBeUndefined();
  });
});
