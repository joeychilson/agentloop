import type { ErrorEvent, Observer, ObserverEvent } from "./observer.ts";

/** Callback that delivers an event to observers and an optional external consumer. */
export type EmitFn = (event: ObserverEvent) => void;

/**
 * Create an {@link EmitFn} that delivers events to observers and optionally
 * pushes them into an external consumer (e.g. an {@link EventChannel}).
 *
 * Observer handlers are invoked synchronously; async rejections are caught.
 * No observer can block or crash the agent loop.
 */
export function createEmitFn(observers: Observer[], push?: (event: ObserverEvent) => void): EmitFn {
  return (event) => {
    if (push !== undefined) push(event);
    notifyObservers(observers, event, push);
  };
}

/** Dispatch an event to all observers, reporting observer failures to the others. */
function notifyObservers(
  observers: Observer[],
  event: ObserverEvent,
  push: ((event: ObserverEvent) => void) | undefined,
): void {
  const isObserverError = event.type === "error" && event.source === "observer";

  for (const observer of observers) {
    invokeObserver(observer, event, (err) => {
      if (isObserverError) return;

      const errorEvent: ErrorEvent = {
        type: "error",
        runId: event.runId,
        step: event.step,
        agent: event.agent,
        timestamp: Date.now(),
        error: err instanceof Error ? err : new Error(String(err)),
        source: "observer",
        observer: observer.name,
      };

      if (push !== undefined) push(errorEvent);

      for (const other of observers) {
        if (other !== observer) {
          invokeObserver(other, errorEvent, () => {});
        }
      }
    });
  }
}

/** Call an observer's typed handler and catch-all handler, independently. */
function invokeObserver(
  observer: Observer,
  event: ObserverEvent,
  onError: (err: unknown) => void,
): void {
  const key = `on${event.type.charAt(0).toUpperCase()}${event.type.slice(1)}`;
  const typed = (observer as unknown as Record<string, unknown>)[key];
  if (typeof typed === "function") {
    try {
      const fn = typed as (this: Observer, event: ObserverEvent) => void | Promise<void>;
      const result = fn.call(observer, event);
      if (result != null) Promise.resolve(result).catch(onError);
    } catch (err) {
      onError(err);
    }
  }

  if (observer.handler !== undefined) {
    try {
      const result = observer.handler(event);
      if (result != null) Promise.resolve(result).catch(onError);
    } catch (err) {
      onError(err);
    }
  }
}
