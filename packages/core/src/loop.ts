/* eslint-disable no-await-in-loop */
import type { AssistantContent, ToolCallPart } from "./content.ts";
import type { RunContext } from "./context.ts";
import type { EmitFn } from "./emit.ts";
import type { AssistantMessage, Message, Prompt } from "./message.ts";
import { normalizePrompt, system } from "./message.ts";
import type { FinishReason, ModelConfig, StreamPart, Usage } from "./model.ts";
import { addUsage, emptyUsage } from "./model.ts";
import type {
  AbortEvent,
  ErrorEvent,
  ResponseFinishEvent,
  RunFinishEvent,
  RunStartEvent,
  StepFinishEvent,
  StepRetryEvent,
  StepStartEvent,
  TextDeltaEvent,
  TextStartEvent,
  TextStopEvent,
  ThinkingDeltaEvent,
  ThinkingStartEvent,
  ThinkingStopEvent,
  ToolCallDeltaEvent,
  ToolCallStartEvent,
  ToolCallStopEvent,
} from "./observer.ts";
import type {
  AfterResponseAction,
  AfterStepAction,
  BeforeStepAction,
  Policy,
  ResponseInfo,
  StepInfo,
  StepPlan,
} from "./policy.ts";
import type { Schema } from "./schema.ts";
import type { Tool, ToolDefinition } from "./tool.ts";
import type { AgentConfig, AgentResult, RunOptions } from "./agent.ts";
import { executeToolCalls } from "./execute.ts";
import { runPolicies } from "./pipeline.ts";

/** Base fields for every observer event, derived from run state. */
interface BaseFields {
  readonly runId: string;
  readonly step: number;
  readonly agent: string | undefined;
  readonly timestamp: number;
}

/** Create base observer event fields from current run state. */
function baseFields(runId: string, step: number, agent: string | undefined): BaseFields {
  return { runId, step, agent, timestamp: Date.now() };
}

/** Ensure system instructions appear as the first message in a plan's message list. */
function prepareMessages(plan: StepPlan): Message[] {
  const messages = plan.messages;
  if (plan.instructions !== undefined) {
    if (messages.length > 0 && messages[0]!.role === "system") {
      messages[0] = system(plan.instructions);
    } else {
      messages.unshift(system(plan.instructions));
    }
  }
  return messages;
}

/** Extract {@link ToolDefinition} metadata from tools (strips execute/hooks). */
function deriveToolDefs(tools: Tool[]): ToolDefinition[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    schema: t.schema,
    ...(t.timeout !== undefined && { timeout: t.timeout }),
  }));
}

/** Extract the {@link ModelConfig} subset from a {@link StepPlan}. */
function extractModelConfig(plan: StepPlan): ModelConfig {
  const config: ModelConfig = {};
  if (plan.maxTokens !== undefined) config.maxTokens = plan.maxTokens;
  if (plan.temperature !== undefined) config.temperature = plan.temperature;
  if (plan.topP !== undefined) config.topP = plan.topP;
  if (plan.topK !== undefined) config.topK = plan.topK;
  if (plan.stopSequences !== undefined) config.stopSequences = plan.stopSequences;
  return config;
}

/** Extract all {@link ToolCallPart} entries from an assistant message. */
function extractToolCalls(message: AssistantMessage): ToolCallPart[] {
  const calls: ToolCallPart[] = [];
  for (const part of message.content) {
    if (part.type === "tool_call") calls.push(part);
  }
  return calls;
}

/** Join all text content parts from an assistant message. */
function extractText(message: AssistantMessage): string {
  let result = "";
  for (const part of message.content) {
    if (part.type === "text") {
      if (result) result += "\n";
      result += part.text;
    }
  }
  return result;
}

/**
 * Parse structured output from the last text part of a response.
 *
 * Returns the validated object on success, `null` on failure. Emits an
 * {@link ErrorEvent} with `source: "validation"` on parse or validation failure.
 */
function parseStructuredOutput(
  message: AssistantMessage,
  schema: Schema,
  emit: EmitFn,
  base: BaseFields,
): unknown | null {
  let lastText: string | undefined;
  for (const part of message.content) {
    if (part.type === "text") lastText = part.text;
  }
  if (lastText === undefined) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(lastText);
  } catch {
    emit({
      type: "error",
      ...base,
      error: new Error("Structured output is not valid JSON"),
      source: "validation",
    } satisfies ErrorEvent);
    return null;
  }

  const result = schema.safeParse(parsed);
  if (result.success) return result.data;

  emit({
    type: "error",
    ...base,
    error: new Error(`Structured output validation failed: ${String(result.error)}`),
    source: "validation",
  } satisfies ErrorEvent);
  return null;
}

/** Result of consuming a model stream. */
interface StreamResult {
  message: AssistantMessage;
  usage: Usage;
  finishReason: FinishReason;
}

/**
 * Consume a model's {@link StreamPart} iterable, assembling the final
 * {@link AssistantMessage} while emitting observer events for each part.
 *
 * Single pass, single piece of state. Throws on stream errors — the caller
 * catches and converts to an error result.
 */
async function consumeStream(
  stream: AsyncIterable<StreamPart>,
  emit: EmitFn,
  base: () => BaseFields,
): Promise<StreamResult> {
  const content: AssistantContent[] = [];
  const toolCalls = new Map<
    string,
    { id: string; name: string; args: string; signature?: string }
  >();

  let textBuffer = "";
  let thinkingBuffer = "";
  let thinkingSignature: string | undefined;
  let thinkingRedacted = false;
  let usage: Usage = emptyUsage();
  let finishReason: FinishReason = "unknown";

  function flushText(): void {
    if (textBuffer) {
      content.push({ type: "text", text: textBuffer });
      textBuffer = "";
    }
  }

  function flushThinking(): void {
    if (thinkingBuffer || thinkingRedacted) {
      content.push({
        type: "thinking",
        thinking: thinkingBuffer,
        signature: thinkingSignature,
        redacted: thinkingRedacted,
      });
      thinkingBuffer = "";
      thinkingSignature = undefined;
      thinkingRedacted = false;
    }
  }

  for await (const part of stream) {
    switch (part.type) {
      case "text_start":
        flushText();
        flushThinking();
        textBuffer = "";
        emit({ type: "textStart", ...base() } satisfies TextStartEvent);
        break;

      case "text_delta":
        textBuffer += part.text;
        emit({ type: "textDelta", ...base(), text: part.text } satisfies TextDeltaEvent);
        break;

      case "text_end":
        flushText();
        emit({ type: "textStop", ...base() } satisfies TextStopEvent);
        break;

      case "thinking_start":
        flushText();
        flushThinking();
        thinkingBuffer = "";
        thinkingSignature = undefined;
        thinkingRedacted = part.redacted ?? false;
        emit({
          type: "thinkingStart",
          ...base(),
          redacted: part.redacted,
        } satisfies ThinkingStartEvent);
        break;

      case "thinking_delta":
        thinkingBuffer += part.thinking;
        emit({
          type: "thinkingDelta",
          ...base(),
          text: part.thinking,
        } satisfies ThinkingDeltaEvent);
        break;

      case "thinking_end":
        thinkingSignature = part.signature;
        flushThinking();
        emit({ type: "thinkingStop", ...base() } satisfies ThinkingStopEvent);
        break;

      case "tool_call_start":
        flushText();
        flushThinking();
        toolCalls.set(part.id, {
          id: part.id,
          name: part.name,
          args: "",
          signature: part.signature,
        });
        emit({
          type: "toolCallStart",
          ...base(),
          id: part.id,
          name: part.name,
        } satisfies ToolCallStartEvent);
        break;

      case "tool_call_delta": {
        const tc = toolCalls.get(part.id);
        if (tc !== undefined) {
          tc.args += part.args;
          emit({
            type: "toolCallDelta",
            ...base(),
            id: part.id,
            name: tc.name,
            partialArguments: tc.args,
          } satisfies ToolCallDeltaEvent);
        }
        break;
      }

      case "tool_call_end": {
        const tc = toolCalls.get(part.id);
        if (tc !== undefined) {
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.args || "{}") as Record<string, unknown>;
          } catch (e) {
            throw new Error(`Invalid JSON in tool call arguments for ${tc.name} (${tc.id})`, {
              cause: e,
            });
          }
          content.push({
            type: "tool_call",
            id: tc.id,
            name: tc.name,
            arguments: args,
            ...(tc.signature !== undefined && { signature: tc.signature }),
          });
          toolCalls.delete(tc.id);
          emit({
            type: "toolCallStop",
            ...base(),
            id: tc.id,
            name: tc.name,
            arguments: args,
          } satisfies ToolCallStopEvent);
        }
        break;
      }

      case "finish":
        usage = part.usage;
        finishReason = part.finishReason;
        break;

      case "error":
        throw part.error;
    }
  }

  flushThinking();
  flushText();

  return { message: { role: "assistant", content }, usage, finishReason };
}

/**
 * Execute an agent run to completion.
 *
 * This function never throws. All errors are caught and reflected in the
 * returned {@link AgentResult}. The caller provides an {@link EmitFn} that
 * receives every observer event as it occurs.
 */
export async function executeRun(
  config: AgentConfig,
  prompt: Prompt | undefined,
  options: RunOptions,
  emit: EmitFn,
): Promise<AgentResult> {
  const runStart = Date.now();
  const runId = crypto.randomUUID();
  const policies: Policy[] = [...(config.policies ?? []), ...(options.policies ?? [])];
  const tools: Tool[] = config.tools ?? [];

  const transcript: Message[] = [
    ...(options.transcript ?? []),
    ...(prompt !== undefined ? normalizePrompt(prompt) : []),
  ];

  const modelConfig: ModelConfig = {};
  if (options.maxTokens !== undefined) modelConfig.maxTokens = options.maxTokens;
  if (options.temperature !== undefined) modelConfig.temperature = options.temperature;
  if (options.topP !== undefined) modelConfig.topP = options.topP;
  if (options.topK !== undefined) modelConfig.topK = options.topK;
  if (options.stopSequences !== undefined) modelConfig.stopSequences = options.stopSequences;

  const signal = options.signal ?? new AbortController().signal;
  const state: Record<string, unknown> = options.state ?? {};
  let totalUsage: Usage = emptyUsage();
  let step = 0;
  let retries = 0;
  let finishReason: FinishReason = "unknown";
  let stoppedBy: string | undefined;
  let runError: Error | undefined;
  let parsedObject: unknown;
  let lastResponse: AssistantMessage = { role: "assistant", content: [] };

  /** Snapshot the current {@link RunContext}. */
  function ctx(): RunContext {
    return { runId, step, agent: config.name, state, retries, signal };
  }

  /** Create {@link BaseFields} from current run state. */
  function base(): BaseFields {
    return baseFields(runId, step, config.name);
  }

  try {
    emit({
      type: "runStart",
      ...base(),
      model: config.model.name,
      instructions: config.instructions,
      prompt: prompt ?? undefined,
      tools: tools.map((t) => t.name),
    } satisfies RunStartEvent);

    for (;;) {
      if (signal.aborted) {
        finishReason = "cancelled";
        emit({
          type: "abort",
          ...base(),
          reason: String(signal.reason ?? "Aborted"),
        } satisfies AbortEvent);
        break;
      }

      const plan: StepPlan = {
        model: config.model,
        instructions: config.instructions,
        messages: [...transcript],
        tools: [...tools],
        ...modelConfig,
      };

      const beforeStep = await runPolicies<BeforeStepAction>(policies, (p) =>
        p.beforeStep?.(ctx(), plan),
      );

      if (beforeStep != null) {
        if (beforeStep.error) {
          emit({
            type: "error",
            ...base(),
            error: beforeStep.error,
            source: "policy",
            policy: beforeStep.policy,
          } satisfies ErrorEvent);
        }
        finishReason = "stop";
        stoppedBy = beforeStep.policy;
        break;
      }

      const toolMap = new Map(plan.tools.map((t) => [t.name, t]));
      const stepStart = Date.now();

      emit({
        type: "stepStart",
        ...base(),
        model: plan.model.name,
      } satisfies StepStartEvent);

      const callMessages = prepareMessages(plan);
      const toolDefs = deriveToolDefs(plan.tools);

      let message: AssistantMessage;
      let stepUsage: Usage;
      let stepFinishReason: FinishReason;

      try {
        const result = await consumeStream(
          plan.model.stream({
            messages: callMessages,
            tools: toolDefs.length > 0 ? toolDefs : undefined,
            config: extractModelConfig(plan),
            output: options.output,
            signal,
          }),
          emit,
          base,
        );
        message = result.message;
        stepUsage = result.usage;
        stepFinishReason = result.finishReason;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        emit({
          type: "error",
          ...base(),
          error,
          source: "provider",
        } satisfies ErrorEvent);
        message = { role: "assistant", content: [] };
        stepUsage = emptyUsage();
        stepFinishReason = "error";
        runError = error;
      }

      const responseEnd = Date.now();
      totalUsage = addUsage(totalUsage, stepUsage);
      finishReason = stepFinishReason;
      lastResponse = message;

      parsedObject =
        options.output !== undefined
          ? parseStructuredOutput(message, options.output, emit, base())
          : undefined;

      emit({
        type: "responseFinish",
        ...base(),
        message,
        usage: stepUsage,
        totalUsage,
        finishReason: stepFinishReason,
        error: runError,
        duration: responseEnd - stepStart,
      } satisfies ResponseFinishEvent);

      if (runError !== undefined) break;

      transcript.push(message);

      const responseInfo: ResponseInfo = {
        message,
        messages: transcript,
        usage: stepUsage,
        totalUsage,
        finishReason: stepFinishReason,
        object: parsedObject,
      };

      const afterResponse = await runPolicies<AfterResponseAction>(policies, (p) =>
        p.afterResponse?.(ctx(), responseInfo),
      );

      if (afterResponse != null) {
        if (afterResponse.error) {
          emit({
            type: "error",
            ...base(),
            error: afterResponse.error,
            source: "policy",
            policy: afterResponse.policy,
          } satisfies ErrorEvent);
        }

        const a = afterResponse.action;

        if (a.action === "stop") {
          finishReason = "stop";
          stoppedBy = afterResponse.policy;
          break;
        }

        if (a.action === "replace") {
          transcript[transcript.length - 1] = a.message;
          lastResponse = a.message;
          message = a.message;
        }

        if (a.action === "retry") {
          transcript.pop();
          if (a.messages) transcript.push(...a.messages);
          retries++;
          emit({
            type: "stepRetry",
            ...base(),
            reason: a.reason,
            retries,
          } satisfies StepRetryEvent);
          continue;
        }
      }

      const toolCalls = extractToolCalls(message);

      if (toolCalls.length > 0) {
        const { results, stopRun } = await executeToolCalls(
          toolCalls,
          toolMap,
          policies,
          ctx(),
          emit,
        );

        transcript.push({ role: "tool", content: results });

        if (stopRun !== undefined) {
          stoppedBy = stopRun;
          finishReason = "stop";
          break;
        }
      }

      const stepMessages: Message[] = [message];
      if (toolCalls.length > 0) {
        stepMessages.push(transcript[transcript.length - 1]!);
      }

      const stepInfo: StepInfo = {
        messages: stepMessages,
        transcript,
        usage: stepUsage,
        totalUsage,
        finishReason: stepFinishReason,
        object: parsedObject,
      };

      const afterStep = await runPolicies<AfterStepAction>(policies, (p) =>
        p.afterStep?.(ctx(), stepInfo),
      );

      let injected = false;

      if (afterStep != null) {
        if (afterStep.error) {
          emit({
            type: "error",
            ...base(),
            error: afterStep.error,
            source: "policy",
            policy: afterStep.policy,
          } satisfies ErrorEvent);
        }

        const a = afterStep.action;

        if (a.action === "stop") {
          finishReason = "stop";
          stoppedBy = afterStep.policy;
          emit({
            type: "stepFinish",
            ...base(),
            messages: stepMessages,
            object: parsedObject,
            usage: stepUsage,
            totalUsage,
            finishReason,
            duration: Date.now() - stepStart,
          } satisfies StepFinishEvent);
          break;
        }

        if (a.action === "retry") {
          transcript.splice(transcript.length - stepMessages.length, stepMessages.length);
          if (a.messages) transcript.push(...a.messages);
          retries++;
          emit({
            type: "stepRetry",
            ...base(),
            reason: a.reason,
            retries,
          } satisfies StepRetryEvent);
          continue;
        }

        if (a.action === "inject") {
          transcript.push(...a.messages);
          injected = true;
        }
      }

      emit({
        type: "stepFinish",
        ...base(),
        messages: stepMessages,
        object: parsedObject,
        usage: stepUsage,
        totalUsage,
        finishReason: stepFinishReason,
        duration: Date.now() - stepStart,
      } satisfies StepFinishEvent);

      if (toolCalls.length === 0 && !injected) {
        break;
      }

      step++;
      retries = 0;
    }
  } catch (err) {
    runError = err instanceof Error ? err : new Error(String(err));
    finishReason = "error";
    emit({
      type: "error",
      ...base(),
      error: runError,
      source: "provider",
    } satisfies ErrorEvent);
  }

  const result: AgentResult = {
    text: extractText(lastResponse),
    response: lastResponse,
    transcript,
    steps: step + 1,
    usage: totalUsage,
    finishReason,
    stoppedBy,
    error: runError,
    duration: Date.now() - runStart,
    object: parsedObject as AgentResult["object"],
  };

  emit({
    type: "runFinish",
    ...base(),
    text: result.text,
    response: result.response,
    transcript: result.transcript,
    object: result.object,
    steps: result.steps,
    usage: result.usage,
    finishReason: result.finishReason,
    stoppedBy: result.stoppedBy,
    error: result.error,
    duration: result.duration,
  } satisfies RunFinishEvent);

  return result;
}
