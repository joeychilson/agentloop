# agentloop

Minimal, composable agent loop for TypeScript.

Build AI agents with tool use, streaming, structured output, policies, and observers. Zero dependencies in the core. Works with any LLM provider.

> **Warning:** This project is under active development. APIs may change without notice.

## Install

```bash
npm install @agentloop/core
```

Then add a provider:

```bash
npm install @agentloop/anthropic @anthropic-ai/sdk
npm install @agentloop/openai openai
npm install @agentloop/google @google/genai
npm install @agentloop/openrouter openai
```

Optionally add common policies:

```bash
npm install @agentloop/policies
```

## Quick start

```ts
import { z } from "zod";
import { defineAgent, defineTool } from "@agentloop/core";
import { createAnthropic } from "@agentloop/anthropic";

const provider = createAnthropic();
const model = provider.model("claude-sonnet-4-6", { maxTokens: 4096 });

const getWeather = defineTool({
  name: "get_weather",
  description: "Get the current weather for a city.",
  schema: z.object({
    city: z.string().describe("The city name"),
  }),
  async execute(args) {
    return { city: args.city, temperature: 22, condition: "Sunny" };
  },
});

const agent = defineAgent({
  name: "assistant",
  model,
  instructions: "You are a helpful assistant.",
  tools: [getWeather],
});

const result = await agent.run("What's the weather in Tokyo?");
console.log(result.text);
```

## Packages

| Package                                        | Description                                                     |
| ---------------------------------------------- | --------------------------------------------------------------- |
| [`@agentloop/core`](packages/core)             | Agent loop, tools, policies, observers, and all core types      |
| [`@agentloop/anthropic`](packages/anthropic)   | Anthropic Claude provider                                       |
| [`@agentloop/openai`](packages/openai)         | OpenAI provider                                                 |
| [`@agentloop/google`](packages/google)         | Google Gemini provider                                          |
| [`@agentloop/openrouter`](packages/openrouter) | OpenRouter provider                                             |
| [`@agentloop/policies`](packages/policies)     | Common reusable policies (max steps, retries, tokens, duration) |

## Key concepts

### Agent

An agent runs a loop: call the model, execute any tool calls, repeat until the model stops or a policy intervenes. Create one with `defineAgent`:

```ts
const agent = defineAgent({
  name: "assistant",
  model,
  instructions: "System prompt here.",
  tools: [myTool],
  policies: [myPolicy],
  observers: [myObserver],
});
```

Run to completion or stream events:

```ts
// Run to completion
const result = await agent.run("Hello!");
console.log(result.text);

// Stream events
const stream = agent.stream("Hello!");
for await (const event of stream) {
  if (event.type === "textDelta") {
    process.stdout.write(event.text);
  }
}
const result = await stream.result;
```

### Tools

Tools let the model call your code. Define them with a schema (Zod, Valibot, ArkType, or any Standard Schema v1 compatible library) and an execute function:

```ts
const calculate = defineTool({
  name: "calculate",
  description: "Evaluate a math expression.",
  schema: z.object({
    expression: z.string().describe("e.g. '2 + 2'"),
  }),
  execute(args) {
    return { result: eval(args.expression) };
  },
});
```

Tools support lifecycle hooks (`before`, `after`) and progress updates via `ctx.update()`.

### Policies

Policies control the agent loop at key decision points. They can stop the run, retry steps, replace responses, skip tools, rewrite output, or inject messages:

```ts
const maxSteps = definePolicy({
  name: "max-steps",
  beforeStep(ctx) {
    if (ctx.step >= 10) {
      return { action: "stop", reason: "Step limit reached" };
    }
  },
});
```

Five hook points: `beforeStep`, `afterResponse`, `beforeToolRun`, `afterToolRun`, `afterStep`.

### Observers

Observers watch the agent loop and react to events. Use them for logging, metrics, UI updates, or debugging:

```ts
const logger = defineObserver({
  name: "logger",
  onTextDelta(event) {
    process.stdout.write(event.text);
  },
  onToolRunEnd(event) {
    console.log(`${event.name} completed in ${event.duration}ms`);
  },
  onRunFinish(event) {
    console.log(`Done: ${event.usage.totalTokens} tokens`);
  },
});
```

### Structured output

Pass an `output` schema to get typed, validated responses:

```ts
const schema = z.object({
  answer: z.string(),
  confidence: z.number(),
});

const result = await agent.run("What year was TypeScript released?", {
  output: schema,
});
console.log(result.object); // { answer: "2012", confidence: 0.95 }
```

### Agent nesting

Convert any agent into a tool for use by another agent:

```ts
const researchTool = researchAgent.asTool({
  name: "research",
  description: "Research a topic in depth.",
  schema: z.object({ topic: z.string() }),
  prompt: (args) => `Research: ${args.topic}`,
});

const orchestrator = defineAgent({
  model,
  tools: [researchTool],
});
```

### Providers

Providers create model instances. Each provider package wraps a vendor SDK:

```ts
import { createAnthropic } from "@agentloop/anthropic";
import { createOpenAI } from "@agentloop/openai";
import { createGoogle } from "@agentloop/google";
import { createOpenRouter } from "@agentloop/openrouter";

const anthropic = createAnthropic();
const claude = anthropic.model("claude-sonnet-4-6");

const openai = createOpenAI();
const gpt = openai.model("gpt-4o");

const google = createGoogle();
const gemini = google.model("gemini-2.5-flash");

const openrouter = createOpenRouter();
const any = openrouter.model("anthropic/claude-sonnet-4");
```

All providers accept an optional config for API key, base URL, timeout, retries, and custom headers.

## Examples

Working examples for each provider are in the [`examples/`](examples/) directory:

```bash
cd examples/anthropic && bun run src/main.ts
cd examples/openai && bun run src/main.ts
cd examples/google && bun run src/main.ts
cd examples/openrouter && bun run src/main.ts
```

## Development

```bash
bun install
bun run build       # Build all packages
bun run test        # Run tests
bun run check       # Format, lint, typecheck, and test
```

## License

MIT
