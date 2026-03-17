# @agentloop/openrouter

OpenRouter provider for [`@agentloop/core`](../core). Access 100+ models from multiple providers through a unified API.

## Install

```bash
npm install @agentloop/core @agentloop/openrouter @openrouter/sdk
```

## Usage

```ts
import { defineAgent } from "@agentloop/core";
import { createOpenRouter } from "@agentloop/openrouter";

const provider = createOpenRouter();
const model = provider.model("anthropic/claude-sonnet-4", { maxTokens: 4096 });

const agent = defineAgent({ model });
const result = await agent.run("Hello!");
```

### Provider configuration

```ts
import type { OpenRouterProviderConfig } from "@agentloop/openrouter";

const provider = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  httpReferer: "https://myapp.example.com",
  appName: "My App",
  timeout: 30_000,
} satisfies OpenRouterProviderConfig);
```

### Reasoning effort

For models that support extended thinking:

```ts
import type { OpenRouterModelConfig } from "@agentloop/openrouter";

const model = provider.model("anthropic/claude-sonnet-4", {
  maxTokens: 16_000,
  reasoningEffort: "high",
} satisfies OpenRouterModelConfig);
```

### Structured output

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

- Access to 100+ models from various providers
- Full streaming with usage tracking
- Reasoning effort configuration
- Tool calling with schema validation
- Structured output support
- App identification via `httpReferer` and `appName`
- Cooperative cancellation via AbortSignal

## Exports

- `createOpenRouter(config?: OpenRouterProviderConfig): Provider` — create an OpenRouter provider
- `OpenRouterModelConfig` — model config type with `reasoningEffort` option
- `OpenRouterProviderConfig` — provider config type with `httpReferer` and `appName`

## Peer dependencies

- `@openrouter/sdk` ^0.9.11

## License

MIT
