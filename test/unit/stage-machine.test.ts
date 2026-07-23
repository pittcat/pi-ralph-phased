import { describe, expect, it } from "vitest";

import { createStageMachine } from "../../src/stage-machine.js";
import type { StageId } from "../../src/types.js";

const ALL_STAGES = [
  "orientation",
  "tool_discipline",
  "execute",
  "verify",
  "report",
] as const satisfies readonly StageId[];

describe("createStageMachine — initial state", () => {
  it("starts at the first queued stage", () => {
    const machine = createStageMachine(ALL_STAGES);
    expect(machine.current).toBe("orientation");
  });

  it("exposes the next queued stage", () => {
    const machine = createStageMachine(ALL_STAGES);
    expect(machine.nextId).toBe("tool_discipline");
  });

  it("is not complete while stages remain", () => {
    expect(createStageMachine(ALL_STAGES).isComplete).toBe(false);
  });

  it("copies the input queue instead of observing later mutations", () => {
    const stages: StageId[] = ["orientation", "execute"];
    const machine = createStageMachine(stages);
    stages.splice(0, stages.length, "report");
    expect(machine.current).toBe("orientation");
    expect(machine.nextId).toBe("execute");
  });
});

describe("createStageMachine — progression", () => {
  it("advances once to the next stage after a legal completion", () => {
    const machine = createStageMachine(ALL_STAGES);
    const result = machine.completeStage("orientation");

    expect(result).toEqual({ ok: true, advancedTo: "tool_discipline" });
    expect(machine.current).toBe("tool_discipline");
    expect(machine.nextId).toBe("execute");
  });

  it("returns the narrowed advancedTo value for a successful transition", () => {
    const machine = createStageMachine(["orientation", "execute"]);
    const result = machine.completeStage("orientation");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
    expect(result.advancedTo).toBe("execute");
  });

  it("advances through every supplied stage in queue order", () => {
    const machine = createStageMachine(ALL_STAGES);
    const advanced = ALL_STAGES.map((stage) => machine.completeStage(stage));

    expect(advanced).toEqual([
      { ok: true, advancedTo: "tool_discipline" },
      { ok: true, advancedTo: "execute" },
      { ok: true, advancedTo: "verify" },
      { ok: true, advancedTo: "report" },
      { ok: true },
    ]);
    expect(machine.isComplete).toBe(true);
  });

  it("moves directly between present stages when optional stages are absent", () => {
    const machine = createStageMachine(["orientation", "execute", "report"]);
    expect(machine.completeStage("orientation")).toEqual({ ok: true, advancedTo: "execute" });
    expect(machine.completeStage("execute")).toEqual({ ok: true, advancedTo: "report" });
  });

  it("completes a single-stage queue without advancedTo", () => {
    const machine = createStageMachine(["execute"]);
    expect(machine.completeStage("execute")).toEqual({ ok: true });
    expect(machine.current).toBeUndefined();
    expect(machine.nextId).toBeUndefined();
    expect(machine.isComplete).toBe(true);
  });
});

describe("createStageMachine — idempotence", () => {
  it("accepts a repeated completion of an already completed stage", () => {
    const machine = createStageMachine(["orientation", "execute", "verify"]);
    machine.completeStage("orientation");

    expect(machine.completeStage("orientation")).toEqual({ ok: true });
  });

  it("does not advance again when an already completed stage repeats", () => {
    const machine = createStageMachine(["orientation", "execute", "verify"]);
    machine.completeStage("orientation");
    machine.completeStage("orientation");

    expect(machine.current).toBe("execute");
    expect(machine.nextId).toBe("verify");
  });

  it("keeps terminal completion idempotent", () => {
    const machine = createStageMachine(["report"]);
    machine.completeStage("report");

    expect(machine.completeStage("report")).toEqual({ ok: true });
    expect(machine.isComplete).toBe(true);
  });
});

describe("createStageMachine — invalid completion", () => {
  it("rejects a known future stage completed out of order", () => {
    const machine = createStageMachine(ALL_STAGES);
    const result = machine.completeStage("execute");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an invalid transition");
    expect(result.error).toMatch(/execute/i);
    expect(result.error).toMatch(/orientation/i);
  });

  it("leaves state unchanged after a future-stage rejection", () => {
    const machine = createStageMachine(ALL_STAGES);
    const before = { current: machine.current, nextId: machine.nextId, isComplete: machine.isComplete };
    machine.completeStage("verify");

    expect({ current: machine.current, nextId: machine.nextId, isComplete: machine.isComplete }).toEqual(before);
  });

  it("rejects a StageId that is absent from the supplied queue", () => {
    const machine = createStageMachine(["orientation", "report"]);
    const result = machine.completeStage("execute");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an invalid transition");
    expect(result.error).toMatch(/execute/i);
    expect(machine.current).toBe("orientation");
  });

  it("rejects completion when an empty queue is already complete", () => {
    const machine = createStageMachine([]);
    const result = machine.completeStage("orientation");

    expect(result.ok).toBe(false);
    expect(machine.isComplete).toBe(true);
  });
});

describe("createStageMachine — empty queue", () => {
  it("is complete immediately", () => {
    expect(createStageMachine([]).isComplete).toBe(true);
  });

  it("has no current stage", () => {
    expect(createStageMachine([]).current).toBeUndefined();
  });

  it("has no next stage", () => {
    expect(createStageMachine([]).nextId).toBeUndefined();
  });
});
