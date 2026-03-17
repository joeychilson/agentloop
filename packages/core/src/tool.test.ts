import { describe, expect, it } from "vitest";
import { text, json } from "./content.ts";
import { normalizeToolReturn } from "./tool.ts";

describe("normalizeToolReturn", () => {
  it("wraps a string as a text part", () => {
    expect(normalizeToolReturn("hello")).toEqual([{ type: "text", text: "hello" }]);
  });

  it("wraps an object as a json part", () => {
    const obj = { city: "Seattle", temp: 72 };
    expect(normalizeToolReturn(obj)).toEqual([{ type: "json", json: obj }]);
  });

  it("passes a content array through", () => {
    const content = [text("line 1"), json({ count: 1 })];
    expect(normalizeToolReturn(content)).toEqual(content);
  });
});
