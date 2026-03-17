import { GoogleGenAI } from "@google/genai";
import type { ThinkingConfig } from "@google/genai";
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

/** Google-specific model configuration, extending core {@link ModelConfig}. */
export interface GoogleModelConfig extends ModelConfig {
  /** Thinking/reasoning configuration for Gemini models. */
  thinkingConfig?: ThinkingConfig;
}

/** Create a Google Gemini {@link Provider}. */
export function createGoogle(config?: ProviderConfig): Provider {
  const ai = new GoogleGenAI({ apiKey: config?.apiKey });

  return {
    model(name: string, defaults?: ModelConfig): Model {
      const modelDefaults = defaults as GoogleModelConfig | undefined;

      return {
        name,
        stream(options: {
          messages: Message[];
          tools?: ToolDefinition[];
          config?: ModelConfig;
          output?: Schema;
          signal?: AbortSignal;
        }): AsyncIterable<StreamPart> {
          const callConfig = options.config as GoogleModelConfig | undefined;
          const { systemInstruction, contents } = convertMessages(options.messages);

          const generateConfig: Record<string, unknown> = {};

          const maxTokens = callConfig?.maxTokens ?? modelDefaults?.maxTokens;
          if (maxTokens !== undefined) generateConfig.maxOutputTokens = maxTokens;

          const temperature = callConfig?.temperature ?? modelDefaults?.temperature;
          if (temperature !== undefined) generateConfig.temperature = temperature;

          const topP = callConfig?.topP ?? modelDefaults?.topP;
          if (topP !== undefined) generateConfig.topP = topP;

          const topK = callConfig?.topK ?? modelDefaults?.topK;
          if (topK !== undefined) generateConfig.topK = topK;

          const stopSequences = callConfig?.stopSequences ?? modelDefaults?.stopSequences;
          if (stopSequences !== undefined) generateConfig.stopSequences = stopSequences;

          if (systemInstruction !== undefined) {
            generateConfig.systemInstruction = systemInstruction;
          }

          const thinkingConfig = callConfig?.thinkingConfig ?? modelDefaults?.thinkingConfig;
          if (thinkingConfig !== undefined) {
            generateConfig.thinkingConfig = thinkingConfig;
          }

          if (options.tools !== undefined && options.tools.length > 0) {
            generateConfig.tools = [{ functionDeclarations: convertToolDefs(options.tools) }];
          }

          if (options.output !== undefined) {
            generateConfig.responseMimeType = "application/json";
            generateConfig.responseJsonSchema = schemaToJsonSchema(options.output);
          }

          if (options.signal !== undefined) {
            generateConfig.abortSignal = options.signal;
          }

          return streamGoogle(ai, name, contents, generateConfig);
        },
      };
    },
  };
}

/**
 * Stream a Gemini generation, converting chunks to core {@link StreamPart} values.
 */
async function* streamGoogle(
  ai: GoogleGenAI,
  model: string,
  contents: unknown[],
  config: Record<string, unknown>,
): AsyncGenerator<StreamPart> {
  const state = createStreamState();

  const stream = await ai.models.generateContentStream({
    model,
    contents: contents as import("@google/genai").Content[],
    config,
  });

  for await (const chunk of stream) {
    const parts = mapChunk(chunk, state);
    for (const part of parts) {
      yield part;
    }
  }
}
