/**
 * A push-pull async channel that decouples a producer from a consumer.
 *
 * The producer pushes values without blocking; the consumer pulls via
 * {@link EventChannel.stream | async iteration}. The channel is unbounded —
 * pushed values buffer in memory until consumed.
 *
 * Used internally by the agent loop to deliver observer events to the
 * {@link AgentStream} consumer without blocking the loop.
 */
export interface EventChannel<T, TResult> {
  /** Push a value into the channel. No-op after {@link close} or {@link fail}. */
  push(value: T): void;

  /** Signal successful completion with a final result. */
  close(result: TResult): void;

  /** Signal failure. Rejects the {@link result} promise. */
  fail(error: Error): void;

  /** Async iterable consumer side. Yields buffered values, then ends when the channel closes. */
  readonly stream: AsyncIterable<T>;

  /** Resolves on {@link close}, rejects on {@link fail}. */
  readonly result: Promise<TResult>;
}

/** Create an {@link EventChannel}. */
export function createEventChannel<T, TResult>(): EventChannel<T, TResult> {
  const buffer: T[] = [];
  let closed = false;
  let waiter: ((item: IteratorResult<T>) => void) | null = null;

  let resolveResult!: (value: TResult) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<TResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  function releaseWaiter(): void {
    if (waiter !== null) {
      const resolve = waiter;
      waiter = null;
      resolve({ value: undefined, done: true });
    }
  }

  function push(value: T): void {
    if (closed) return;
    if (waiter !== null) {
      const resolve = waiter;
      waiter = null;
      resolve({ value, done: false });
    } else {
      buffer.push(value);
    }
  }

  function close(value: TResult): void {
    if (closed) return;
    closed = true;
    resolveResult(value);
    releaseWaiter();
  }

  function fail(error: Error): void {
    if (closed) return;
    closed = true;
    rejectResult(error);
    releaseWaiter();
  }

  const stream: AsyncIterable<T> = {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          if (buffer.length > 0) {
            return Promise.resolve({ value: buffer.shift()!, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve) => {
            waiter = resolve;
          });
        },
        return(): Promise<IteratorResult<T>> {
          releaseWaiter();
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };

  return { push, close, fail, stream, result };
}
