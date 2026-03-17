/** Shared context for the current agent run, passed to policies and hooks. */
export interface RunContext {
  /** Unique identifier for the current run. */
  readonly runId: string;
  /** The current step number (zero-indexed). */
  readonly step: number;
  /** The name of the active agent, if applicable. */
  readonly agent?: string;
  /** Run-scoped key-value store shared across policies and tools. */
  readonly state: Record<string, unknown>;
  /** How many times the current step has been retried. Resets to zero on each new step. */
  readonly retries: number;
  /** Signal for cooperative cancellation. */
  readonly signal: AbortSignal;
}

/** Extended context passed to tool executions. */
export interface ToolContext extends RunContext {
  /** Identifier of the tool call being executed, matching {@link ToolCallPart.id}. */
  readonly id: string;
  /** Emit a progress update to observers during tool execution. */
  update(data: Record<string, unknown>): void;
}
