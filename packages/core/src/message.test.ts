import { describe, expect, it } from "vitest";
import { assistant, normalizePrompt, system, user } from "./message.ts";
import { text } from "./content.ts";

describe("system", () => {
  it("wraps a string as a text part", () => {
    expect(system("be helpful")).toEqual({
      role: "system",
      content: [{ type: "text", text: "be helpful" }],
    });
  });

  it("passes content array through", () => {
    const content = [text("be helpful")];
    expect(system(content)).toEqual({ role: "system", content });
  });
});

describe("user", () => {
  it("wraps a string as a text part", () => {
    expect(user("hello")).toEqual({
      role: "user",
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("passes content array through", () => {
    const content = [text("hello")];
    expect(user(content)).toEqual({ role: "user", content });
  });
});

describe("assistant", () => {
  it("wraps a string as a text part", () => {
    expect(assistant("hi")).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
    });
  });

  it("passes content array through", () => {
    const content = [text("hi")];
    expect(assistant(content)).toEqual({ role: "assistant", content });
  });
});

describe("normalizePrompt", () => {
  it("wraps a string as a user message", () => {
    expect(normalizePrompt("hello")).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ]);
  });

  it("wraps a single message in an array", () => {
    const msg = user("hello");
    expect(normalizePrompt(msg)).toEqual([msg]);
  });

  it("passes a message array through", () => {
    const msgs = [system("be helpful"), user("hello")];
    expect(normalizePrompt(msgs)).toEqual(msgs);
  });
});
