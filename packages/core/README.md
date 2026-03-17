# @agentloop/core

Core library for agentloop — the minimal, composable agent loop for TypeScript.

This package provides the agent loop, tools, policies, observers, messages, content types, and all foundational interfaces. It has zero production dependencies.

## Install

```bash
npm install @agentloop/core
```

## Usage

```ts
import { defineAgent, defineTool, definePolicy, defineObserver } from "@agentloop/core";
```

You'll also need a provider package (e.g. `@agentloop/anthropic`) to create a model instance.

## Agent

Create an agent with `defineAgent` and run it with `.run()` or `.stream()`:

```ts
import { defineAgent } from "@agentloop/core";
import { createAnthropic } from "@agentloop/anthropic";

const provider = createAnthropic();
const model = provider.model("claude-sonnet-4-6", { maxTokens: 4096 });

const agent = defineAgent({
  name: "assistant",
  model,
  instructions: "You are a helpful assistant.",
  tools: [myTool],
  policies: [myPolicy],
  observers: [myObserver],
});

// Run to completion
const result = await agent.run("What is 2 + 2?");
console.log(result.text);
console.log(result.usage); // { inputTokens, outputTokens, totalTokens }
console.log(result.steps); // number of model calls
console.log(result.duration); // wall-clock ms
```

### Streaming

Stream observer events as they happen:

```ts
const stream = agent.stream("Write a poem.");
for await (const event of stream) {
  if (event.type === "textDelta") {
    process.stdout.write(event.text);
  }
}
const result = await stream.result;
```

### Structured output

Pass an `output` schema to get typed, validated results:

```ts
import { z } from "zod";

const schema = z.object({
  answer: z.string(),
  confidence: z.number(),
});

const result = await agent.run("What year was TypeScript released?", {
  output: schema,
});
console.log(result.object); // { answer: "2012", confidence: 0.95 }
```

### Run options

Override agent defaults per-run:

```ts
const result = await agent.run("Hello", {
  transcript: existingMessages, // continue a conversation
  observers: [extraObserver], // additional observers
  policies: [extraPolicy], // additional policies
  output: schema, // structured output schema
  state: { userId: "123" }, // run-scoped state
  signal: abortController.signal, // cooperative cancellation
  maxTokens: 2048, // model config overrides
  temperature: 0.5,
});
```

### Agent nesting

Convert an agent into a tool for use by another agent:

```ts
const researchTool = researchAgent.asTool({
  name: "research",
  description: "Research a topic.",
  schema: z.object({ topic: z.string() }),
  prompt: (args) => `Research: ${args.topic}`,
});
```

## Tools

Tools let the model call your functions. Define them with a schema and an execute function:

```ts
import { defineTool } from "@agentloop/core";
import { z } from "zod";

const getWeather = defineTool({
  name: "get_weather",
  description: "Get weather for a city.",
  schema: z.object({
    city: z.string().describe("The city name"),
  }),
  async execute(args, ctx) {
    ctx.update({ status: "fetching" }); // progress update
    return { city: args.city, temp: 22 };
  },
});
```

The schema can be from Zod, Valibot, ArkType, or any library implementing [Standard Schema v1](https://github.com/standard-schema/standard-schema).

### Return types

Tools can return a `string`, a `Record<string, unknown>` (auto-wrapped as JSON), or a `Content[]` array.

### Lifecycle hooks

```ts
const guarded = defineTool({
  name: "delete_file",
  description: "Delete a file.",
  schema: z.object({ path: z.string() }),
  before(args, ctx) {
    if (args.path.startsWith("/etc")) {
      return { action: "skip", reason: "Protected path" };
    }
  },
  async execute(args) {
    // ...
    return `Deleted ${args.path}`;
  },
  after(args, output, ctx) {
    // inspect or rewrite output
  },
});
```

## Policies

Policies control the agent loop at five decision points:

| Hook            | When                               | Available actions          |
| --------------- | ---------------------------------- | -------------------------- |
| `beforeStep`    | Before each model call             | `stop`                     |
| `afterResponse` | After model responds, before tools | `stop`, `replace`, `retry` |
| `beforeToolRun` | Before each tool execution         | `skip`, `stop`             |
| `afterToolRun`  | After each tool execution          | `rewrite`, `retry`, `stop` |
| `afterStep`     | After complete step                | `stop`, `retry`, `inject`  |

```ts
import { definePolicy } from "@agentloop/core";

const tokenBudget = definePolicy({
  name: "token-budget",
  afterResponse(ctx, info) {
    if (info.totalUsage.totalTokens > 100_000) {
      return { action: "stop", reason: "Token budget exceeded" };
    }
  },
});
```

Policies are evaluated in order. The first policy to return an action short-circuits — later policies are skipped.

## Observers

Observers watch the loop and react to events. They don't affect control flow.

```ts
import { defineObserver } from "@agentloop/core";

const logger = defineObserver({
  name: "logger",
  onRunStart(event) {
    console.log(`Run started: model=${event.model}`);
  },
  onTextDelta(event) {
    process.stdout.write(event.text);
  },
  onToolRunEnd(event) {
    console.log(`${event.name}: ${event.duration}ms`);
  },
  onRunFinish(event) {
    console.log(`${event.steps} steps, ${event.usage.totalTokens} tokens`);
  },
});
```

### Event types

Text: `textStart`, `textDelta`, `textStop`
Thinking: `thinkingStart`, `thinkingDelta`, `thinkingStop`
Tool calls: `toolCallStart`, `toolCallDelta`, `toolCallStop`
Tool execution: `toolRunStart`, `toolRunUpdate`, `toolRunEnd`, `toolSkip`
Steps: `stepStart`, `stepRetry`, `stepFinish`
Response: `responseFinish`
Run: `runStart`, `runFinish`
Errors: `abort`, `error`

Use typed `on*` handlers for specific events or a catch-all `handler(event)` for everything.

## Messages and content

### Messages

Four message types: `SystemMessage`, `UserMessage`, `AssistantMessage`, `ToolMessage`.

Helper constructors:

```ts
import { system, user, assistant } from "@agentloop/core";

const messages = [system("You are helpful."), user("Hello!")];
```

### Content parts

Messages contain typed content parts:

```ts
import { text, json, blob, url } from "@agentloop/core";

// Text content
text("Hello world");

// Structured JSON
json({ key: "value" });

// Binary data (images, audio, etc.)
blob(uint8Array, "image/png");

// External URL
url("https://example.com/image.png", "image/png");
```

### Prompt type

`Prompt` is a flexible input type — it accepts a `string`, a single `Message`, or a `Message[]` array. Use `normalizePrompt()` to convert any prompt to a `Message[]`.

## Model and Provider

The `Provider` interface creates `Model` instances. The `Model` interface streams responses:

```ts
interface Provider {
  model(name: string, config?: ModelConfig): Model;
}

interface Model {
  name: string;
  stream(options: {
    messages: Message[];
    tools?: ToolDefinition[];
    config?: ModelConfig;
    output?: Schema;
    signal?: AbortSignal;
  }): AsyncIterable<StreamPart>;
}
```

Implement these interfaces to add support for any LLM provider.

## License

MIT
