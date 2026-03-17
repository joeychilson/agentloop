import type { Message } from "./message.ts";
import type { Schema } from "./schema.ts";
import type { ToolDefinition } from "./tool.ts";

/** Normalized reason the model stopped generating. */
export type FinishReason =
  /** The model finished generating naturally. */
  | "stop"
  /** The model requested a tool invocation. */
  | "tool_call"
  /** The generation hit the maximum token limit. */
  | "length"
  /** The model stopped at a configured stop sequence. */
  | "stop_sequence"
  /** The generation was cancelled by the client. */
  | "cancelled"
  /** The model refused to generate (content policy). */
  | "refused"
  /** An error occurred during generation. */
  | "error"
  /** The provider returned an unrecognized finish reason. */
  | "unknown";

/** Token usage statistics for a model call. */
export interface Usage {
  /** Number of tokens in the input/prompt. */
  inputTokens: number;
  /** Number of tokens in the generated output. */
  outputTokens: number;
  /** Total tokens (input + output). */
  totalTokens: number;
  /** Tokens read from cache (e.g. Anthropic prompt caching, Google cached content). */
  cacheReadTokens?: number;
  /** Tokens written to cache (e.g. Anthropic cache creation). */
  cacheWriteTokens?: number;
}

/** Individual chunks yielded by a model during streaming. */
export type StreamPart =
  /** The model began producing text. */
  | { type: "text_start" }
  /** A chunk of text output. */
  | { type: "text_delta"; text: string }
  /** The model finished producing text. */
  | { type: "text_end" }
  /** The model began a reasoning trace. */
  | { type: "thinking_start"; redacted?: boolean }
  /** A chunk of reasoning output. */
  | { type: "thinking_delta"; thinking: string }
  /** The model finished a reasoning trace. */
  | { type: "thinking_end"; signature?: string }
  /** A new tool call has started. */
  | { type: "tool_call_start"; id: string; name: string; signature?: string }
  /** A chunk of tool call arguments (partial JSON). */
  | { type: "tool_call_delta"; id: string; args: string }
  /** A tool call is complete. */
  | { type: "tool_call_end"; id: string }
  /** The model finished generating. */
  | { type: "finish"; finishReason: FinishReason; usage: Usage }
  /** An error occurred during streaming. */
  | { type: "error"; error: Error };

/** Configuration knobs for a model call. */
export interface ModelConfig {
  /** Maximum tokens to generate. */
  maxTokens?: number;
  /** Sampling temperature. */
  temperature?: number;
  /** Top-p (nucleus) sampling. */
  topP?: number;
  /** Top-k sampling. */
  topK?: number;
  /** Stop sequences. */
  stopSequences?: string[];
}

/** A configured model instance returned by a {@link Provider}. */
export interface Model {
  /** The model identifier (e.g. "claude-sonnet-4-20250514"). */
  name: string;
  /** Stream a response as incremental parts. */
  stream(options: {
    /** The conversation messages. */
    messages: Message[];
    /** Tool definitions available to the model. */
    tools?: ToolDefinition[];
    /** Per-call config overrides. */
    config?: ModelConfig;
    /** Schema for structured output. */
    output?: Schema;
    /** Signal for cooperative cancellation. */
    signal?: AbortSignal;
  }): AsyncIterable<StreamPart>;
}

/** Configuration for a provider connection. */
export interface ProviderConfig {
  /** API key for authentication. */
  apiKey?: string;
  /** Base URL for the API. */
  baseUrl?: string;
  /** Request timeout in milliseconds. */
  timeout?: number;
  /** Maximum number of retries on transient failures. */
  maxRetries?: number;
  /** Additional headers to include in requests. */
  headers?: Record<string, string>;
}

/** Factory for creating {@link Model} instances. */
export interface Provider {
  /** Create a model instance with optional default config. */
  model(name: string, config?: ModelConfig): Model;
}

/** Create an empty {@link Usage}. */
export function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

/** Add two {@link Usage} objects together. */
export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0) || undefined,
    cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0) || undefined,
  };
}
