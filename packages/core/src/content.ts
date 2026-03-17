/** Plain text content. */
export interface TextPart {
  /** Part discriminator. */
  type: "text";
  /** The text content. */
  text: string;
  /** Provider-specific signature for reasoning verification. */
  signature?: string;
  /** Arbitrary key-value pairs for provider or application use. */
  metadata?: Record<string, unknown>;
}

/** Structured JSON content. */
export interface JsonPart {
  /** Part discriminator. */
  type: "json";
  /** The JSON payload. */
  json: Record<string, unknown>;
  /** Arbitrary key-value pairs for provider or application use. */
  metadata?: Record<string, unknown>;
}

/** Inline binary data (images, audio, video, documents, etc.). */
export interface BlobPart {
  /** Part discriminator. */
  type: "blob";
  /** Raw binary content or a base64-encoded string. */
  data: string | Uint8Array;
  /** MIME type of the binary data (e.g. `"image/png"`, `"audio/wav"`). */
  mediaType: string;
  /** Arbitrary key-value pairs for provider or application use. */
  metadata?: Record<string, unknown>;
}

/** Reference to an external resource. */
export interface URLPart {
  /** Part discriminator. */
  type: "url";
  /** The resource URL. */
  url: string;
  /** Optional MIME type hint for the referenced resource. */
  mediaType?: string;
  /** Arbitrary key-value pairs for provider or application use. */
  metadata?: Record<string, unknown>;
}

/** Model reasoning trace. */
export interface ThinkingPart {
  /** Part discriminator. */
  type: "thinking";
  /** The model's internal reasoning text. */
  thinking: string;
  /** Provider-specific signature for thinking verification. */
  signature?: string;
  /** Whether the thinking content was redacted by the provider. */
  redacted: boolean;
}

/** A request from the model to invoke a tool. */
export interface ToolCallPart {
  /** Part discriminator. */
  type: "tool_call";
  /** Unique identifier for this tool call, used to match results. */
  id: string;
  /** The name of the tool to invoke. */
  name: string;
  /** The arguments to pass to the tool. */
  arguments: Record<string, unknown>;
  /** Provider-specific signature for tool call verification. */
  signature?: string;
}

/** The result of a tool invocation. */
export interface ToolResultPart {
  /** Part discriminator. */
  type: "tool_result";
  /** Identifier matching the originating {@link ToolCallPart.id}. */
  id: string;
  /** The name of the tool that was invoked. */
  name: string;
  /** The content returned by the tool. */
  output: Content[];
  /** Whether the tool invocation failed. */
  isError?: boolean;
}

/** Renderable content: text, structured data, or binary/external media. */
export type Content = TextPart | JsonPart | BlobPart | URLPart;

/** Content that can appear in a system message. */
export type SystemContent = TextPart;

/** Content that can appear in a user message. */
export type UserContent = TextPart | JsonPart | BlobPart | URLPart;

/** Content that can appear in an assistant message. */
export type AssistantContent = TextPart | ThinkingPart | ToolCallPart;

/** Content that can appear in a tool message. */
export type ToolContent = ToolResultPart;

/** Create a {@link TextPart}. */
export function text(value: string): TextPart {
  return { type: "text", text: value };
}

/** Create a {@link JsonPart}. */
export function json(value: Record<string, unknown>): JsonPart {
  return { type: "json", json: value };
}

/** Create a {@link BlobPart}. */
export function blob(data: string | Uint8Array, mediaType: string): BlobPart {
  return { type: "blob", data, mediaType };
}

/** Create a {@link URLPart}. */
export function url(value: string, mediaType?: string): URLPart {
  return { type: "url", url: value, ...(mediaType != null && { mediaType }) };
}
