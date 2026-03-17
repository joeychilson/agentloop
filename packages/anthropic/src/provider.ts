import Anthropic from "@anthropic-ai/sdk";
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
import { convertMessages, convertToolDefs, createStreamState, mapStreamEvent } from "./convert.ts";

/** Anthropic-specific model configuration, extending core {@link ModelConfig}. */
export interface AnthropicModelConfig extends ModelConfig {
  /** Extended thinking configuration. */
  thinking?: Anthropic.Messages.ThinkingConfigParam;
}

/** Create an Anthropic {@link Provider}. */
export function createAnthropic(config?: ProviderConfig): Provider {
  const client = new Anthropic({
    apiKey: config?.apiKey,
    baseURL: config?.baseUrl,
    timeout: config?.timeout,
    maxRetries: config?.maxRetries,
    defaultHeaders: config?.headers,
  });

  return {
    model(name: string, defaults?: ModelConfig): Model {
      const modelDefaults = defaults as AnthropicModelConfig | undefined;

      return {
        name,
        stream(options: {
          messages: Message[];
          tools?: ToolDefinition[];
          config?: ModelConfig;
          output?: Schema;
          signal?: AbortSignal;
        }): AsyncIterable<StreamPart> {
          const callConfig = options.config as AnthropicModelConfig | undefined;
          const thinking = callConfig?.thinking ?? modelDefaults?.thinking;

          const { system, messages } = convertMessages(options.messages);

          const params: Anthropic.Messages.MessageCreateParamsStreaming = {
            model: name,
            max_tokens: callConfig?.maxTokens ?? modelDefaults?.maxTokens ?? 4096,
            messages,
            stream: true,
          };

          if (system !== undefined) params.system = system;
          if (thinking !== undefined) params.thinking = thinking;

          if (thinking === undefined || thinking.type === "disabled") {
            if (callConfig?.temperature ?? modelDefaults?.temperature) {
              params.temperature = callConfig?.temperature ?? modelDefaults?.temperature;
            }
            if (callConfig?.topP ?? modelDefaults?.topP) {
              params.top_p = callConfig?.topP ?? modelDefaults?.topP;
            }
            if (callConfig?.topK ?? modelDefaults?.topK) {
              params.top_k = callConfig?.topK ?? modelDefaults?.topK;
            }
          }

          if (callConfig?.stopSequences ?? modelDefaults?.stopSequences) {
            params.stop_sequences = callConfig?.stopSequences ?? modelDefaults?.stopSequences;
          }

          if (options.tools !== undefined && options.tools.length > 0) {
            params.tools = convertToolDefs(options.tools);
          }

          if (options.output !== undefined) {
            params.output_config = {
              format: {
                type: "json_schema",
                schema: ensureStrictObjects(schemaToJsonSchema(options.output)),
              },
            };
          }

          return streamAnthropic(client, params, options.signal);
        },
      };
    },
  };
}

/**
 * Stream an Anthropic API call, converting raw events to core {@link StreamPart} values.
 *
 * Uses `client.messages.create({ stream: true })` for direct access to raw
 * streaming events, which gives us full control over the event mapping.
 */
async function* streamAnthropic(
  client: Anthropic,
  params: Anthropic.Messages.MessageCreateParamsStreaming,
  signal?: AbortSignal,
): AsyncGenerator<StreamPart> {
  const state = createStreamState();

  const response = await client.messages.create(params, {
    signal,
  });

  for await (const event of response) {
    const parts = mapStreamEvent(event, state);
    for (const part of parts) {
      yield part;
    }
  }
}

/**
 * Recursively add `additionalProperties: false` to all object schemas.
 * Anthropic's structured output API requires this on every object type.
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
