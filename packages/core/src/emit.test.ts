import { describe, expect, it, vi } from "vitest";
import type { Observer, ObserverEvent, TextDeltaEvent, ErrorEvent } from "./observer.ts";
import { createEmitFn } from "./emit.ts";

function makeEvent(overrides: Partial<ObserverEvent> & { type: string }): ObserverEvent {
  return {
    runId: "run-1",
    step: 0,
    timestamp: Date.now(),
    ...overrides,
  } as ObserverEvent;
}

function textDelta(text: string): TextDeltaEvent {
  return makeEvent({ type: "textDelta", text }) as TextDeltaEvent;
}

describe("createEmitFn", () => {
  it("calls the typed handler on the observer", () => {
    const handler = vi.fn();
    const observer: Observer = { name: "test", onTextDelta: handler };
    const emit = createEmitFn([observer]);

    const event = textDelta("hello");
    emit(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("calls the catch-all handler on the observer", () => {
    const handler = vi.fn();
    const observer: Observer = { name: "test", handler };
    const emit = createEmitFn([observer]);

    const event = textDelta("hello");
    emit(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("calls both typed and catch-all handlers independently", () => {
    const typed = vi.fn();
    const catchAll = vi.fn();
    const observer: Observer = { name: "test", onTextDelta: typed, handler: catchAll };
    const emit = createEmitFn([observer]);

    emit(textDelta("hello"));

    expect(typed).toHaveBeenCalledOnce();
    expect(catchAll).toHaveBeenCalledOnce();
  });

  it("calls the push function before observers", () => {
    const order: string[] = [];
    const push = vi.fn(() => order.push("push"));
    const observer: Observer = {
      name: "test",
      handler: () => {
        order.push("observer");
      },
    };
    const emit = createEmitFn([observer], push);

    emit(textDelta("hello"));

    expect(order).toEqual(["push", "observer"]);
  });

  it("notifies multiple observers independently", () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const emit = createEmitFn([
      { name: "a", handler: h1 },
      { name: "b", handler: h2 },
    ]);

    emit(textDelta("hello"));

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it("does not crash when a sync observer throws", () => {
    const emit = createEmitFn([
      {
        name: "bad",
        handler() {
          throw new Error("sync boom");
        },
      },
    ]);

    expect(() => emit(textDelta("hello"))).not.toThrow();
  });

  it("does not crash when an async observer rejects", async () => {
    const emit = createEmitFn([
      {
        name: "bad",
        async handler() {
          throw new Error("async boom");
        },
      },
    ]);

    expect(() => emit(textDelta("hello"))).not.toThrow();

    await new Promise((r) => setTimeout(r, 0));
  });

  it("continues notifying remaining observers after one throws", () => {
    const received: string[] = [];
    const emit = createEmitFn([
      {
        name: "bad",
        handler() {
          throw new Error("boom");
        },
      },
      {
        name: "good",
        handler(event) {
          received.push(event.type);
        },
      },
    ]);

    emit(textDelta("hello"));

    expect(received).toEqual(["error", "textDelta"]);
  });

  it("still calls catch-all handler when typed handler throws", () => {
    const catchAll = vi.fn();
    const emit = createEmitFn([
      {
        name: "test",
        onTextDelta() {
          throw new Error("typed boom");
        },
        handler: catchAll,
      },
    ]);

    emit(textDelta("hello"));

    expect(catchAll).toHaveBeenCalledOnce();
  });

  it("emits ErrorEvent to other observers when one fails synchronously", () => {
    const received: ObserverEvent[] = [];
    const emit = createEmitFn([
      {
        name: "bad",
        handler() {
          throw new Error("sync fail");
        },
      },
      {
        name: "watcher",
        handler(event) {
          received.push(event);
        },
      },
    ]);

    emit(textDelta("hello"));

    expect(received).toHaveLength(2);

    const errEvent = received[0] as ErrorEvent;
    expect(errEvent.type).toBe("error");
    expect(errEvent.source).toBe("observer");
    expect(errEvent.observer).toBe("bad");
    expect(errEvent.error.message).toBe("sync fail");
  });

  it("does not send observer error events back to the failing observer", () => {
    const badReceived: ObserverEvent[] = [];
    const emit = createEmitFn([
      {
        name: "bad",
        handler(event) {
          badReceived.push(event);
          if (event.type === "textDelta") throw new Error("boom");
        },
      },
      { name: "other", handler() {} },
    ]);

    emit(textDelta("hello"));

    expect(badReceived).toHaveLength(1);
    expect(badReceived[0]!.type).toBe("textDelta");
  });

  it("swallows nested errors (observer failing while handling observer error)", () => {
    const emit = createEmitFn([
      {
        name: "bad1",
        handler() {
          throw new Error("first");
        },
      },
      {
        name: "bad2",
        handler() {
          throw new Error("second");
        },
      },
    ]);

    expect(() => emit(textDelta("hello"))).not.toThrow();
  });

  it("preserves this binding for typed handlers", () => {
    let capturedName: string | undefined;
    const observer: Observer = {
      name: "self-aware",
      onTextDelta(this: Observer) {
        capturedName = this.name;
      },
    };
    const emit = createEmitFn([observer]);

    emit(textDelta("hello"));

    expect(capturedName).toBe("self-aware");
  });

  it("handles observer with no matching handler gracefully", () => {
    const emit = createEmitFn([{ name: "empty" }]);

    expect(() => emit(textDelta("hello"))).not.toThrow();
  });

  it("works with no observers", () => {
    const push = vi.fn();
    const emit = createEmitFn([], push);

    emit(textDelta("hello"));

    expect(push).toHaveBeenCalledOnce();
  });

  it("pushes observer error events to the channel", () => {
    const pushed: ObserverEvent[] = [];
    const emit = createEmitFn(
      [
        {
          name: "bad",
          handler() {
            throw new Error("observer broke");
          },
        },
        { name: "other", handler() {} },
      ],
      (event) => pushed.push(event),
    );

    emit(textDelta("hello"));

    expect(pushed).toHaveLength(2);
    expect(pushed[0]!.type).toBe("textDelta");

    const errEvent = pushed[1] as ErrorEvent;
    expect(errEvent.type).toBe("error");
    expect(errEvent.source).toBe("observer");
    expect(errEvent.observer).toBe("bad");
  });
});
