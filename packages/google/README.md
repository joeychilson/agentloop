# @agentloop/google

Google Gemini provider for [`@agentloop/core`](../core).

## Install

```bash
npm install @agentloop/core @agentloop/google @google/genai
```

## Usage

```ts
import { defineAgent } from "@agentloop/core";
import { createGoogle } from "@agentloop/google";

const provider = createGoogle();
const model = provider.model("gemini-2.5-flash", { maxTokens: 4096 });

const agent = defineAgent({ model });
const result = await agent.run("Hello!");
```

### Provider configuration

```ts
const provider = createGoogle({
  apiKey: process.env.GEMINI_API_KEY, // defaults to GEMINI_API_KEY env var
  timeout: 30_000,
  maxRetries: 3,
  headers: { "X-Custom": "value" },
});
```

### Thinking configuration

Enable thinking for reasoning-heavy tasks:

```ts
import type { GoogleModelConfig } from "@agentloop/google";

const model = provider.model("gemini-2.5-flash", {
  maxTokens: 16_000,
  thinkingConfig: { thinkingBudget: 10_000 },
} satisfies GoogleModelConfig);
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

- Full streaming with normalized event mapping
- Thinking / reasoning configuration
- Tool calling with schema conversion
- Structured output support
- System instruction handling
- Token usage tracking
- Cooperative cancellation via AbortSignal

## Exports

- `createGoogle(config?: ProviderConfig): Provider` — create a Google Gemini provider
- `GoogleModelConfig` — model config type with `thinkingConfig` option

## Peer dependencies

- `@google/genai` ^1.45.0

## License

MIT
