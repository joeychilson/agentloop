import type {
  Message as ORMessage,
  ChatGenerationTokenUsage,
  ChatStreamingResponseChunk,
  ToolDefinitionJson,
  ResponseFormatJSONSchema,
} from "@openrouter/sdk/models";
import type {
  AssistantContent,
  BlobPart,
  URLPart,
  UserContent,
  ToolResultPart,
  Message,
  FinishReason,
  Usage,
  ToolDefinition,
  StreamPart,
} from "@agentloop/core";
import { schemaToJsonSchema } from "@agentloop/core";

/** Map an OpenRouter finish reason to a core {@link FinishReason}. */
export function mapFinishReason(reason: unknown): FinishReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
      return "tool_call";
    case "content_filter":
      return "refused";
    case "error":
      return "error";
    default:
      return "unknown";
  }
}

/** Map OpenRouter usage to a core {@link Usage}. */
export function mapUsage(usage: ChatGenerationTokenUsage | undefined): Usage {
  if (usage === undefined) {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
  return {
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.promptTokensDetails?.cachedTokens ?? undefined,
    cacheWriteTokens: usage.promptTokensDetails?.cacheWriteTokens ?? undefined,
  };
}

/** Convert core {@link ToolDefinition} array to OpenRouter tool format. */
export function convertToolDefs(tools: ToolDefinition[]): ToolDefinitionJson[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: schemaToJsonSchema(t.schema),
    },
  }));
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** Convert a core {@link UserContent} part to an OpenRouter content part. */
function convertUserPart(part: UserContent): { type: string; [key: string]: unknown } {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "json":
      return { type: "text", text: JSON.stringify(part.json) };
    case "blob":
      return convertBlob(part);
    case "url":
      return convertUrl(part);
  }
}

/** Convert a core {@link BlobPart} to an OpenRouter content part. */
function convertBlob(part: BlobPart): { type: string; [key: string]: unknown } {
  const data = typeof part.data === "string" ? part.data : uint8ToBase64(part.data);

  if (IMAGE_TYPES.has(part.mediaType)) {
    return {
      type: "image_url",
      imageUrl: { url: `data:${part.mediaType};base64,${data}` },
    };
  }

  if (part.mediaType.startsWith("audio/")) {
    const format = part.mediaType.split("/")[1] ?? "wav";
    return { type: "input_audio", inputAudio: { data, format } };
  }

  if (part.mediaType.startsWith("video/")) {
    return { type: "video_url", videoUrl: { url: `data:${part.mediaType};base64,${data}` } };
  }

  return {
    type: "file",
    file: { fileData: `data:${part.mediaType};base64,${data}` },
  };
}

/** Convert a core {@link URLPart} to an OpenRouter content part. */
function convertUrl(part: URLPart): { type: string; [key: string]: unknown } {
  const isImage =
    part.mediaType !== undefined
      ? IMAGE_TYPES.has(part.mediaType)
      : /\.(jpe?g|png|gif|webp)(\?|$)/i.test(part.url);

  if (isImage) {
    return { type: "image_url", imageUrl: { url: part.url } };
  }

  const isVideo =
    part.mediaType !== undefined
      ? part.mediaType.startsWith("video/")
      : /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(part.url);

  if (isVideo) {
    return { type: "video_url", videoUrl: { url: part.url } };
  }

  return { type: "file", file: { fileData: part.url } };
}

/**
 * Convert a core {@link Message} array into OpenRouter's Chat Completions format.
 *
 * Tool messages are split into one message per tool result (OpenRouter requires
 * one per `toolCallId`). System messages use `role: "system"`.
 */
export function convertMessages(messages: Message[]): ORMessage[] {
  const out: ORMessage[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "system":
        out.push({
          role: "system",
          content: msg.content.map((p) => p.text).join("\n"),
        });
        break;

      case "user":
        out.push({
          role: "user",
          content: msg.content.map(convertUserPart),
        } as ORMessage);
        break;

      case "assistant":
        out.push(convertAssistantMessage(msg.content));
        break;

      case "tool":
        for (const result of msg.content) {
          out.push(convertToolResult(result));
        }
        break;
    }
  }

  return out;
}

/** Convert core assistant content to an OpenRouter assistant message. */
function convertAssistantMessage(content: AssistantContent[]): ORMessage {
  let textContent = "";
  let reasoning: string | undefined;
  const toolCalls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }> = [];

  for (const part of content) {
    switch (part.type) {
      case "text":
        if (textContent) textContent += "\n";
        textContent += part.text;
        break;
      case "thinking":
        if (reasoning === undefined) reasoning = "";
        reasoning += part.thinking;
        break;
      case "tool_call":
        toolCalls.push({
          id: part.id,
          type: "function",
          function: { name: part.name, arguments: JSON.stringify(part.arguments) },
        });
        break;
    }
  }

  const msg: Record<string, unknown> = {
    role: "assistant",
    content: textContent || null,
  };
  if (reasoning !== undefined) msg.reasoning = reasoning;
  if (toolCalls.length > 0) msg.toolCalls = toolCalls;

  return msg as ORMessage;
}

/** Convert a core tool result to an OpenRouter tool message. */
function convertToolResult(part: ToolResultPart): ORMessage {
  let content = "";
  for (const item of part.output) {
    switch (item.type) {
      case "text":
        content += item.text;
        break;
      case "json":
        content += JSON.stringify(item.json);
        break;
      default:
        content += `[${item.type}]`;
        break;
    }
  }
  return { role: "tool", toolCallId: part.id, content } as ORMessage;
}

/** Build an OpenRouter response format for structured JSON output. */
export function buildResponseFormat(jsonSchema: Record<string, unknown>): ResponseFormatJSONSchema {
  return {
    type: "json_schema",
    jsonSchema: {
      name: "output",
      schema: ensureStrictObjects(jsonSchema),
      strict: true,
    },
  };
}

/**
 * Tracks state during streaming to synthesize start/end events.
 * Same approach as the OpenAI provider since the chunk format is structurally identical.
 */
export interface StreamState {
  textStarted: boolean;
  reasoningStarted: boolean;
  toolCalls: Map<number, { id: string; name: string }>;
}

/** Create a fresh {@link StreamState}. */
export function createStreamState(): StreamState {
  return { textStarted: false, reasoningStarted: false, toolCalls: new Map() };
}

/**
 * Map a single OpenRouter streaming chunk to core {@link StreamPart} values.
 *
 * Handles text deltas, reasoning deltas (→ thinking events), tool call deltas,
 * and finish reasons. Synthesizes start/end events from state transitions.
 */
export function mapChunk(chunk: ChatStreamingResponseChunk, state: StreamState): StreamPart[] {
  const parts: StreamPart[] = [];

  if (chunk.error) {
    parts.push({ type: "error", error: new Error(chunk.error.message) });
    return parts;
  }

  const choice = chunk.choices[0];

  if (choice === undefined) {
    if (chunk.usage) {
      parts.push({ type: "finish", finishReason: "stop", usage: mapUsage(chunk.usage) });
    }
    return parts;
  }

  const delta = choice.delta;

  if (delta.reasoning) {
    if (state.textStarted) {
      parts.push({ type: "text_end" });
      state.textStarted = false;
    }
    if (!state.reasoningStarted) {
      state.reasoningStarted = true;
      parts.push({ type: "thinking_start" });
    }
    parts.push({ type: "thinking_delta", thinking: delta.reasoning });
  }

  if (delta.content) {
    if (state.reasoningStarted) {
      parts.push({ type: "thinking_end" });
      state.reasoningStarted = false;
    }
    if (!state.textStarted) {
      state.textStarted = true;
      parts.push({ type: "text_start" });
    }
    parts.push({ type: "text_delta", text: delta.content });
  }

  if (delta.toolCalls != null) {
    for (const tc of delta.toolCalls) {
      const existing = state.toolCalls.get(tc.index);

      if (existing === undefined) {
        const id = tc.id ?? "";
        const name = tc.function?.name ?? "";
        state.toolCalls.set(tc.index, { id, name });
        parts.push({ type: "tool_call_start", id, name });
      }

      if (tc.function?.arguments != null) {
        const info = state.toolCalls.get(tc.index)!;
        parts.push({ type: "tool_call_delta", id: info.id, args: tc.function.arguments });
      }
    }
  }

  if (choice.finishReason != null) {
    if (state.reasoningStarted) {
      parts.push({ type: "thinking_end" });
      state.reasoningStarted = false;
    }
    if (state.textStarted) {
      parts.push({ type: "text_end" });
      state.textStarted = false;
    }
    for (const [, info] of state.toolCalls) {
      parts.push({ type: "tool_call_end", id: info.id });
    }
    state.toolCalls.clear();

    parts.push({
      type: "finish",
      finishReason: mapFinishReason(choice.finishReason),
      usage: mapUsage(chunk.usage),
    });
  }

  return parts;
}

/** Recursively add `additionalProperties: false` to all object schemas. */
function ensureStrictObjects(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.type === "object") {
    schema.additionalProperties = false;
    if (schema.properties !== null && typeof schema.properties === "object") {
      for (const value of Object.values(schema.properties as Record<string, unknown>)) {
        if (value !== null && typeof value === "object") {
          ensureStrictObjects(value as Record<string, unknown>);
        }
      }
    }
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(schema[key])) {
      for (const item of schema[key] as Record<string, unknown>[]) {
        ensureStrictObjects(item);
      }
    }
  }
  if (schema.$defs !== null && typeof schema.$defs === "object") {
    for (const value of Object.values(schema.$defs as Record<string, unknown>)) {
      if (value !== null && typeof value === "object") {
        ensureStrictObjects(value as Record<string, unknown>);
      }
    }
  }
  return schema;
}

/** Convert a Uint8Array to a base64 string. */
function uint8ToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}
