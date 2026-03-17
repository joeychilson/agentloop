import { describe, expect, it } from "vitest";
import type { Policy, BeforeStepAction, AfterResponseAction } from "./policy.ts";
import { runPolicies } from "./pipeline.ts";

function policy(name: string, hooks?: Partial<Policy>): Policy {
  return { name, ...hooks };
}

describe("runPolicies", () => {
  it("returns undefined when there are no policies", async () => {
    const result = await runPolicies<BeforeStepAction>([], () => {});
    expect(result).toBeUndefined();
  });

  it("returns undefined when all policies return void", async () => {
    const result = await runPolicies<BeforeStepAction>([policy("a"), policy("b")], () => {});
    expect(result).toBeUndefined();
  });

  it("returns the first non-void action", async () => {
    const result = await runPolicies<BeforeStepAction>([policy("a"), policy("b")], (p) => {
      if (p.name === "b") return { action: "stop", reason: "limit" };
    });
    expect(result).toEqual({
      action: { action: "stop", reason: "limit" },
      policy: "b",
    });
  });

  it("short-circuits after the first non-void action", async () => {
    const called: string[] = [];
    await runPolicies<BeforeStepAction>([policy("a"), policy("b"), policy("c")], (p) => {
      called.push(p.name);
      if (p.name === "b") return { action: "stop" };
    });
    expect(called).toEqual(["a", "b"]);
  });

  it("treats a thrown error as a stop action", async () => {
    const result = await runPolicies<BeforeStepAction>([policy("crasher")], () => {
      throw new Error("policy broke");
    });
    expect(result).toBeDefined();
    expect(result!.action).toEqual({ action: "stop", reason: "policy broke" });
    expect(result!.policy).toBe("crasher");
    expect(result!.error).toBeInstanceOf(Error);
    expect(result!.error!.message).toBe("policy broke");
  });

  it("treats a non-Error throw as a stop action", async () => {
    const result = await runPolicies<BeforeStepAction>([policy("crasher")], () => {
      throw "string error";
    });
    expect(result!.error!.message).toBe("string error");
  });

  it("handles async policy hooks", async () => {
    const result = await runPolicies<AfterResponseAction>([policy("async")], async () => ({
      action: "stop" as const,
      reason: "async stop",
    }));
    expect(result).toEqual({
      action: { action: "stop", reason: "async stop" },
      policy: "async",
    });
  });

  it("handles async policy rejection", async () => {
    const result = await runPolicies<BeforeStepAction>([policy("async-crash")], async () => {
      throw new Error("async fail");
    });
    expect(result!.action).toEqual({ action: "stop", reason: "async fail" });
    expect(result!.error!.message).toBe("async fail");
  });

  it("skips policies after an error (short-circuit)", async () => {
    const called: string[] = [];
    await runPolicies<BeforeStepAction>([policy("a"), policy("b")], (p) => {
      called.push(p.name);
      if (p.name === "a") throw new Error("fail");
    });
    expect(called).toEqual(["a"]);
  });

  it("works with real policy hooks via invoke callback", async () => {
    const p = policy("guard", {
      beforeStep: () => ({ action: "stop", reason: "max steps" }),
    });
    const result = await runPolicies<BeforeStepAction>([p], (pol) =>
      pol.beforeStep?.({} as never, {} as never),
    );
    expect(result).toEqual({
      action: { action: "stop", reason: "max steps" },
      policy: "guard",
    });
  });

  it("skips policies that don't implement the hook", async () => {
    const p1 = policy("no-hook");
    const p2 = policy("has-hook", {
      beforeStep: () => ({ action: "stop", reason: "from p2" }),
    });
    const result = await runPolicies<BeforeStepAction>([p1, p2], (pol) =>
      pol.beforeStep?.({} as never, {} as never),
    );
    expect(result!.policy).toBe("has-hook");
  });
});
