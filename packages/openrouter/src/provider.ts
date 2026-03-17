import { OpenRouter } from "@openrouter/sdk";
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
import {
  buildResponseFormat,
  convertMessages,
  convertToolDefs,
  createStreamState,
  mapChunk,
} from "./convert.ts";

/** OpenRouter-specific model configuration, extending core {@link ModelConfig}. */
export interface OpenRouterModelConfig extends ModelConfig {
  /** Reasoning effort for models that support extended thinking. */
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
}

/** OpenRouter-specific provider configuration, extending core {@link ProviderConfig}. */
export interface OpenRouterProviderConfig extends ProviderConfig {
  /** Application URL for OpenRouter rankings. */
  httpReferer?: string;
  /** Application display name in the OpenRouter dashboard. */
  appName?: string;
}

/** Create an OpenRouter {@link Provider}. */
export function createOpenRouter(config?: OpenRouterProviderConfig): Provider {
  const client = new OpenRouter({
    apiKey: config?.apiKey,
    serverURL: config?.baseUrl,
    httpReferer: config?.httpReferer,
    xTitle: config?.appName,
    timeoutMs: config?.timeout,
  });

  return {
    model(name: string, defaults?: ModelConfig): Model {
      const modelDefaults = defaults as OpenRouterModelConfig | undefined;

      return {
        name,
        stream(options: {
          messages: Message[];
          tools?: ToolDefinition[];
          config?: ModelConfig;
          output?: Schema;
          signal?: AbortSignal;
        }): AsyncIterable<StreamPart> {
          const callConfig = options.config as OpenRouterModelConfig | undefined;
          const messages = convertMessages(options.messages);

          const params: Record<string, unknown> = {
            model: name,
            messages,
            stream: true,
            streamOptions: { includeUsage: true },
          };

          const maxTokens = callConfig?.maxTokens ?? modelDefaults?.maxTokens;
          if (maxTokens !== undefined) params.maxCompletionTokens = maxTokens;

          const reasoningEffort = callConfig?.reasoningEffort ?? modelDefaults?.reasoningEffort;
          if (reasoningEffort !== undefined) {
            params.reasoning = { effort: reasoningEffort };
          }

          if (reasoningEffort === undefined) {
            const temperature = callConfig?.temperature ?? modelDefaults?.temperature;
            if (temperature !== undefined) params.temperature = temperature;

            const topP = callConfig?.topP ?? modelDefaults?.topP;
            if (topP !== undefined) params.topP = topP;
          }

          const stopSequences = callConfig?.stopSequences ?? modelDefaults?.stopSequences;
          if (stopSequences !== undefined) params.stop = stopSequences;

          if (options.tools !== undefined && options.tools.length > 0) {
            params.tools = convertToolDefs(options.tools);
          }

          if (options.output !== undefined) {
            params.responseFormat = buildResponseFormat(schemaToJsonSchema(options.output));
          }

          return streamOpenRouter(client, params, options.signal);
        },
      };
    },
  };
}

/**
 * Stream an OpenRouter chat completion, converting chunks to core {@link StreamPart} values.
 */
async function* streamOpenRouter(
  client: OpenRouter,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): AsyncGenerator<StreamPart> {
  const state = createStreamState();

  const stream = (await client.chat.send(
    { chatGenerationParams: { ...params, stream: true } as never },
    { signal },
  )) as unknown as AsyncIterable<import("@openrouter/sdk/models").ChatStreamingResponseChunk>;

  for await (const chunk of stream) {
    const parts = mapChunk(chunk, state);
    for (const part of parts) {
      yield part;
    }
  }
}
