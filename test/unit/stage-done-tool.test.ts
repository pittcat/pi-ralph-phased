import { describe, expect, it } from "vitest";

import { createStageMachine } from "../../src/stage-machine.js";
import { executeStageDoneTool } from "../../src/tools/stage-done.js";
import type { StageId } from "../../src/types.js";

const FULL_QUEUE = [
  "orientation",
  "tool_discipline",
  "execute",
  "verify",
  "report",
] as const satisfies readonly StageId[];

const STAGE_IDS: readonly StageId[] = [
  "orientation",
  "tool_discipline",
  "execute",
  "verify",
  "report",
];

function isStageId(value: unknown): value is StageId {
  return typeof value === "string" && (STAGE_IDS as readonly string[]).includes(value);
}

describe("executeStageDoneTool — result shape", () => {
  it("returns a StageDoneResult object on a legal completion", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const result = await executeStageDoneTool({ stage: "orientation" }, machine);

    expect(result).toEqual({
      transition: { ok: true, advancedTo: "tool_discipline" },
      content: expect.any(String),
    });
  });

  it("exposes a non-empty content string for downstream tool callers", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const result = await executeStageDoneTool({ stage: "orientation" }, machine);

    expect(typeof result.content).toBe("string");
    expect(result.content.length).toBeGreaterThan(0);
  });
});

describe("executeStageDoneTool — legal progression", () => {
  it("advances the machine on a legal first-stage completion", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const before = { current: machine.current, nextId: machine.nextId };

    const result = await executeStageDoneTool({ stage: "orientation" }, machine);

    expect(result.transition).toEqual({ ok: true, advancedTo: "tool_discipline" });
    expect(machine.current).toBe("tool_discipline");
    expect(machine.current).not.toBe(before.current);
    expect(machine.nextId).toBe("execute");
  });

  it("returns advancedTo undefined when the machine becomes complete", async () => {
    const machine = createStageMachine(["execute"]);
    const result = await executeStageDoneTool({ stage: "execute" }, machine);

    expect(result.transition.ok).toBe(true);
    if (!result.transition.ok) throw new Error("expected success");
    expect(result.transition.advancedTo).toBeUndefined();
    expect(machine.isComplete).toBe(true);
  });

  it("allows passing summary alongside stage without altering the transition", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const result = await executeStageDoneTool(
      { stage: "orientation", summary: "Wrapped up orientation." },
      machine,
    );

    expect(result.transition).toEqual({ ok: true, advancedTo: "tool_discipline" });
    expect(machine.current).toBe("tool_discipline");
  });
});

describe("executeStageDoneTool — invalid stage", () => {
  it("rejects an unknown stage string with a clear error", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const result = await executeStageDoneTool(
      { stage: "unknown_stage" as unknown as StageId },
      machine,
    );

    expect(result.transition.ok).toBe(false);
    if (result.transition.ok) throw new Error("expected failure");
    expect(result.transition.error).toMatch(/unknown_stage/);
  });

  it("does not advance the machine when stage validation fails", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const before = { current: machine.current, nextId: machine.nextId, isComplete: machine.isComplete };

    await executeStageDoneTool({ stage: "execute" }, machine);

    expect({ current: machine.current, nextId: machine.nextId, isComplete: machine.isComplete }).toEqual(before);
  });

  it("does not mark the stage completed when stage validation fails", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const firstResult = await executeStageDoneTool(
      { stage: "bogus" as unknown as StageId },
      machine,
    );
    expect(firstResult.transition.ok).toBe(false);

    const secondResult = await executeStageDoneTool({ stage: "orientation" }, machine);
    expect(secondResult.transition).toEqual({ ok: true, advancedTo: "tool_discipline" });
  });

  it("returns the StageId-narrowed error from the machine for an out-of-order stage", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const result = await executeStageDoneTool({ stage: "execute" }, machine);

    expect(result.transition.ok).toBe(false);
    if (result.transition.ok) throw new Error("expected failure");
    expect(result.transition.error).toMatch(/execute/i);
    expect(result.transition.error).toMatch(/orientation/i);
  });
});

describe("executeStageDoneTool — argument validation", () => {
  it("rejects null args", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const result = await executeStageDoneTool(
      null as unknown as { stage: StageId },
      machine,
    );

    expect(result.transition.ok).toBe(false);
    if (result.transition.ok) throw new Error("expected failure");
    expect(result.transition.error).toMatch(/args/i);
  });

  it("rejects undefined args", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const result = await executeStageDoneTool(
      undefined as unknown as { stage: StageId },
      machine,
    );

    expect(result.transition.ok).toBe(false);
    if (result.transition.ok) throw new Error("expected failure");
    expect(result.transition.error).toMatch(/args/i);
  });

  it("rejects an empty object literal", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const result = await executeStageDoneTool(
      {} as unknown as { stage: StageId },
      machine,
    );

    expect(result.transition.ok).toBe(false);
    if (result.transition.ok) throw new Error("expected failure");
    expect(result.transition.error).toMatch(/stage/i);
  });

  it("rejects args whose stage is the wrong type (number)", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const result = await executeStageDoneTool(
      { stage: 42 as unknown as StageId },
      machine,
    );

    expect(result.transition.ok).toBe(false);
    if (result.transition.ok) throw new Error("expected failure");
    expect(result.transition.error).toMatch(/stage/i);
  });

  it("rejects args whose stage is the wrong type (object)", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const result = await executeStageDoneTool(
      { stage: { value: "orientation" } as unknown as StageId },
      machine,
    );

    expect(result.transition.ok).toBe(false);
    if (result.transition.ok) throw new Error("expected failure");
  });

  it("never invokes completeStage when args validation fails", async () => {
    const calls: StageId[] = [];
    const machine: ReturnType<typeof createStageMachine> = {
      current: "orientation",
      nextId: "tool_discipline",
      isComplete: false,
      completeStage(stage: StageId) {
        calls.push(stage);
        return { ok: true, advancedTo: "tool_discipline" };
      },
    };

    await executeStageDoneTool(
      {} as unknown as { stage: StageId },
      machine,
    );

    expect(calls).toEqual([]);
  });
});

describe("executeStageDoneTool — idempotence", () => {
  it("treats a repeated completion of an already-completed stage as success", async () => {
    const machine = createStageMachine(["orientation", "execute", "report"]);
    const first = await executeStageDoneTool({ stage: "orientation" }, machine);
    const second = await executeStageDoneTool({ stage: "orientation" }, machine);

    expect(first.transition).toEqual({ ok: true, advancedTo: "execute" });
    expect(second.transition.ok).toBe(true);
    if (!second.transition.ok) throw new Error("expected success");
    expect(second.transition.advancedTo).toBeUndefined();
    expect(machine.current).toBe("execute");
  });

  it("keeps the machine complete on repeated terminal completion", async () => {
    const machine = createStageMachine(["report"]);
    const first = await executeStageDoneTool({ stage: "report" }, machine);
    const second = await executeStageDoneTool({ stage: "report" }, machine);

    expect(first.transition.ok).toBe(true);
    expect(second.transition.ok).toBe(true);
    expect(machine.isComplete).toBe(true);
  });
});

describe("executeStageDoneTool — summary isolation", () => {
  it("never triggers an independent advance from the summary field alone", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const before = { current: machine.current, nextId: machine.nextId, isComplete: machine.isComplete };

    const result = await executeStageDoneTool(
      { stage: "orientation", summary: "Skipping ahead is not allowed." },
      machine,
    );

    expect(result.transition).toEqual({ ok: true, advancedTo: "tool_discipline" });
    expect(machine.current).toBe("tool_discipline");
    expect(before.current).toBe("orientation");
  });

  it("ignores summary when stage validation fails", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const result = await executeStageDoneTool(
      {
        stage: "execute",
        summary: "should not matter when stage is wrong",
      },
      machine,
    );

    expect(result.transition.ok).toBe(false);
    if (result.transition.ok) throw new Error("expected failure");
    expect(machine.current).toBe("orientation");
  });
});

describe("executeStageDoneTool — StageId union narrowing (smoke)", () => {
  it("accepts every member of the StageId union as a legal argument", () => {
    for (const id of STAGE_IDS) {
      expect(isStageId(id)).toBe(true);
    }
  });

  it("rejects arbitrary strings that are not members of the StageId union", () => {
    expect(isStageId("not-a-stage")).toBe(false);
    expect(isStageId("")).toBe(false);
    expect(isStageId("ORIENTATION")).toBe(false);
  });
});