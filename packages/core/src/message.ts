import type { AssistantContent, SystemContent, ToolContent, UserContent } from "./content.ts";
import { text } from "./content.ts";

/** A system instruction that guides model behavior. */
export interface SystemMessage {
  /** Message discriminator. */
  role: "system";
  /** The system instruction content. */
  content: SystemContent[];
  /** Arbitrary key-value pairs for provider or application use. */
  metadata?: Record<string, unknown>;
}

/** A message from the user. */
export interface UserMessage {
  /** Message discriminator. */
  role: "user";
  /** User-provided content (text, media, structured data, etc.). */
  content: UserContent[];
  /** Arbitrary key-value pairs for provider or application use. */
  metadata?: Record<string, unknown>;
}

/** A response from the model. */
export interface AssistantMessage {
  /** Message discriminator. */
  role: "assistant";
  /** Model-generated content (text, thinking, tool calls). */
  content: AssistantContent[];
  /** Arbitrary key-value pairs for provider or application use. */
  metadata?: Record<string, unknown>;
}

/** The result of one or more tool invocations. */
export interface ToolMessage {
  /** Message discriminator. */
  role: "tool";
  /** Tool results to return to the model. */
  content: ToolContent[];
  /** Arbitrary key-value pairs for provider or application use. */
  metadata?: Record<string, unknown>;
}

/** A message in a conversation. */
export type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

/** Create a {@link SystemMessage}. Accepts a string or content array. */
export function system(content: string | SystemContent[]): SystemMessage {
  return { role: "system", content: typeof content === "string" ? [text(content)] : content };
}

/** Create a {@link UserMessage}. Accepts a string or content array. */
export function user(content: string | UserContent[]): UserMessage {
  return { role: "user", content: typeof content === "string" ? [text(content)] : content };
}

/** Create an {@link AssistantMessage}. Accepts a string or content array. */
export function assistant(content: string | AssistantContent[]): AssistantMessage {
  return { role: "assistant", content: typeof content === "string" ? [text(content)] : content };
}

/** Flexible input type for agent invocations. A plain string is treated as a user message. */
export type Prompt = string | Message | Message[];

/** Normalize a {@link Prompt} into a {@link Message} array. */
export function normalizePrompt(prompt: Prompt): Message[] {
  if (typeof prompt === "string") {
    return [user(prompt)];
  }
  if (Array.isArray(prompt)) {
    return prompt;
  }
  return [prompt];
}
