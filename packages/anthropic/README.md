# @agentloop/anthropic

Anthropic Claude provider for [`@agentloop/core`](../core).

## Install

```bash
npm install @agentloop/core @agentloop/anthropic @anthropic-ai/sdk
```

## Usage

```ts
import { defineAgent } from "@agentloop/core";
import { createAnthropic } from "@agentloop/anthropic";

const provider = createAnthropic();
const model = provider.model("claude-sonnet-4-6", { maxTokens: 4096 });

const agent = defineAgent({ model });
const result = await agent.run("Hello!");
```

### Provider configuration

```ts
const provider = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY, // defaults to ANTHROPIC_API_KEY env var
  baseUrl: "https://custom-endpoint.example.com",
  timeout: 30_000,
  maxRetries: 3,
  headers: { "X-Custom": "value" },
});
```

### Extended thinking

Enable extended thinking for reasoning-heavy tasks:

```ts
import type { AnthropicModelConfig } from "@agentloop/anthropic";

const model = provider.model("claude-sonnet-4-6", {
  maxTokens: 16_000,
  thinking: { type: "enabled", budget_tokens: 10_000 },
} satisfies AnthropicModelConfig);
```

### Structured output

Structured output works via Anthropic's JSON Schema output config:

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

- Full streaming with normalized event mapping
- Extended thinking / reasoning traces
- Tool calling with schema validation
- Structured output via JSON Schema
- Token usage tracking including prompt caching metrics
- Cooperative cancellation via AbortSignal

## Exports

- `createAnthropic(config?: ProviderConfig): Provider` — create an Anthropic provider
- `AnthropicModelConfig` — model config type with `thinking` option

## Peer dependencies

- `@anthropic-ai/sdk` ^0.79.0

## License

MIT
