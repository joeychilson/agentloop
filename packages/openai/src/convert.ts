import type OpenAI from "openai";
import type {
  BlobPart,
  URLPart,
  AssistantContent,
  UserContent,
  ToolResultPart,
  Message,
  FinishReason,
  Usage,
  ToolDefinition,
  StreamPart,
} from "@agentloop/core";
import { schemaToJsonSchema } from "@agentloop/core";

type OAIMessage = OpenAI.ChatCompletionMessageParam;
type OAITool = OpenAI.ChatCompletionTool;
type OAIChunk = OpenAI.ChatCompletionChunk;
type OAIContentPart = OpenAI.ChatCompletionContentPart;

/** Map an OpenAI finish reason to a core {@link FinishReason}. */
export function mapFinishReason(
  reason: "stop" | "length" | "tool_calls" | "content_filter" | "function_call" | null,
): FinishReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
      return "tool_call";
    case "content_filter":
      return "refused";
    case "function_call":
      return "tool_call";
    case null:
    default:
      return "unknown";
  }
}

/** Map OpenAI usage to a core {@link Usage}. */
export function mapUsage(usage: OpenAI.CompletionUsage | undefined | null): Usage {
  if (usage === undefined || usage === null) {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    cacheReadTokens: usage.prompt_tokens_details?.cached_tokens ?? undefined,
  };
}

/** Convert core {@link ToolDefinition} array to OpenAI tool format. */
export function convertToolDefs(tools: ToolDefinition[]): OAITool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: schemaToJsonSchema(t.schema) as OpenAI.FunctionParameters,
    },
  }));
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** Convert a core {@link UserContent} part to an OpenAI content part. */
function convertUserPart(part: UserContent): OAIContentPart {
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

/** Convert a core {@link BlobPart} to an OpenAI content part. */
function convertBlob(part: BlobPart): OAIContentPart {
  const data = typeof part.data === "string" ? part.data : uint8ToBase64(part.data);

  if (IMAGE_TYPES.has(part.mediaType)) {
    return {
      type: "image_url",
      image_url: { url: `data:${part.mediaType};base64,${data}` },
    };
  }

  if (part.mediaType === "audio/wav" || part.mediaType === "audio/mp3") {
    const format = part.mediaType === "audio/wav" ? "wav" : "mp3";
    return { type: "input_audio", input_audio: { data, format } };
  }

  return {
    type: "file",
    file: { file_data: `data:${part.mediaType};base64,${data}` },
  } as OAIContentPart;
}

/** Convert a core {@link URLPart} to an OpenAI content part. */
function convertUrl(part: URLPart): OAIContentPart {
  const isImage =
    part.mediaType !== undefined
      ? IMAGE_TYPES.has(part.mediaType)
      : /\.(jpe?g|png|gif|webp)(\?|$)/i.test(part.url);

  if (isImage) {
    return { type: "image_url", image_url: { url: part.url } };
  }

  return {
    type: "file",
    file: { file_data: part.url },
  } as OAIContentPart;
}

/**
 * Convert a core {@link Message} array into OpenAI's Chat Completions format.
 *
 * System messages become `{ role: "system" }`. Tool messages are split into
 * one `{ role: "tool" }` message per tool result (OpenAI requires one per
 * `tool_call_id`).
 */
export function convertMessages(messages: Message[]): OAIMessage[] {
  const out: OAIMessage[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "system":
        out.push({
          role: "system",
          content: msg.content.map((p) => ({ type: "text" as const, text: p.text })),
        });
        break;

      case "user":
        out.push({
          role: "user",
          content: msg.content.map(convertUserPart),
        });
        break;

      case "assistant":
        out.push(convertAssistantMessage(msg.content));
        break;

      case "tool":
        // OpenAI requires one tool message per tool_call_id.
        for (const result of msg.content) {
          out.push(convertToolResult(result));
        }
        break;
    }
  }

  return out;
}

/** Convert core assistant content to an OpenAI assistant message. */
function convertAssistantMessage(
  content: AssistantContent[],
): OpenAI.ChatCompletionAssistantMessageParam {
  let textContent = "";
  const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];

  for (const part of content) {
    switch (part.type) {
      case "text":
        if (textContent) textContent += "\n";
        textContent += part.text;
        break;

      case "thinking":
        // OpenAI Chat Completions doesn't support thinking blocks — skip.
        break;

      case "tool_call":
        toolCalls.push({
          id: part.id,
          type: "function",
          function: {
            name: part.name,
            arguments: JSON.stringify(part.arguments),
          },
        });
        break;
    }
  }

  const msg: OpenAI.ChatCompletionAssistantMessageParam = {
    role: "assistant",
    content: textContent || null,
  };

  if (toolCalls.length > 0) msg.tool_calls = toolCalls;

  return msg;
}

/** Convert a core tool result to an OpenAI tool message. */
function convertToolResult(part: ToolResultPart): OpenAI.ChatCompletionToolMessageParam {
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
  return { role: "tool", tool_call_id: part.id, content };
}

/**
 * Tracks state during streaming to synthesize start/end events that
 * OpenAI's chunk format doesn't provide explicitly.
 */
export interface StreamState {
  textStarted: boolean;
  toolCalls: Map<number, { id: string; name: string }>;
}

/** Create a fresh {@link StreamState}. */
export function createStreamState(): StreamState {
  return { textStarted: false, toolCalls: new Map() };
}

/**
 * Map a single OpenAI {@link ChatCompletionChunk} to zero or more core
 * {@link StreamPart} values.
 *
 * OpenAI chunks don't have explicit start/end events. We infer them:
 * - First text delta → emit `text_start` then `text_delta`
 * - First delta for a tool call index → emit `tool_call_start`
 * - `finish_reason` present → emit `text_end`/`tool_call_end` + `finish`
 */
export function mapChunk(chunk: OAIChunk, state: StreamState): StreamPart[] {
  const parts: StreamPart[] = [];
  const choice = chunk.choices[0];

  if (choice === undefined) {
    if (chunk.usage) {
      parts.push({
        type: "finish",
        finishReason: "stop",
        usage: mapUsage(chunk.usage),
      });
    }
    return parts;
  }

  const delta = choice.delta;

  if (delta.content) {
    if (!state.textStarted) {
      state.textStarted = true;
      parts.push({ type: "text_start" });
    }
    parts.push({ type: "text_delta", text: delta.content });
  }

  if (delta.tool_calls != null) {
    for (const tc of delta.tool_calls) {
      const existing = state.toolCalls.get(tc.index);

      if (existing === undefined) {
        const id = tc.id ?? "";
        const name = tc.function?.name ?? "";
        state.toolCalls.set(tc.index, { id, name });
        parts.push({ type: "tool_call_start", id, name });
      }

      if (tc.function?.arguments != null) {
        const info = state.toolCalls.get(tc.index)!;
        parts.push({
          type: "tool_call_delta",
          id: info.id,
          args: tc.function.arguments,
        });
      }
    }
  }

  if (choice.finish_reason != null) {
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
      finishReason: mapFinishReason(choice.finish_reason),
      usage: mapUsage(chunk.usage),
    });
  }

  return parts;
}

/** Convert a Uint8Array to a base64 string. */
function uint8ToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}
