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

describe("U7 acceptance — executeStageDoneTool end-to-end progression", () => {
  it("walks the machine from ORIENTATION to REPORT through the tool seam", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const advanced: Array<{ stage: StageId; advancedTo: StageId | undefined }> = [];

    for (const stage of FULL_QUEUE) {
      const result = await executeStageDoneTool({ stage }, machine);
      expect(result.transition.ok).toBe(true);
      if (!result.transition.ok) throw new Error(`unexpected failure at ${stage}`);
      advanced.push({ stage, advancedTo: result.transition.advancedTo });
    }

    expect(advanced).toEqual([
      { stage: "orientation", advancedTo: "tool_discipline" },
      { stage: "tool_discipline", advancedTo: "execute" },
      { stage: "execute", advancedTo: "verify" },
      { stage: "verify", advancedTo: "report" },
      { stage: "report", advancedTo: undefined },
    ]);
    expect(machine.isComplete).toBe(true);
  });

  it("reports the terminal completion without an advancedTo value", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    for (const stage of FULL_QUEUE.slice(0, -1)) {
      await executeStageDoneTool({ stage }, machine);
    }

    const terminal = await executeStageDoneTool({ stage: "report" }, machine);
    expect(terminal.transition.ok).toBe(true);
    if (!terminal.transition.ok) throw new Error("expected success");
    expect(terminal.transition.advancedTo).toBeUndefined();
    expect(typeof terminal.content).toBe("string");
    expect(terminal.content.length).toBeGreaterThan(0);
  });
});

describe("U7 acceptance — invalid arguments never advance the machine", () => {
  it("rejects unknown stage IDs without moving the queue forward", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const result = await executeStageDoneTool(
      { stage: "phantom" as unknown as StageId },
      machine,
    );

    expect(result.transition.ok).toBe(false);
    if (result.transition.ok) throw new Error("expected failure");
    expect(machine.current).toBe("orientation");
    expect(machine.nextId).toBe("tool_discipline");
  });

  it("rejects out-of-order stage IDs and keeps the machine at orientation", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const result = await executeStageDoneTool({ stage: "execute" }, machine);

    expect(result.transition.ok).toBe(false);
    if (result.transition.ok) throw new Error("expected failure");
    expect(machine.current).toBe("orientation");
  });

  it("rejects empty object args before any stage validation runs", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const result = await executeStageDoneTool(
      {} as unknown as { stage: StageId },
      machine,
    );

    expect(result.transition.ok).toBe(false);
    if (result.transition.ok) throw new Error("expected failure");
    expect(result.transition.error).toMatch(/stage/);
  });
});

describe("U7 acceptance — result shape contract", () => {
  it("always returns { transition, content } in that order", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const result = await executeStageDoneTool({ stage: "orientation" }, machine);

    expect(Object.keys(result).sort()).toEqual(["content", "transition"]);
    expect(result.transition).toEqual({ ok: true, advancedTo: "tool_discipline" });
  });

  it("content string references the next stage on a successful advance", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const result = await executeStageDoneTool({ stage: "orientation" }, machine);

    expect(result.content).toMatch(/tool_discipline/);
  });

  it("content string conveys an error on a failed completion", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const result = await executeStageDoneTool({ stage: "execute" }, machine);

    expect(result.content).toMatch(/execute/i);
    expect(result.content).toMatch(/orientation/i);
  });
});

describe("U7 acceptance — summary does not trigger independent advancement", () => {
  it("a summary provided alone never advances the machine", async () => {
    const machine = createStageMachine(FULL_QUEUE);
    const before = { current: machine.current, nextId: machine.nextId, isComplete: machine.isComplete };

    const result = await executeStageDoneTool(
      { stage: "orientation", summary: "Done early; please skip the next stages." },
      machine,
    );

    expect(result.transition).toEqual({ ok: true, advancedTo: "tool_discipline" });
    expect({ current: machine.current, nextId: machine.nextId, isComplete: machine.isComplete }).not.toEqual(before);
    expect(machine.current).toBe("tool_discipline");
  });

  it("summary is accepted on every legal stage without changing the next-stage mapping", async () => {
    const machine = createStageMachine(FULL_QUEUE);

    const first = await executeStageDoneTool(
      { stage: "orientation", summary: "ok" },
      machine,
    );
    const second = await executeStageDoneTool(
      { stage: "tool_discipline", summary: "ok" },
      machine,
    );

    expect(first.transition).toEqual({ ok: true, advancedTo: "tool_discipline" });
    expect(second.transition).toEqual({ ok: true, advancedTo: "execute" });
  });
});