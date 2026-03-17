import type { Content, ToolCallPart } from "./content.ts";
import type { AssistantMessage, Message, Prompt } from "./message.ts";
import type { FinishReason, Usage } from "./model.ts";

/** Common fields present on every observer event. */
export interface BaseEvent {
  /** Event discriminator. */
  readonly type: string;
  /** Unique identifier for the current run. */
  readonly runId: string;
  /** The current step number (zero-indexed). */
  readonly step: number;
  /** The name of the active agent, if applicable. */
  readonly agent?: string;
  /** Unix timestamp (ms) when the event was created. */
  readonly timestamp: number;
}

/** Fired when a run begins. */
export interface RunStartEvent extends BaseEvent {
  readonly type: "runStart";
  /** The model being used for the run. */
  readonly model: string;
  /** System instructions, if provided. */
  readonly instructions?: string;
  /** The input prompt. */
  readonly prompt?: Prompt;
  /** Names of the tools available to the model. */
  readonly tools: string[];
}

/** Fired when a run completes (successfully or with an error). */
export interface RunFinishEvent extends BaseEvent {
  readonly type: "runFinish";
  /** Convenience extraction of the final text output. */
  readonly text: string;
  /** The final assistant message. */
  readonly response: AssistantMessage;
  /** The full conversation transcript. */
  readonly transcript: readonly Message[];
  /** Parsed structured output, if an output schema was provided. */
  readonly object?: unknown;
  /** Total number of steps executed. */
  readonly steps: number;
  /** Aggregated token usage for the entire run. */
  readonly usage: Usage;
  /** Why the run ended. */
  readonly finishReason: FinishReason;
  /** The name of the policy that stopped the run, if applicable. */
  readonly stoppedBy?: string;
  /** The error, if the run ended due to a failure. */
  readonly error?: Error;
  /** Wall-clock duration of the run in milliseconds. */
  readonly duration: number;
}

/** Fired when a step begins (one model call + tool execution cycle). */
export interface StepStartEvent extends BaseEvent {
  readonly type: "stepStart";
  /** The model being used for this step (may differ from run start if swapped by a policy). */
  readonly model: string;
}

/** Fired when a step is retried. */
export interface StepRetryEvent extends BaseEvent {
  readonly type: "stepRetry";
  /** Why the step is being retried. */
  readonly reason?: string;
  /** How many times this step has been retried so far. */
  readonly retries: number;
}

/** Fired when a step completes (model response + all tool executions). */
export interface StepFinishEvent extends BaseEvent {
  readonly type: "stepFinish";
  /** Messages produced during this step. */
  readonly messages: readonly Message[];
  /** Parsed structured output, if an output schema was provided. */
  readonly object?: unknown;
  /** Token usage for this step. */
  readonly usage: Usage;
  /** Aggregated token usage across all steps so far. */
  readonly totalUsage: Usage;
  /** Why the model stopped generating in this step. */
  readonly finishReason: FinishReason;
  /** Wall-clock duration of the step in milliseconds. */
  readonly duration: number;
}

/** Fired after the model responds, before tool execution. */
export interface ResponseFinishEvent extends BaseEvent {
  readonly type: "responseFinish";
  /** The assistant message. */
  readonly message: AssistantMessage;
  /** Token usage for this response. */
  readonly usage: Usage;
  /** Aggregated token usage across all steps so far. */
  readonly totalUsage: Usage;
  /** Why the model stopped generating. */
  readonly finishReason: FinishReason;
  /** The error, if the response failed. */
  readonly error?: Error;
  /** Wall-clock duration of the model call in milliseconds. */
  readonly duration: number;
}

/** Fired when the model begins producing text output. */
export interface TextStartEvent extends BaseEvent {
  readonly type: "textStart";
}

/** Fired for each chunk of text output. */
export interface TextDeltaEvent extends BaseEvent {
  readonly type: "textDelta";
  /** The text chunk. */
  readonly text: string;
}

/** Fired when the model finishes producing text output. */
export interface TextStopEvent extends BaseEvent {
  readonly type: "textStop";
}

/** Fired when the model begins a reasoning trace. */
export interface ThinkingStartEvent extends BaseEvent {
  readonly type: "thinkingStart";
  /** Whether the thinking content is redacted by the provider. */
  readonly redacted?: boolean;
}

/** Fired for each chunk of reasoning output. */
export interface ThinkingDeltaEvent extends BaseEvent {
  readonly type: "thinkingDelta";
  /** The reasoning text chunk. */
  readonly text: string;
}

/** Fired when the model finishes a reasoning trace. */
export interface ThinkingStopEvent extends BaseEvent {
  readonly type: "thinkingStop";
}

/** Fired when the model begins producing a tool call. */
export interface ToolCallStartEvent extends BaseEvent {
  readonly type: "toolCallStart";
  /** The tool call ID, matching {@link ToolCallPart.id}. */
  readonly id: string;
  /** The tool name. */
  readonly name: string;
}

/** Fired for each chunk of tool call arguments. */
export interface ToolCallDeltaEvent extends BaseEvent {
  readonly type: "toolCallDelta";
  /** The tool call ID, matching {@link ToolCallPart.id}. */
  readonly id: string;
  /** The tool name. */
  readonly name: string;
  /** Partial JSON arguments received so far. */
  readonly partialArguments: string;
}

/** Fired when the model finishes producing a tool call. */
export interface ToolCallStopEvent extends BaseEvent {
  readonly type: "toolCallStop";
  /** The tool call ID, matching {@link ToolCallPart.id}. */
  readonly id: string;
  /** The tool name. */
  readonly name: string;
  /** The fully parsed tool call arguments, matching {@link ToolCallPart.arguments}. */
  readonly arguments: Record<string, unknown>;
}

/** Fired when a tool begins executing. */
export interface ToolRunStartEvent extends BaseEvent {
  readonly type: "toolRunStart";
  /** The tool call ID, matching {@link ToolCallPart.id}. */
  readonly id: string;
  /** The tool name. */
  readonly name: string;
  /** The arguments passed to the tool. */
  readonly arguments: Record<string, unknown>;
}

/** Fired when a tool emits a progress update via {@link ToolContext.update}. */
export interface ToolRunUpdateEvent extends BaseEvent {
  readonly type: "toolRunUpdate";
  /** The tool call ID, matching {@link ToolCallPart.id}. */
  readonly id: string;
  /** The tool name. */
  readonly name: string;
  /** The progress data emitted by the tool. */
  readonly data: Record<string, unknown>;
}

/** Fired when a tool finishes executing. */
export interface ToolRunEndEvent extends BaseEvent {
  readonly type: "toolRunEnd";
  /** The tool call ID, matching {@link ToolCallPart.id}. */
  readonly id: string;
  /** The tool name. */
  readonly name: string;
  /** The content returned by the tool. */
  readonly output: readonly Content[];
  /** The error, if the tool failed. */
  readonly error?: Error;
  /** Wall-clock duration of the tool execution in milliseconds. */
  readonly duration: number;
}

/** Fired when a tool call is skipped by a policy or the tool's own before hook. */
export interface ToolSkipEvent extends BaseEvent {
  readonly type: "toolSkip";
  /** The tool call ID, matching {@link ToolCallPart.id}. */
  readonly id: string;
  /** The tool name. */
  readonly name: string;
  /** The arguments the model passed to the tool. */
  readonly arguments: Record<string, unknown>;
  /** Whether the tool was skipped or the entire run was stopped. */
  readonly action: "skip" | "stop";
  /** What triggered the skip. */
  readonly source: "policy" | "tool";
  /** Human-readable reason for the skip. */
  readonly reason?: string;
}

/** Fired when the run is aborted via the abort signal. */
export interface AbortEvent extends BaseEvent {
  readonly type: "abort";
  /** Human-readable reason for the abort. */
  readonly reason?: string;
}

/** Fired when an error occurs during the run. */
export interface ErrorEvent extends BaseEvent {
  readonly type: "error";
  /** The error that occurred. */
  readonly error: Error;
  /** Where the error originated. */
  readonly source: "provider" | "tool" | "policy" | "validation" | "observer";
  /** The tool call that caused the error, if applicable. */
  readonly toolCall?: ToolCallPart;
  /** The name of the policy that caused the error, if applicable. */
  readonly policy?: string;
  /** The name of the observer that caused the error, if applicable. */
  readonly observer?: string;
}

/** Discriminated union of all observer events. */
export type ObserverEvent =
  | RunStartEvent
  | RunFinishEvent
  | StepStartEvent
  | StepRetryEvent
  | StepFinishEvent
  | ResponseFinishEvent
  | TextStartEvent
  | TextDeltaEvent
  | TextStopEvent
  | ThinkingStartEvent
  | ThinkingDeltaEvent
  | ThinkingStopEvent
  | ToolCallStartEvent
  | ToolCallDeltaEvent
  | ToolCallStopEvent
  | ToolRunStartEvent
  | ToolRunUpdateEvent
  | ToolRunEndEvent
  | ToolSkipEvent
  | AbortEvent
  | ErrorEvent;

/** Auto-generated typed handler for each event (e.g. `onTextDelta`, `onRunFinish`). */
type EventHandlers = {
  [E in ObserverEvent as `on${Capitalize<E["type"]>}`]?: (event: E) => void | Promise<void>;
};

/**
 * Watches the agent loop and reacts to events.
 *
 * Implement individual `on*` handlers for specific events,
 * or a catch-all {@link Observer.handler} for everything.
 */
export interface Observer extends EventHandlers {
  /** A human-readable name for this observer. */
  name: string;
  /** Catch-all handler invoked for every event. */
  handler?(event: ObserverEvent): void | Promise<void>;
}

/** Create an {@link Observer}. */
export function defineObserver(config: Observer): Observer {
  return config;
}
