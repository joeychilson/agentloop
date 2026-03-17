/* eslint-disable no-await-in-loop */
import type { Policy } from "./policy.ts";

/**
 * The result of evaluating a policy pipeline.
 *
 * Contains the winning action, the name of the policy that produced it,
 * and — if the policy threw instead of returning — the original error.
 */
export interface PolicyResult<TAction> {
  /** The action returned by the winning policy, or a synthetic stop on error. */
  action: TAction;
  /** Name of the policy that produced this result. */
  policy: string;
  /** The error, if the policy threw instead of returning an action. */
  error?: Error;
}

/**
 * Evaluate policies in pipeline order.
 *
 * The first policy to return a non-void action wins and short-circuits the
 * remaining policies. If a policy throws, the error is caught and treated as
 * a `{ action: "stop" }` directive — the error is preserved on the result
 * so the caller can emit an appropriate {@link ErrorEvent}.
 */
export async function runPolicies<TAction>(
  policies: Policy[],
  invoke: (policy: Policy) => void | TAction | Promise<void | TAction>,
): Promise<PolicyResult<TAction> | undefined> {
  for (const policy of policies) {
    try {
      const result = await invoke(policy);
      if (result != null) {
        return { action: result, policy: policy.name };
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        action: { action: "stop", reason: error.message } as TAction,
        policy: policy.name,
        error,
      };
    }
  }
  return undefined;
}
