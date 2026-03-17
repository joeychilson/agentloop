# @agentloop/policies

Common reusable policies for [`@agentloop/core`](../core) agents.

## Install

```bash
npm install @agentloop/core @agentloop/policies
```

## Usage

```ts
import { defineAgent } from "@agentloop/core";
import { maxSteps, maxRetries, maxTokens, maxDuration } from "@agentloop/policies";

const agent = defineAgent({
  model,
  policies: [maxSteps(10), maxRetries(3), maxTokens(100_000), maxDuration(30_000)],
});
```

## Policies

### `maxSteps(limit)`

Stop the run after a maximum number of model calls. The step count is zero-indexed, so `maxSteps(5)` allows steps 0-4 (five model calls).

Hook: `beforeStep`

### `maxRetries(limit)`

Stop the run after a maximum number of retries on a single step. The retry count resets to zero when a step completes successfully.

Hook: `beforeStep`

### `maxTokens(limit)`

Stop the run after total token usage (input + output) exceeds a budget. Checked against the aggregated usage across all steps.

Hook: `afterResponse`

### `maxDuration(ms)`

Stop the run after a wall-clock duration is exceeded. Measured from when the policy is created.

Hook: `beforeStep`

## Writing custom policies

For policies beyond these common guards, use `definePolicy` from `@agentloop/core`:

```ts
import { definePolicy } from "@agentloop/core";

const noDelete = definePolicy({
  name: "no-delete",
  beforeToolRun(ctx, call) {
    if (call.name === "delete_file") {
      return { action: "skip", reason: "Deletes are not allowed" };
    }
  },
});
```

See the [`@agentloop/core` README](../core) for the full policy API.

## License

MIT
