/**
 * Minimal schema interface for argument validation and type inference.
 *
 * Any validator with a compatible `safeParse` method works — Zod, Valibot,
 * ArkType, or a hand-rolled validator. No adapter needed.
 *
 * **Provider requirement:** When used in tool definitions, providers need to
 * extract a JSON Schema representation to send to the model API. Providers
 * use the [Standard Schema](https://github.com/standard-schema/standard-schema)
 * interface (`~standard.jsonSchema.input()`) for this conversion.
 *
 * Schemas from Standard Schema-compliant libraries (Zod v4+, Valibot v1+,
 * ArkType) work automatically with all providers. Hand-rolled schemas with
 * only `safeParse` will validate arguments correctly but will throw at
 * runtime when used with a provider that requires JSON Schema extraction.
 */
export interface Schema<T = unknown> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
}

/** Extract the output type from a {@link Schema}. */
export type Infer<S extends Schema> = S extends Schema<infer T> ? T : never;

/**
 * Extract a JSON Schema object from a
 * [Standard Schema v1](https://github.com/standard-schema/standard-schema)
 * compatible validator.
 *
 * Throws if the schema does not expose `~standard.jsonSchema.input()`.
 */
export function schemaToJsonSchema(schema: unknown): Record<string, unknown> {
  const ss = (schema as Record<string, unknown>)?.["~standard"] as
    | { jsonSchema?: { input?: () => Record<string, unknown> } }
    | undefined;
  if (ss?.jsonSchema?.input) {
    return ss.jsonSchema.input() as Record<string, unknown>;
  }
  throw new Error(
    "Cannot convert schema to JSON Schema. Provide a Standard Schema v1-compatible validator.",
  );
}
