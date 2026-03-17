import type Anthropic from "@anthropic-ai/sdk";
import type {
  Content,
  BlobPart,
  URLPart,
  AssistantContent,
  SystemContent,
  UserContent,
  ToolResultPart,
  Message,
  FinishReason,
  Usage,
  ToolDefinition,
  StreamPart,
} from "@agentloop/core";
import { schemaToJsonSchema } from "@agentloop/core";

type AntBlockParam = Anthropic.Messages.ContentBlockParam;
type AntTextBlock = Anthropic.Messages.TextBlockParam;
type AntImageBlock = Anthropic.Messages.ImageBlockParam;
type AntDocBlock = Anthropic.Messages.DocumentBlockParam;
type AntCacheControl = Anthropic.Messages.CacheControlEphemeral;

/** Map an Anthropic stop reason to a core {@link FinishReason}. */
export function mapFinishReason(reason: Anthropic.Messages.StopReason | null): FinishReason {
  switch (reason) {
    case "end_turn":
    case "pause_turn":
      return "stop";
    case "tool_use":
      return "tool_call";
    case "max_tokens":
      return "length";
    case "stop_sequence":
      return "stop_sequence";
    case "refusal":
      return "refused";
    case null:
    default:
      return "unknown";
  }
}

/** Map Anthropic usage to a core {@link Usage}. */
export function mapUsage(usage: Anthropic.Messages.Usage): Usage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.input_tokens + usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? undefined,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? undefined,
  };
}

/** Map Anthropic delta usage (from `message_delta` event) to a core {@link Usage}. */
export function mapDeltaUsage(usage: Anthropic.Messages.MessageDeltaUsage): Usage {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens,
    totalTokens: (usage.input_tokens ?? 0) + usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? undefined,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? undefined,
  };
}

/** Convert core {@link ToolDefinition} array to Anthropic tool format. */
export function convertToolDefs(tools: ToolDefinition[]): Anthropic.Messages.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: schemaToJsonSchema(t.schema) as Anthropic.Messages.Tool["input_schema"],
  }));
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** Convert core system content to Anthropic text blocks for the `system` parameter. */
export function convertSystem(content: SystemContent[]): AntTextBlock[] {
  return content.map((part): AntTextBlock => {
    const block: AntTextBlock = { type: "text", text: part.text };
    applyCacheControl(part.metadata, block);
    return block;
  });
}

/** Convert a core user content part to an Anthropic content block. */
function convertUserPart(part: UserContent): AntBlockParam {
  switch (part.type) {
    case "text": {
      const block: AntTextBlock = { type: "text", text: part.text };
      applyCacheControl(part.metadata, block);
      return block;
    }
    case "json":
      return { type: "text", text: JSON.stringify(part.json) } satisfies AntTextBlock;

    case "blob":
      return convertBlob(part);

    case "url":
      return convertUrl(part);
  }
}

/** Convert a core blob to an Anthropic image or document block. */
function convertBlob(part: BlobPart): AntImageBlock | AntDocBlock {
  const data = typeof part.data === "string" ? part.data : uint8ToBase64(part.data);

  if (IMAGE_TYPES.has(part.mediaType)) {
    const block: AntImageBlock = {
      type: "image",
      source: {
        type: "base64",
        data,
        media_type: part.mediaType as Anthropic.Messages.Base64ImageSource["media_type"],
      },
    };
    applyCacheControl(part.metadata, block);
    return block;
  }

  if (part.mediaType === "application/pdf") {
    const block: AntDocBlock = {
      type: "document",
      source: { type: "base64", data, media_type: "application/pdf" },
    };
    applyCacheControl(part.metadata, block);
    return block;
  }

  if (part.mediaType === "text/plain") {
    const block: AntDocBlock = {
      type: "document",
      source: { type: "text", data, media_type: "text/plain" },
    };
    applyCacheControl(part.metadata, block);
    return block;
  }

  // Fallback: treat as PDF (closest Anthropic type for arbitrary binary).
  const block: AntDocBlock = {
    type: "document",
    source: { type: "base64", data, media_type: "application/pdf" },
  };
  applyCacheControl(part.metadata, block);
  return block;
}

/** Convert a core URL to an Anthropic image or document block. */
function convertUrl(part: URLPart): AntImageBlock | AntDocBlock {
  const isImage =
    part.mediaType !== undefined
      ? IMAGE_TYPES.has(part.mediaType)
      : /\.(jpe?g|png|gif|webp)(\?|$)/i.test(part.url);

  if (isImage) {
    const block: AntImageBlock = {
      type: "image",
      source: { type: "url", url: part.url },
    };
    applyCacheControl(part.metadata, block);
    return block;
  }

  const block: AntDocBlock = {
    type: "document",
    source: { type: "url", url: part.url },
  };
  applyCacheControl(part.metadata, block);
  return block;
}

/** Convert a core assistant content part to an Anthropic content block. */
function convertAssistantPart(part: AssistantContent): AntBlockParam {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text } satisfies AntTextBlock;

    case "thinking":
      if (part.redacted) {
        return {
          type: "redacted_thinking",
          data: part.thinking,
        } satisfies Anthropic.Messages.RedactedThinkingBlockParam;
      }
      return {
        type: "thinking",
        thinking: part.thinking,
        signature: part.signature ?? "",
      } satisfies Anthropic.Messages.ThinkingBlockParam;

    case "tool_call":
      return {
        type: "tool_use",
        id: part.id,
        name: part.name,
        input: part.arguments,
      } satisfies Anthropic.Messages.ToolUseBlockParam;
  }
}

/** Convert a core tool result part to an Anthropic tool result block. */
function convertToolResult(part: ToolResultPart): Anthropic.Messages.ToolResultBlockParam {
  const block: Anthropic.Messages.ToolResultBlockParam = {
    type: "tool_result",
    tool_use_id: part.id,
  };

  if (part.isError) block.is_error = true;

  if (part.output.length > 0) {
    block.content = convertToolResultContent(part.output);
  }

  return block;
}

/** Convert tool output to Anthropic-compatible result content. */
function convertToolResultContent(
  output: Content[],
): Array<AntTextBlock | AntImageBlock | AntDocBlock> {
  const blocks: Array<AntTextBlock | AntImageBlock | AntDocBlock> = [];

  for (const part of output) {
    switch (part.type) {
      case "text":
        blocks.push({ type: "text", text: part.text });
        break;
      case "json":
        blocks.push({ type: "text", text: JSON.stringify(part.json) });
        break;
      case "blob":
        blocks.push(convertBlob(part));
        break;
      case "url":
        blocks.push(convertUrl(part));
        break;
    }
  }

  return blocks;
}

/**
 * Convert a core {@link Message} array into Anthropic's API format.
 *
 * Returns the extracted `system` parameter and the `messages` array.
 * Tool messages (role "tool") become user messages with `tool_result`
 * blocks, per Anthropic's API requirement.
 */
export function convertMessages(messages: Message[]): {
  system: AntTextBlock[] | undefined;
  messages: Anthropic.Messages.MessageParam[];
} {
  let system: AntTextBlock[] | undefined;
  const out: Anthropic.Messages.MessageParam[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "system":
        system = convertSystem(msg.content);
        break;

      case "user":
        out.push({
          role: "user",
          content: msg.content.map(convertUserPart),
        });
        break;

      case "assistant":
        out.push({
          role: "assistant",
          content: msg.content.map(convertAssistantPart),
        });
        break;

      case "tool":
        out.push({
          role: "user",
          content: msg.content.map(convertToolResult),
        });
        break;
    }
  }

  return { system, messages: out };
}

/**
 * Tracks active content blocks during streaming so we can map Anthropic's
 * index-based events to our id/name-based {@link StreamPart} values.
 */
export interface StreamState {
  blocks: Map<number, { type: string; id?: string; name?: string; signature?: string }>;
}

/** Create a fresh {@link StreamState}. */
export function createStreamState(): StreamState {
  return { blocks: new Map() };
}

/**
 * Map a single Anthropic streaming event to zero or more core {@link StreamPart} values.
 *
 * Some Anthropic events produce no StreamPart (e.g., `message_start`).
 * Some produce one (e.g., `content_block_delta` with `text_delta`).
 * `message_delta` produces a `finish` part with usage and stop reason.
 */
export function mapStreamEvent(
  event: Anthropic.Messages.RawMessageStreamEvent,
  state: StreamState,
): StreamPart[] {
  switch (event.type) {
    case "message_start":
      return [];

    case "content_block_start": {
      const block = event.content_block;
      state.blocks.set(event.index, {
        type: block.type,
        id: "id" in block ? (block.id as string) : undefined,
        name: "name" in block ? (block.name as string) : undefined,
      });

      switch (block.type) {
        case "text":
          return [{ type: "text_start" }];
        case "thinking":
          return [{ type: "thinking_start" }];
        case "redacted_thinking":
          return [
            { type: "thinking_start", redacted: true },
            { type: "thinking_delta", thinking: block.data },
          ];
        case "tool_use":
          return [{ type: "tool_call_start", id: block.id, name: block.name }];
        default:
          return [];
      }
    }

    case "content_block_delta": {
      const info = state.blocks.get(event.index);

      switch (event.delta.type) {
        case "text_delta":
          return [{ type: "text_delta", text: event.delta.text }];
        case "thinking_delta":
          return [{ type: "thinking_delta", thinking: event.delta.thinking }];
        case "signature_delta":
          if (info) info.signature = event.delta.signature;
          return [];
        case "input_json_delta":
          if (info?.id !== undefined) {
            return [{ type: "tool_call_delta", id: info.id, args: event.delta.partial_json }];
          }
          return [];
        default:
          return [];
      }
    }

    case "content_block_stop": {
      const info = state.blocks.get(event.index);
      state.blocks.delete(event.index);
      if (info === undefined) return [];

      switch (info.type) {
        case "text":
          return [{ type: "text_end" }];
        case "thinking":
          return [{ type: "thinking_end", signature: info.signature }];
        case "redacted_thinking":
          return [{ type: "thinking_end" }];
        case "tool_use":
          return info.id !== undefined ? [{ type: "tool_call_end", id: info.id }] : [];
        default:
          return [];
      }
    }

    case "message_delta":
      return [
        {
          type: "finish",
          finishReason: mapFinishReason(event.delta.stop_reason),
          usage:
            event.usage !== undefined
              ? mapDeltaUsage(event.usage)
              : { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        },
      ];

    case "message_stop":
      return [];

    default:
      return [];
  }
}

/** Apply `cache_control` from metadata onto an Anthropic block, if present. */
function applyCacheControl(
  metadata: Record<string, unknown> | undefined,
  block: { cache_control?: AntCacheControl | null },
): void {
  if (metadata?.cache_control) {
    block.cache_control = metadata.cache_control as AntCacheControl;
  }
}

/** Convert a Uint8Array to a base64 string. */
function uint8ToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}
