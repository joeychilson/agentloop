import OpenAI from "openai";
import type {
  Model,
  ModelConfig,
  Provider,
  ProviderConfig,
  StreamPart,
  Schema,
  Message,
  ToolDefinition,
} from "@agentloop/core";
import { schemaToJsonSchema } from "@agentloop/core";
import { convertMessages, convertToolDefs, createStreamState, mapChunk } from "./convert.ts";

/** OpenAI-specific model configuration, extending core {@link ModelConfig}. */
export interface OpenAIModelConfig extends ModelConfig {
  /** Reasoning effort for o1/o3/gpt-5 models. */
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
}

/** Create an OpenAI {@link Provider}. */
export function createOpenAI(config?: ProviderConfig): Provider {
  const client = new OpenAI({
    apiKey: config?.apiKey,
    baseURL: config?.baseUrl,
    timeout: config?.timeout,
    maxRetries: config?.maxRetries,
    defaultHeaders: config?.headers,
  });

  return {
    model(name: string, defaults?: ModelConfig): Model {
      const modelDefaults = defaults as OpenAIModelConfig | undefined;

      return {
        name,
        stream(options: {
          messages: Message[];
          tools?: ToolDefinition[];
          config?: ModelConfig;
          output?: Schema;
          signal?: AbortSignal;
        }): AsyncIterable<StreamPart> {
          const callConfig = options.config as OpenAIModelConfig | undefined;

          const messages = convertMessages(options.messages);

          const params: OpenAI.ChatCompletionCreateParamsStreaming = {
            model: name,
            messages,
            stream: true,
            stream_options: { include_usage: true },
          };

          const maxTokens = callConfig?.maxTokens ?? modelDefaults?.maxTokens;
          if (maxTokens !== undefined) params.max_completion_tokens = maxTokens;

          const reasoningEffort = callConfig?.reasoningEffort ?? modelDefaults?.reasoningEffort;
          if (reasoningEffort === undefined) {
            const temperature = callConfig?.temperature ?? modelDefaults?.temperature;
            if (temperature !== undefined) params.temperature = temperature;

            const topP = callConfig?.topP ?? modelDefaults?.topP;
            if (topP !== undefined) params.top_p = topP;
          }

          if (reasoningEffort !== undefined) {
            params.reasoning_effort = reasoningEffort;
          }

          const stopSequences = callConfig?.stopSequences ?? modelDefaults?.stopSequences;
          if (stopSequences !== undefined) params.stop = stopSequences;

          if (options.tools !== undefined && options.tools.length > 0) {
            params.tools = convertToolDefs(options.tools);
          }

          if (options.output !== undefined) {
            params.response_format = {
              type: "json_schema",
              json_schema: {
                name: "output",
                schema: ensureStrictObjects(schemaToJsonSchema(options.output)),
                strict: true,
              },
            };
          }

          return streamOpenAI(client, params, options.signal);
        },
      };
    },
  };
}

/**
 * Stream an OpenAI chat completion, converting chunks to core {@link StreamPart} values.
 */
async function* streamOpenAI(
  client: OpenAI,
  params: OpenAI.ChatCompletionCreateParamsStreaming,
  signal?: AbortSignal,
): AsyncGenerator<StreamPart> {
  const state = createStreamState();

  const response = await client.chat.completions.create(params, {
    signal,
  });

  for await (const chunk of response) {
    const parts = mapChunk(chunk, state);
    for (const part of parts) {
      yield part;
    }
  }
}

/**
 * Recursively add `additionalProperties: false` to all object schemas.
 * OpenAI's structured output requires this when `strict: true`.
 */
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
