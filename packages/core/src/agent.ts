import type { AssistantMessage, Message, Prompt } from "./message.ts";
import type { FinishReason, Model, ModelConfig, Usage } from "./model.ts";
import type { Observer, ObserverEvent } from "./observer.ts";
import type { Policy } from "./policy.ts";
import type { Schema } from "./schema.ts";
import type { Tool, ToolReturn } from "./tool.ts";
import { createEventChannel } from "./channel.ts";
import { createEmitFn } from "./emit.ts";
import { executeRun } from "./loop.ts";

/** Configuration for creating an agent. */
export interface AgentConfig {
  /** Human-readable name for this agent, used in events and error attribution. */
  name?: string;
  /** The model instance to use. */
  model: Model;
  /** System instructions that guide model behavior. */
  instructions?: string;
  /** Tools available to the agent. */
  tools?: Tool[];
  /** Observers that watch the agent loop. */
  observers?: Observer[];
  /** Policies that govern the agent loop. */
  policies?: Policy[];
}

/** Per-run overrides passed to {@link Agent.run} or {@link Agent.stream}. */
export interface RunOptions extends Partial<ModelConfig> {
  /** Existing transcript to continue from. */
  transcript?: Message[];
  /** Additional observers merged with the agent's observers. */
  observers?: Observer[];
  /** Additional policies merged with the agent's policies. */
  policies?: Policy[];
  /** Schema for structured output. */
  output?: Schema;
  /** Initial state for the run context. */
  state?: Record<string, unknown>;
  /** Signal for cooperative cancellation. */
  signal?: AbortSignal;
}

/** The result of an agent run. */
export interface AgentResult<TOutput = unknown> {
  /** Convenience extraction of the final text output. */
  readonly text: string;
  /** The final assistant message. */
  readonly response: AssistantMessage;
  /** The full conversation transcript. */
  readonly transcript: readonly Message[];
  /** Total number of steps executed. */
  readonly steps: number;
  /** Aggregated token usage for the entire run. */
  readonly usage: Usage;
  /** Why the run ended. */
  readonly finishReason: FinishReason;
  /** The name of the policy that stopped the run, if applicable. */
  readonly stoppedBy?: string;
  /** The error, if the run ended due to a failure. */
  readonly error?: Error;
  /** Wall-clock duration of the run in milliseconds. */
  readonly duration: number;
  /** Parsed structured output, if an output schema was provided. */
  readonly object?: TOutput | null;
}

/** An async iterable of observer events with access to the final result. */
export interface AgentStream<TOutput = unknown> extends AsyncIterable<ObserverEvent> {
  /** Resolves to the final result when the run completes. */
  readonly result: Promise<AgentResult<TOutput>>;
}

/** Configuration for converting an agent into a {@link Tool} via {@link Agent.asTool}. */
export interface AsToolConfig<TArgs> {
  /** The tool name exposed to the parent agent. */
  name: string;
  /** Description of what this sub-agent does. */
  description: string;
  /** Schema for the tool's arguments. */
  schema: Schema<TArgs>;
  /** Build the prompt from the parsed arguments. */
  prompt(args: TArgs): Prompt;
  /** Transform the agent result into tool output. Defaults to returning the text. */
  output?(result: AgentResult): ToolReturn;
}

/** An agent that runs a model loop with tools, policies, and observers. */
export interface Agent {
  /** Run the agent to completion and return the result. */
  run<T>(
    prompt: Prompt | undefined,
    options: RunOptions & { output: Schema<T> },
  ): Promise<AgentResult<T>>;
  run(prompt?: Prompt, options?: RunOptions): Promise<AgentResult>;

  /** Run the agent and stream observer events as they occur. */
  stream<T>(
    prompt: Prompt | undefined,
    options: RunOptions & { output: Schema<T> },
  ): AgentStream<T>;
  stream(prompt?: Prompt, options?: RunOptions): AgentStream;

  /** Convert this agent into a tool for use by another agent. */
  asTool<TArgs>(config: AsToolConfig<TArgs>): Tool;
}

/** Create an {@link Agent} from the given configuration. */
export function defineAgent(config: AgentConfig): Agent {
  const agent: Agent = {
    run(prompt?: Prompt, options?: RunOptions): Promise<AgentResult> {
      const opts = options ?? {};
      const observers = [...(config.observers ?? []), ...(opts.observers ?? [])];
      const emit = createEmitFn(observers);
      return executeRun(config, prompt, opts, emit);
    },

    stream(prompt?: Prompt, options?: RunOptions): AgentStream {
      const opts = options ?? {};
      const observers = [...(config.observers ?? []), ...(opts.observers ?? [])];
      const channel = createEventChannel<ObserverEvent, AgentResult>();
      const emit = createEmitFn(observers, channel.push);

      executeRun(config, prompt, opts, emit).then(
        (result) => channel.close(result),
        (err) => channel.fail(err instanceof Error ? err : new Error(String(err))),
      );

      return {
        result: channel.result,
        [Symbol.asyncIterator]() {
          return channel.stream[Symbol.asyncIterator]();
        },
      };
    },

    asTool<TArgs>(toolConfig: AsToolConfig<TArgs>): Tool {
      return {
        name: toolConfig.name,
        description: toolConfig.description,
        schema: toolConfig.schema,
        async execute(args: TArgs, ctx) {
          const result = await agent.run(toolConfig.prompt(args), { signal: ctx.signal });
          if (toolConfig.output) return toolConfig.output(result);
          return result.text;
        },
      };
    },
  };

  return agent;
}
