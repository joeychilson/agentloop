import { z } from "zod";
import {
  defineAgent,
  defineTool,
  definePolicy,
  defineObserver,
  text,
  url,
  user,
} from "@agentloop/core";
import { createOpenAI } from "@agentloop/openai";

const provider = createOpenAI();
const model = provider.model("gpt-4o", {
  maxTokens: 4096,
});

const getWeather = defineTool({
  name: "get_weather",
  description: "Get the current weather for a city.",
  schema: z.object({
    city: z.string().describe("The city name"),
    units: z.enum(["celsius", "fahrenheit"]).optional().describe("Temperature units"),
  }),
  async execute(args, ctx) {
    ctx.update({ status: "fetching weather" });

    const weather = {
      city: args.city,
      temperature: args.units === "fahrenheit" ? 72 : 22,
      units: args.units ?? "celsius",
      condition: "Sunny",
      humidity: 45,
      wind: "12 km/h NW",
    };

    return weather;
  },
});

const calculate = defineTool({
  name: "calculate",
  description: "Evaluate a math expression and return the result.",
  schema: z.object({
    expression: z.string().describe("A math expression to evaluate, e.g. '2 + 2'"),
  }),
  execute(args) {
    if (!/^[\d\s+\-*/().]+$/.test(args.expression)) {
      return `Invalid expression: "${args.expression}". Only numbers and +, -, *, / are allowed.`;
    }
    try {
      const result = new Function(`return (${args.expression})`)() as number;
      return { expression: args.expression, result };
    } catch {
      return `Failed to evaluate: "${args.expression}"`;
    }
  },
});

const maxSteps = definePolicy({
  name: "max-steps",
  beforeStep(ctx) {
    if (ctx.step >= 10) {
      return { action: "stop", reason: "Maximum steps (10) reached" };
    }
  },
});

const maxRetries = definePolicy({
  name: "max-retries",
  afterResponse(ctx) {
    if (ctx.retries >= 3) {
      return { action: "stop", reason: "Maximum retries (3) reached" };
    }
  },
});

const logger = defineObserver({
  name: "logger",
  onRunStart(event) {
    console.log(`\n[run] Started — model: ${event.model}, tools: [${event.tools.join(", ")}]`);
  },
  onStepStart(event) {
    console.log(`\n[step ${event.step}] Started — model: ${event.model}`);
  },
  onTextDelta(event) {
    process.stdout.write(event.text);
  },
  onToolCallStart(event) {
    console.log(`\n[tool] Calling ${event.name}...`);
  },
  onToolRunEnd(event) {
    const output = event.output.map((p) => (p.type === "text" ? p.text : p.type)).join(", ");
    console.log(
      `[tool] ${event.name} → ${output.slice(0, 100)}${output.length > 100 ? "..." : ""} (${event.duration}ms)`,
    );
  },
  onStepFinish(event) {
    console.log(`\n[step ${event.step}] Finished — ${event.finishReason} (${event.duration}ms)`);
  },
  onError(event) {
    console.error(`\n[error] ${event.source}: ${event.error.message}`);
  },
  onRunFinish(event) {
    console.log(
      `\n[run] Finished — ${event.finishReason}, ${event.steps} step(s), ${event.duration}ms`,
    );
    console.log(`[run] Tokens: ${event.usage.inputTokens} in / ${event.usage.outputTokens} out`);
    if (event.usage.cacheReadTokens)
      console.log(`[run] Cache: ${event.usage.cacheReadTokens} read`);
    if (event.stoppedBy) console.log(`[run] Stopped by: ${event.stoppedBy}`);
    if (event.error) console.error(`[run] Error: ${event.error.message}`);
  },
});

const agent = defineAgent({
  name: "assistant",
  model,
  instructions:
    "You are a helpful assistant. Use the tools available to answer questions accurately. Be concise.",
  tools: [getWeather, calculate],
  policies: [maxSteps, maxRetries],
  observers: [logger],
});

async function runExample(label: string, prompt: Parameters<typeof agent.run>[0]) {
  console.log("\n" + "=".repeat(60));
  console.log(`EXAMPLE: ${label}`);
  console.log("=".repeat(60));

  const result = await agent.run(prompt);

  console.log("\n--- Result ---");
  console.log("Text:", result.text);
  if (result.error) console.error("Error:", result.error.message);
  console.log("");
}

async function main() {
  await runExample("Simple question", "What is the capital of France?");

  await runExample(
    "Tool use (weather)",
    "What's the weather like in Seattle and Tokyo? Compare them.",
  );

  await runExample(
    "Multi-tool",
    "What is the weather in NYC in fahrenheit, and what is 72 * 1.8 + 32?",
  );

  console.log("\n" + "=".repeat(60));
  console.log("EXAMPLE: Streaming");
  console.log("=".repeat(60));

  const stream = agent.stream("Write a haiku about TypeScript.");
  for await (const event of stream) {
    if (event.type === "textDelta") {
      // Already printed by observer
    }
  }

  const streamResult = await stream.result;
  console.log("\n--- Stream Result ---");
  console.log("Text:", streamResult.text);
  console.log("");

  await runExample(
    "Image URL",
    user([
      text("What do you see in this image?"),
      url(
        "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png",
        "image/png",
      ),
    ]),
  );

  console.log("\n" + "=".repeat(60));
  console.log("EXAMPLE: Structured output");
  console.log("=".repeat(60));

  const outputSchema = z.object({
    answer: z.string(),
    confidence: z.number(),
    reasoning: z.string(),
  });

  const structured = await agent.run("What year was TypeScript first released?", {
    output: outputSchema,
  });

  console.log("\n--- Structured Result ---");
  console.log("Object:", JSON.stringify(structured.object, null, 2));
  console.log("");
}

main().catch(console.error);
