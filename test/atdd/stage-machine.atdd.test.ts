import { describe, expect, it } from "vitest";

import { createStageMachine } from "../../src/stage-machine.js";
import type { StageId } from "../../src/types.js";

const FULL_QUEUE = [
  "orientation",
  "tool_discipline",
  "execute",
  "verify",
  "report",
] as const satisfies readonly StageId[];

describe("U4 acceptance — ordered stage progression", () => {
  it("progresses from ORIENTATION to REPORT in declared queue order", () => {
    const machine = createStageMachine(FULL_QUEUE);

    for (const [index, stage] of FULL_QUEUE.entries()) {
      expect(machine.current).toBe(stage);
      const result = machine.completeStage(stage);
      const expectedNext = FULL_QUEUE[index + 1];
      expect(result).toEqual(expectedNext === undefined ? { ok: true } : { ok: true, advancedTo: expectedNext });
    }

    expect(machine.isComplete).toBe(true);
  });

  it("skips absent optional stages rather than synthesizing them", () => {
    const machine = createStageMachine(["orientation", "execute", "report"]);

    expect(machine.completeStage("orientation")).toEqual({ ok: true, advancedTo: "execute" });
    expect(machine.completeStage("execute")).toEqual({ ok: true, advancedTo: "report" });
    expect(machine.completeStage("report")).toEqual({ ok: true });
  });

  it("completes an empty parsed queue immediately", () => {
    const machine = createStageMachine([]);

    expect(machine.current).toBeUndefined();
    expect(machine.nextId).toBeUndefined();
    expect(machine.isComplete).toBe(true);
  });
});

describe("U4 acceptance — completion safety", () => {
  it("treats repeated done for a completed stage as an idempotent success", () => {
    const machine = createStageMachine(["orientation", "execute", "report"]);
    machine.completeStage("orientation");

    expect(machine.completeStage("orientation")).toEqual({ ok: true });
    expect(machine.current).toBe("execute");
  });

  it("rejects out-of-order done without mutating the queue position", () => {
    const machine = createStageMachine(FULL_QUEUE);
    const result = machine.completeStage("execute");

    expect(result.ok).toBe(false);
    expect(machine.current).toBe("orientation");
    expect(machine.nextId).toBe("tool_discipline");
    expect(machine.isComplete).toBe(false);
  });

  it("exposes advancedTo only after TypeScript-recognized success narrowing", () => {
    const machine = createStageMachine(["verify", "report"]);
    const result = machine.completeStage("verify");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
    expect(result.advancedTo).toBe("report");
  });
});
