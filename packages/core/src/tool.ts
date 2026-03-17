import type { Content } from "./content.ts";
import { json, text } from "./content.ts";
import type { RunContext, ToolContext } from "./context.ts";
import type { AfterToolRunAction, BeforeToolRunAction } from "./policy.ts";
import type { Schema } from "./schema.ts";

/** Flexible return type for tool execution. Strings and objects are auto-wrapped. */
export type ToolReturn = string | Record<string, unknown> | Content[];

/** Declarative tool metadata shared between {@link Tool} and the model API. */
export interface ToolDefinition<T = unknown> {
  /** The tool name exposed to the model. */
  name: string;
  /** Description of what the tool does, sent to the model. */
  description: string;
  /** Schema for argument validation and JSON Schema extraction. */
  schema: Schema<T>;
  /** Maximum execution time in milliseconds before the tool is aborted. */
  timeout?: number;
}

/** A tool the model can invoke. */
export interface Tool<T = unknown> extends ToolDefinition<T> {
  /** Called before execution. Can skip, stop, or modify arguments. */
  before?(
    args: T,
    ctx: RunContext,
  ): void | BeforeToolRunAction | Promise<void | BeforeToolRunAction>;
  /** Execute the tool with validated arguments. */
  execute(args: T, ctx: ToolContext): ToolReturn | Promise<ToolReturn>;
  /** Called after execution. Can rewrite output, retry, or stop the run. */
  after?(
    args: T,
    output: Content[],
    ctx: RunContext,
  ): void | AfterToolRunAction | Promise<void | AfterToolRunAction>;
}

/** Create a type-safe {@link Tool}. Schema infers the argument type. */
export function defineTool<T>(config: Tool<T>): Tool<T> {
  return config;
}

/** Normalize a {@link ToolReturn} into a {@link Content} array. */
export function normalizeToolReturn(value: ToolReturn): Content[] {
  if (typeof value === "string") {
    return [text(value)];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [json(value)];
}
