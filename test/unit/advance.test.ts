import { describe, expect, it } from "vitest";

import { advanceAfterSettled, renderHandoffBrief } from "../../src/advance.js";
import { parseRalphPrompt } from "../../src/parse.js";
import { createSessionState } from "../../src/session-state.js";
import type { RalphSessionState, StageId } from "../../src/types.js";

/**
 * U9 acceptance — handoff brief truncation.
 *
 * Per the U9 contract the handoff brief must be at most 4096 characters;
 * anything longer is truncated and the truncated form must clearly indicate
 * it was cut. The mechanism exists so downstream callers cannot accidentally
 * blow up the new session kickoff with an unbounded string.
 */
describe("U9 — renderHandoffBrief truncation policy", () => {
  const baseState = makeState({ advancedTo: "execute" });

  it("returns the input verbatim when it fits inside the budget", () => {
    const brief = "Short summary of the previous stage.";
    const result = renderHandoffBrief(baseState, brief);
    expect(result).toBe(brief);
    expect(result.length).toBe(brief.length);
  });

  it("returns the empty string for null/undefined briefs without annotation", () => {
    expect(renderHandoffBrief(baseState, null)).toBe("");
    expect(renderHandoffBrief(baseState, undefined)).toBe("");
  });

  it("returns the empty string for an empty input", () => {
    expect(renderHandoffBrief(baseState, "")).toBe("");
  });

  it("truncates briefs longer than 4096 characters and appends a truncation marker", () => {
    const overlong = "X".repeat(5000);
    const result = renderHandoffBrief(baseState, overlong);
    expect(result.length).toBeLessThanOrEqual(4096);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toMatch(/…?\s*\[truncated\]|\[truncated[^]]*\]$/);
  });

  it("preserves the head of the brief when truncating", () => {
    const head = "HEAD-MARKER";
    const filler = "Y".repeat(8000);
    const result = renderHandoffBrief(baseState, head + filler);
    expect(result.startsWith(head)).toBe(true);
  });

  it("truncated briefs never exceed the 4096-character budget even with marker overhead", () => {
    const worstCase = "Z".repeat(20000);
    const result = renderHandoffBrief(baseState, worstCase);
    expect(result.length).toBeLessThanOrEqual(4096);
  });
});

/**
 * U9 acceptance — advanceAfterSettled port contract.
 *
 * The orchestration seam must:
 *  - Call `waitForIdle()` first when the port provides it, and await it.
 *  - Then call `newSession({ kickoff })` exactly once when the machine has
 *    advanced to a next stage that is not the actual last stage.
 *  - Skip both calls when the stage machine is at the actual last stage
 *    (i.e. the previously completed stage was the terminal one).
 *  - Record call order so a single session may process multiple advances
 *    without races between successive calls.
 */
describe("U9 — advanceAfterSettled call sequence on advance", () => {
  it("calls newSession exactly once with a kickoff derived from the next stage", async () => {
    const state = makeState({ advancedTo: "tool_discipline" });
    const port = makeRecordingPort();

    await advanceAfterSettled(state, port);

    expect(port.newSessionCalls).toHaveLength(1);
    const kickoff = port.newSessionCalls[0]?.kickoff ?? "";
    expect(kickoff).toContain("TOOL DISCIPLINE");
    expect(kickoff).toContain(state.fullPromptPath);
  });

  it("awaits waitForIdle before invoking newSession when the port exposes it", async () => {
    const state = makeState({ advancedTo: "execute" });
    const port = makeRecordingPort();

    const order: string[] = [];
    port.waitForIdle = async () => {
      order.push("wait");
    };
    const originalNewSession = port.newSession.bind(port);
    port.newSession = async (options) => {
      order.push("newSession");
      await originalNewSession(options);
    };

    await advanceAfterSettled(state, port);

    expect(order).toEqual(["wait", "newSession"]);
  });

  it("skips the waitForIdle call when the port does not expose it", async () => {
    const state = makeState({ advancedTo: "verify" });
    const port = makeRecordingPort();
    delete (port as { waitForIdle?: unknown }).waitForIdle;

    await advanceAfterSettled(state, port);

    expect(port.newSessionCalls).toHaveLength(1);
    expect(port.sendUserMessageCalls).toHaveLength(0);
    expect(port.waitForIdleCalls).toEqual(0);
  });

  it("records call order across multiple successive advance calls", async () => {
    const port = makeRecordingPort();

    await advanceAfterSettled(makeState({ advancedTo: "tool_discipline" }), port);
    await advanceAfterSettled(makeState({ advancedTo: "execute" }), port);
    await advanceAfterSettled(makeState({ advancedTo: "verify" }), port);

    expect(port.newSessionCalls).toHaveLength(3);
  });

  it("includes a derived handoff brief in the kickoff message", async () => {
    const state = makeState({ advancedTo: "tool_discipline" });
    const port = makeRecordingPort();

    await advanceAfterSettled(state, port);

    const kickoff = port.newSessionCalls[0]?.kickoff ?? "";
    expect(kickoff).toContain("HANDOFF");
  });

  it("does not include any previous-stage tool_call trace text in the kickoff", async () => {
    const state = makeState({ advancedTo: "tool_discipline" });
    const port = makeRecordingPort();

    await advanceAfterSettled(state, port);

    const kickoff = port.newSessionCalls[0]?.kickoff ?? "";
    expect(kickoff).not.toMatch(/tool_call_id|tool_result|function_call/);
  });
});

describe("U9 — advanceAfterSettled terminal (S12)", () => {
  it("does NOT call newSession when the current stage is the last in the queue", async () => {
    const state = makeState({ advancedTo: "report" });
    const port = makeRecordingPort();

    await advanceAfterSettled(state, port);

    expect(port.newSessionCalls).toHaveLength(0);
    expect(port.sendUserMessageCalls).toHaveLength(0);
    expect(port.waitForIdleCalls).toEqual(0);
  });

  it("does NOT call sendUserMessage on the terminal path even if the port exposes it", async () => {
    const state = makeState({ advancedTo: "report" });
    const port = makeRecordingPort();

    await advanceAfterSettled(state, port);

    expect(port.sendUserMessageCalls).toHaveLength(0);
  });

  it("does NOT await waitForIdle on the terminal path", async () => {
    const state = makeState({ advancedTo: "report" });
    const port = makeRecordingPort();

    await advanceAfterSettled(state, port);

    expect(port.waitForIdleCalls).toEqual(0);
  });
});

/**
 * Helpers
 */

interface RecordingPort {
  waitForIdle?(): Promise<void>;
  newSession(options: { kickoff: string }): Promise<void>;
  sendUserMessage?(text: string): Promise<void>;
  newSessionCalls: Array<{ record: string; kickoff: string }>;
  sendUserMessageCalls: Array<{ record: string; text: string }>;
  waitForIdleCalls: number;
}

function makeRecordingPort(): RecordingPort {
  let counter = 0;
  const port: RecordingPort = {
    newSessionCalls: [],
    sendUserMessageCalls: [],
    waitForIdleCalls: 0,
    newSession: async (options) => {
      counter += 1;
      port.newSessionCalls.push({ record: counter.toString(), kickoff: options.kickoff });
    },
  };
  port.waitForIdle = async () => {
    port.waitForIdleCalls += 1;
  };
  port.sendUserMessage = async (text) => {
    counter += 1;
    port.sendUserMessageCalls.push({ record: counter.toString(), text });
  };
  return port;
}

const STANDARD_PROMPT = `You are Ralph, the autonomous implementation hat.

### 0. ORIENTATION
Orient stage body marker.

### 0b. TOOL DISCIPLINE
Tool discipline stage body marker.

### 1. EXECUTE
Execute stage body marker.

<ralph-tools-skill id="delivery">Deferred skill XML body marker.</ralph-tools-skill>

### 2. VERIFY
Verify stage body marker.

### 3. REPORT
Report stage body marker.
`;

function parsedRalph(): NonNullable<ReturnType<typeof parseRalphPrompt>> {
  const parsed = parseRalphPrompt(STANDARD_PROMPT);
  if (!parsed) throw new Error("U9 fixture must parse");
  return parsed;
}

function makeState(overrides: { advancedTo?: StageId } = {}): RalphSessionState {
  const parsed = parsedRalph();
  const base = createSessionState({
    originalPrompt: STANDARD_PROMPT,
    fullPromptPath: "/tmp/pi-ralph-phased-abc/original.md",
    parsed,
    stageIds: parsed.stages.map((s) => s.id) as StageId[],
  });

  const advancedTo: StageId | undefined = overrides.advancedTo;
  if (advancedTo === undefined) return base;

  const completed = new Set<StageId>([base.currentStage]);
  return {
    ...base,
    currentStage: advancedTo,
    completedStages: completed,
  };
}
