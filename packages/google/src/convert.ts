import type {
  Content as GContent,
  FunctionDeclaration,
  GenerateContentResponse,
  GenerateContentResponseUsageMetadata,
  Part as GPart,
} from "@google/genai";
import type {
  AssistantContent,
  BlobPart,
  Content,
  FinishReason,
  Message,
  StreamPart,
  ToolDefinition,
  ToolResultPart,
  URLPart,
  Usage,
  UserContent,
} from "@agentloop/core";
import { schemaToJsonSchema } from "@agentloop/core";

/** Map a Gemini finish reason to a core {@link FinishReason}. */
export function mapFinishReason(
  reason: string | undefined,
  hadFunctionCalls: boolean,
): FinishReason {
  if (reason === "STOP" && hadFunctionCalls) return "tool_call";
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
    case "IMAGE_SAFETY":
    case "IMAGE_PROHIBITED_CONTENT":
      return "refused";
    case "MALFORMED_FUNCTION_CALL":
      return "error";
    default:
      return "unknown";
  }
}

/** Map Gemini usage metadata to a core {@link Usage}. */
export function mapUsage(meta: GenerateContentResponseUsageMetadata | undefined): Usage {
  if (meta === undefined) {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
  return {
    inputTokens: meta.promptTokenCount ?? 0,
    outputTokens: meta.candidatesTokenCount ?? 0,
    totalTokens: meta.totalTokenCount ?? 0,
    cacheReadTokens: meta.cachedContentTokenCount ?? undefined,
  };
}

/** Convert core {@link ToolDefinition} array to Gemini function declarations. */
export function convertToolDefs(tools: ToolDefinition[]): FunctionDeclaration[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: schemaToJsonSchema(t.schema),
  }));
}

/** Convert a core {@link UserContent} part to a Gemini {@link GPart}. */
function convertUserPart(part: UserContent): GPart {
  switch (part.type) {
    case "text":
      return { text: part.text };
    case "json":
      return { text: JSON.stringify(part.json) };
    case "blob":
      return convertBlob(part);
    case "url":
      return convertUrl(part);
  }
}

/** Convert a core {@link BlobPart} to a Gemini inline data part. */
function convertBlob(part: BlobPart): GPart {
  const data = typeof part.data === "string" ? part.data : uint8ToBase64(part.data);
  return { inlineData: { data, mimeType: part.mediaType } };
}

/** Convert a core {@link URLPart} to a Gemini file data part. */
function convertUrl(part: URLPart): GPart {
  return { fileData: { fileUri: part.url, mimeType: part.mediaType } };
}

/** Convert a core {@link AssistantContent} part to a Gemini {@link GPart}. */
function convertAssistantPart(part: AssistantContent): GPart {
  switch (part.type) {
    case "text":
      return { text: part.text };

    case "thinking":
      if (part.redacted) {
        // Redacted thinking: no visible text, only the signature.
        return { thought: true, thoughtSignature: part.signature };
      }
      return {
        text: part.thinking,
        thought: true,
        ...(part.signature !== undefined && { thoughtSignature: part.signature }),
      };

    case "tool_call":
      return {
        functionCall: {
          id: part.id,
          name: part.name,
          args: part.arguments,
        },
        ...(part.signature !== undefined && { thoughtSignature: part.signature }),
      };
  }
}

/** Convert a core {@link ToolResultPart} to a Gemini function response part. */
function convertToolResult(part: ToolResultPart): GPart {
  let responseObj: Record<string, unknown>;

  if (part.isError) {
    const errorText = part.output
      .map((p) => (p.type === "text" ? p.text : JSON.stringify(p)))
      .join("");
    responseObj = { error: errorText };
  } else {
    responseObj = { output: serializeToolOutput(part.output) };
  }

  return {
    functionResponse: {
      id: part.id,
      name: part.name,
      response: responseObj,
    },
  };
}

/** Serialize tool output content to a JSON-friendly value. */
function serializeToolOutput(output: Content[]): unknown {
  if (output.length === 1) {
    const part = output[0]!;
    if (part.type === "text") return part.text;
    if (part.type === "json") return part.json;
  }
  return output.map((p) => {
    switch (p.type) {
      case "text":
        return p.text;
      case "json":
        return p.json;
      default:
        return `[${p.type}]`;
    }
  });
}

/**
 * Convert a core {@link Message} array into Gemini's content format.
 *
 * Returns the `systemInstruction` (extracted from system messages) and the
 * `contents` array. Gemini uses `"user"` and `"model"` roles. Tool results
 * go in a `"user"` content with `functionResponse` parts.
 */
export function convertMessages(messages: Message[]): {
  systemInstruction: string | undefined;
  contents: GContent[];
} {
  let systemInstruction: string | undefined;
  const contents: GContent[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "system":
        systemInstruction = msg.content.map((p) => p.text).join("\n");
        break;

      case "user":
        contents.push({
          role: "user",
          parts: msg.content.map(convertUserPart),
        });
        break;

      case "assistant":
        contents.push({
          role: "model",
          parts: msg.content.map(convertAssistantPart),
        });
        break;

      case "tool":
        contents.push({
          role: "user",
          parts: msg.content.map(convertToolResult),
        });
        break;
    }
  }

  return { systemInstruction, contents };
}

/**
 * Tracks state during streaming to synthesize start/end events.
 * Gemini streaming chunks don't have explicit content block start/end markers.
 */
export interface StreamState {
  inText: boolean;
  inThinking: boolean;
  hadFunctionCalls: boolean;
  pendingSignature?: string;
}

/** Create a fresh {@link StreamState}. */
export function createStreamState(): StreamState {
  return { inText: false, inThinking: false, hadFunctionCalls: false };
}

/**
 * Map a Gemini streaming chunk to core {@link StreamPart} values.
 *
 * Each chunk is a full {@link GenerateContentResponse} with incremental parts.
 * We synthesize text_start/end and thinking_start/end from the part transitions.
 */
export function mapChunk(chunk: GenerateContentResponse, state: StreamState): StreamPart[] {
  const parts: StreamPart[] = [];
  const candidate = chunk.candidates?.[0];

  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.thought === true && part.text !== undefined) {
        if (state.inText) {
          parts.push({ type: "text_end" });
          state.inText = false;
        }
        if (!state.inThinking) {
          state.inThinking = true;
          parts.push({ type: "thinking_start" });
        }
        parts.push({ type: "thinking_delta", thinking: part.text });

        if (part.thoughtSignature !== undefined) {
          state.pendingSignature = part.thoughtSignature;
        }
        continue;
      }

      if (part.text !== undefined && part.thought !== true) {
        if (state.inThinking) {
          parts.push({
            type: "thinking_end",
            signature: state.pendingSignature as string | undefined,
          });
          state.inThinking = false;
          state.pendingSignature = undefined;
        }
        if (!state.inText) {
          state.inText = true;
          parts.push({ type: "text_start" });
        }
        parts.push({ type: "text_delta", text: part.text });
        continue;
      }

      if (part.functionCall !== undefined) {
        if (state.inText) {
          parts.push({ type: "text_end" });
          state.inText = false;
        }
        if (state.inThinking) {
          parts.push({
            type: "thinking_end",
            signature: state.pendingSignature as string | undefined,
          });
          state.inThinking = false;
          state.pendingSignature = undefined;
        }

        const fc = part.functionCall;
        const id = fc.id ?? "";
        const name = fc.name ?? "";
        const args = JSON.stringify(fc.args ?? {});
        state.hadFunctionCalls = true;

        parts.push({ type: "tool_call_start", id, name, signature: part.thoughtSignature });
        parts.push({ type: "tool_call_delta", id, args });
        parts.push({ type: "tool_call_end", id });
        continue;
      }
    }
  }

  if (candidate?.finishReason !== undefined) {
    if (state.inText) {
      parts.push({ type: "text_end" });
      state.inText = false;
    }
    if (state.inThinking) {
      parts.push({
        type: "thinking_end",
        signature: state.pendingSignature as string | undefined,
      });
      state.inThinking = false;
    }

    parts.push({
      type: "finish",
      finishReason: mapFinishReason(candidate.finishReason, state.hadFunctionCalls),
      usage: mapUsage(chunk.usageMetadata),
    });
  }

  return parts;
}

/** Convert a Uint8Array to a base64 string. */
function uint8ToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}
