import type { Content } from "./content.ts";
import type { RunContext } from "./context.ts";
import type { AssistantMessage, Message } from "./message.ts";
import type { FinishReason, Model, ModelConfig, Usage } from "./model.ts";
import type { Tool } from "./tool.ts";

/** Action returned from {@link Policy.beforeStep}. */
export type BeforeStepAction =
  /** Halt the run. */
  { action: "stop"; reason?: string };

/** Action returned from {@link Policy.afterResponse}. */
export type AfterResponseAction =
  /** Halt the run. Tools never execute. */
  | { action: "stop"; reason?: string }
  /** Replace the model's response with a substitute message. */
  | { action: "replace"; message: AssistantMessage; reason?: string }
  /** Roll back the response and try again with optional guidance. */
  | { action: "retry"; messages?: Message[]; reason?: string };

/** Action returned from {@link Policy.beforeToolRun} and {@link Tool.before}. */
export type BeforeToolRunAction =
  /** Skip this tool call without executing it. */
  | { action: "skip"; output?: Content[]; reason?: string }
  /** Halt the entire run. */
  | { action: "stop"; output?: Content[]; reason?: string };

/** Action returned from {@link Policy.afterToolRun} and {@link Tool.after}. */
export type AfterToolRunAction =
  /** Replace the tool's output. */
  | { action: "rewrite"; output: Content[]; reason?: string }
  /** Re-execute the tool, optionally with different arguments. */
  | { action: "retry"; arguments?: Record<string, unknown>; reason?: string }
  /** Halt the entire run. */
  | { action: "stop"; reason?: string };

/** Action returned from {@link Policy.afterStep}. */
export type AfterStepAction =
  /** Halt the run. */
  | { action: "stop"; reason?: string }
  /** Roll back the entire step and try again with optional guidance. */
  | { action: "retry"; messages?: Message[]; reason?: string }
  /** Inject messages into the transcript and force another model call. */
  | { action: "inject"; messages: Message[] };

/**
 * A mutable plan for the upcoming model call.
 *
 * The loop creates a shallow copy of the transcript for {@link StepPlan.messages},
 * so policies can safely add, remove, or reorder messages without affecting the
 * canonical transcript.
 */
export interface StepPlan extends Partial<ModelConfig> {
  /** The model to use for this step. Policies can swap this to route different steps to different models. */
  model: Model;
  /** System instructions for the model. Converted to a system message before calling the model. */
  instructions?: string;
  /** A draft copy of the transcript. Safe to mutate without affecting the canonical transcript. */
  messages: Message[];
  /** Tools available for this step. Policies can add or remove tools. */
  tools: Tool[];
}

/** Information about the model's response, before tool execution. */
export interface ResponseInfo {
  /** The assistant message. */
  readonly message: AssistantMessage;
  /** The full transcript including the new message. */
  readonly messages: readonly Message[];
  /** Token usage for this response. */
  readonly usage: Usage;
  /** Aggregated token usage across all steps so far. */
  readonly totalUsage: Usage;
  /** Why the model stopped generating. */
  readonly finishReason: FinishReason;
  /** Parsed structured output, if an output schema was provided. */
  readonly object?: unknown;
}

/** Information about a tool call before execution. */
export interface ToolCallInfo {
  /** The tool call ID. */
  readonly id: string;
  /** The tool name. */
  readonly name: string;
  /** Parsed arguments. Mutable for sanitization by policies. */
  arguments: Record<string, unknown>;
}

/** Information about a tool call after execution. */
export interface ToolResultInfo {
  /** The tool call ID. */
  readonly id: string;
  /** The tool name. */
  readonly name: string;
  /** The arguments that were passed to the tool. */
  readonly arguments: Record<string, unknown>;
  /** The output content produced by the tool. */
  readonly output: readonly Content[];
  /** Whether the tool produced an error. */
  readonly isError: boolean;
}

/** Information about a completed step. */
export interface StepInfo {
  /** Messages produced during this step. */
  readonly messages: readonly Message[];
  /** The full transcript. */
  readonly transcript: readonly Message[];
  /** Token usage for this step. */
  readonly usage: Usage;
  /** Aggregated token usage across all steps so far. */
  readonly totalUsage: Usage;
  /** Why the model stopped in this step. */
  readonly finishReason: FinishReason;
  /** Parsed structured output, if an output schema was provided. */
  readonly object?: unknown;
}

/**
 * Controls agent loop behavior at key decision points.
 *
 * Implement any combination of hooks — unimplemented hooks default to
 * continue with no side effects.
 *
 * Policies are evaluated in pipeline order: the first policy to return
 * a non-continue result short-circuits, and later policies are skipped.
 * If a hook returns an error, it is treated as a stop directive.
 */
export interface Policy {
  /** A human-readable name for this policy, used in error attribution and events. */
  name: string;
  /** Called before each model call. Can mutate the step plan or stop the run. */
  beforeStep?(
    ctx: RunContext,
    plan: StepPlan,
  ): void | BeforeStepAction | Promise<void | BeforeStepAction>;
  /** Called after the model responds, before tool execution. */
  afterResponse?(
    ctx: RunContext,
    info: ResponseInfo,
  ): void | AfterResponseAction | Promise<void | AfterResponseAction>;
  /** Called before each individual tool execution. */
  beforeToolRun?(
    ctx: RunContext,
    call: ToolCallInfo,
  ): void | BeforeToolRunAction | Promise<void | BeforeToolRunAction>;
  /** Called after each individual tool execution. */
  afterToolRun?(
    ctx: RunContext,
    result: ToolResultInfo,
  ): void | AfterToolRunAction | Promise<void | AfterToolRunAction>;
  /** Called after the complete step (model response + tool execution). */
  afterStep?(
    ctx: RunContext,
    info: StepInfo,
  ): void | AfterStepAction | Promise<void | AfterStepAction>;
}

/** Create a {@link Policy}. */
export function definePolicy(config: Policy): Policy {
  return config;
}
