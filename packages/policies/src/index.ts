import type { Policy } from "@agentloop/core";

/**
 * Stop the run after a maximum number of steps.
 *
 * Evaluated in {@link Policy.beforeStep}. The step count is zero-indexed,
 * so `maxSteps(5)` allows steps 0–4 (five model calls).
 */
export function maxSteps(limit: number): Policy {
  return {
    name: "maxSteps",
    beforeStep(ctx) {
      if (ctx.step >= limit) {
        return { action: "stop", reason: `Maximum steps (${limit}) reached` };
      }
    },
  };
}

/**
 * Stop the run after a maximum number of retries on a single step.
 *
 * Evaluated in {@link Policy.beforeStep}. Retries are tracked per step and
 * reset to zero when a step completes successfully.
 */
export function maxRetries(limit: number): Policy {
  return {
    name: "maxRetries",
    beforeStep(ctx) {
      if (ctx.retries >= limit) {
        return { action: "stop", reason: `Maximum retries (${limit}) reached` };
      }
    },
  };
}

/**
 * Stop the run after total token usage exceeds a budget.
 *
 * Evaluated in {@link Policy.afterResponse} using the aggregated
 * {@link ResponseInfo.totalUsage}. Checks `totalTokens` (input + output).
 */
export function maxTokens(limit: number): Policy {
  return {
    name: "maxTokens",
    afterResponse(_ctx, info) {
      if (info.totalUsage.totalTokens >= limit) {
        return { action: "stop", reason: `Token budget (${limit}) exceeded` };
      }
    },
  };
}

/**
 * Stop the run after a wall-clock duration is exceeded.
 *
 * Evaluated in {@link Policy.beforeStep}. The elapsed time is measured from
 * when the policy is created (typically at the start of the run).
 */
export function maxDuration(ms: number): Policy {
  const start = Date.now();
  return {
    name: "maxDuration",
    beforeStep() {
      if (Date.now() - start >= ms) {
        return { action: "stop", reason: `Duration limit (${ms}ms) exceeded` };
      }
    },
  };
}
