import { describe, expect, it } from "vitest";
import { createEventChannel } from "./channel.ts";

describe("createEventChannel", () => {
  it("delivers pushed values in order", async () => {
    const ch = createEventChannel<string, void>();
    ch.push("a");
    ch.push("b");
    ch.push("c");
    ch.close(undefined);

    const values: string[] = [];
    for await (const v of ch.stream) {
      values.push(v);
    }
    expect(values).toEqual(["a", "b", "c"]);
  });

  it("resolves result on close", async () => {
    const ch = createEventChannel<string, number>();
    ch.close(42);
    expect(await ch.result).toBe(42);
  });

  it("rejects result on fail", async () => {
    const ch = createEventChannel<string, number>();
    ch.fail(new Error("boom"));
    await expect(ch.result).rejects.toThrow("boom");
  });

  it("ends the stream on close", async () => {
    const ch = createEventChannel<string, void>();
    ch.push("a");
    ch.close(undefined);
    ch.push("b"); // should be ignored

    const values: string[] = [];
    for await (const v of ch.stream) {
      values.push(v);
    }
    expect(values).toEqual(["a"]);
  });

  it("ends the stream on fail", async () => {
    const ch = createEventChannel<string, number>();
    ch.push("a");
    ch.fail(new Error("boom"));
    ch.push("b"); // should be ignored

    const values: string[] = [];
    for await (const v of ch.stream) {
      values.push(v);
    }
    expect(values).toEqual(["a"]);
    await expect(ch.result).rejects.toThrow("boom");
  });

  it("delivers values pushed while consumer is waiting", async () => {
    const ch = createEventChannel<string, void>();

    const consumed = (async () => {
      const values: string[] = [];
      for await (const v of ch.stream) {
        values.push(v);
      }
      return values;
    })();

    // Let the consumer start waiting
    await Promise.resolve();

    ch.push("x");
    ch.push("y");
    ch.close(undefined);

    expect(await consumed).toEqual(["x", "y"]);
  });

  it("is idempotent on double close", async () => {
    const ch = createEventChannel<string, number>();
    ch.close(1);
    ch.close(2); // should be ignored
    expect(await ch.result).toBe(1);
  });

  it("ignores fail after close", async () => {
    const ch = createEventChannel<string, number>();
    ch.close(1);
    ch.fail(new Error("ignored"));
    expect(await ch.result).toBe(1);
  });

  it("ignores close after fail", async () => {
    const ch = createEventChannel<string, number>();
    ch.fail(new Error("first"));
    ch.close(1); // should be ignored
    await expect(ch.result).rejects.toThrow("first");
  });

  it("handles consumer breaking out of the loop early", async () => {
    const ch = createEventChannel<number, string>();
    ch.push(1);
    ch.push(2);
    ch.push(3);

    const values: number[] = [];
    for await (const v of ch.stream) {
      values.push(v);
      if (v === 2) break;
    }
    expect(values).toEqual([1, 2]);

    // Channel is still open — result still settles
    ch.close("done");
    expect(await ch.result).toBe("done");
  });

  it("returns done from next() after channel is closed with empty buffer", async () => {
    const ch = createEventChannel<string, void>();
    ch.close(undefined);

    const iter = ch.stream[Symbol.asyncIterator]();
    const r1 = await iter.next();
    const r2 = await iter.next();
    expect(r1).toEqual({ value: undefined, done: true });
    expect(r2).toEqual({ value: undefined, done: true });
  });
});
