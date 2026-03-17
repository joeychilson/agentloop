# @agentloop/openai

OpenAI provider for [`@agentloop/core`](../core).

## Install

```bash
npm install @agentloop/core @agentloop/openai openai
```

## Usage

```ts
import { defineAgent } from "@agentloop/core";
import { createOpenAI } from "@agentloop/openai";

const provider = createOpenAI();
const model = provider.model("gpt-4o", { maxTokens: 4096 });

const agent = defineAgent({ model });
const result = await agent.run("Hello!");
```

### Provider configuration

```ts
const provider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY, // defaults to OPENAI_API_KEY env var
  baseUrl: "https://custom-endpoint.example.com",
  timeout: 30_000,
  maxRetries: 3,
  headers: { "X-Custom": "value" },
});
```

### Reasoning models

Configure reasoning effort for o1/o3/gpt-5 models:

```ts
import type { OpenAIModelConfig } from "@agentloop/openai";

const model = provider.model("o3", {
  maxTokens: 16_000,
  reasoningEffort: "high",
} satisfies OpenAIModelConfig);
```

### Structured output

Structured output works via OpenAI's strict JSON Schema mode:

```ts
import { z } from "zod";

const result = await agent.run("Summarize this text.", {
  output: z.object({
    summary: z.string(),
    topics: z.array(z.string()),
  }),
});
console.log(result.object);
```

## Features

- Full streaming with usage tracking
- Reasoning model support with configurable effort
- Tool calling with schema validation
- Structured output via strict JSON Schema
- Token usage aggregation
- Cooperative cancellation via AbortSignal

## Exports

- `createOpenAI(config?: ProviderConfig): Provider` — create an OpenAI provider
- `OpenAIModelConfig` — model config type with `reasoningEffort` option

## Peer dependencies

- `openai` ^6.32.0

## License

MIT
