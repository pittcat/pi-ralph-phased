import { describe, expect, it } from "vitest";

import {
  FakeExtensionAPI,
  type FakeSessionPort,
} from "../fakes/fake-pi.js";
import piRalphPhased from "../../src/index.js";
import { parseRalphPrompt } from "../../src/parse.js";
import { createSessionState } from "../../src/session-state.js";
import type { RalphSessionState, StageId } from "../../src/types.js";

/**
 * U9 ATDD — agent_settled advance + newSession reset (Fake context).
 *
 * Scenarios S11 and S12 from the plan:
 *   S11: After a stage is done, the extension calls newSession so the next
 *        stage begins in a fresh session whose kickoff text is the next
 *        stage's short contract; the new session MUST NOT carry the
 *        previous stage's tool_call trace.
 *   S12: After the actual last stage is done, no newSession/sendUserMessage/
 *        waitForIdle is invoked; the extension surfaces completion through
 *        the session-state `isComplete` accessor and stops advancing.
 *
 * This ATDD drives the FULL extension surface end-to-end through the Fake;
 * the per-seam contract is exercised by `test/unit/advance.test.ts`.
 *
 * Why we seed `fake.store` directly instead of calling `before_agent_start`:
 *   U8's first-turn S1 test enumerates `pi-ralph-phased-*` entries under
 *   `os.tmpdir()` and asserts no new files were written for short prompts.
 *   Vitest workers share the OS tmpdir (no per-fork TMPDIR override), so if
 *   this file calls `before_agent_start` concurrently with U8's snapshot,
 *   we race. Seeding via `fake.store.set(state)` removes the tmp-write side
 *   effect entirely while still exercising the real extension handler chain
 *   (registration -> agent_settled -> advance). Production Pi 0.81.1 never
 *   writes `store` onto the agent_settled ctx, so the production path is
 *   unaffected.
 */

const STANDARD_RALPH = `You are Ralph, the autonomous implementation hat.

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

const FULL_PROMPT_PATH = "/tmp/pi-ralph-phased-test/abcdef/original.md";

function parsedRalph(): NonNullable<ReturnType<typeof parseRalphPrompt>> {
  const parsed = parseRalphPrompt(STANDARD_RALPH);
  if (!parsed) throw new Error("ATDD fixture must parse");
  return parsed;
}

interface FakeToolCall {
  tool_call_id: string;
  name: string;
  args: Record<string, unknown>;
}

async function loadExtension(): Promise<FakeExtensionAPI> {
  const fake = new FakeExtensionAPI();
  await piRalphPhased(fake as unknown as Parameters<typeof piRalphPhased>[0]);
  return fake;
}

async function driveStageDone(
  fake: FakeExtensionAPI,
  toolCall: FakeToolCall,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const tool = fake.registeredTools().find((t) => t.name === "ralph_stage_done");
  if (!tool) throw new Error("ralph_stage_done was not registered");
  const execute = tool.definition["execute"] as unknown as (
    toolCallId: string,
    params: Record<string, unknown>,
  ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
  return execute(toolCall.tool_call_id, toolCall.args);
}

/**
 * Build a seed state whose `completedStages` includes the stages the test
 * wants to claim have already happened. We compose `createSessionState` and
 * post-mutate the resulting state's completedStages set.
 */
function seed(
  fake: FakeExtensionAPI,
  currentStage: StageId,
  completed: ReadonlyArray<StageId>,
): void {
  const parsed = parsedRalph();
  const base = createSessionState({
    originalPrompt: STANDARD_RALPH,
    fullPromptPath: FULL_PROMPT_PATH,
    parsed,
    stageIds: parsed.stages.map((s) => s.id) as StageId[],
    currentStage,
  });
  const completedSet = new Set<StageId>(completed);
  const seeded: RalphSessionState = { ...base, completedStages: completedSet };
  fake.store.set(seeded);
}

describe("U9 ATDD — S11: agent_settled advances the session via newSession", () => {
  it("registers an agent_settled handler on extension load", async () => {
    const fake = await loadExtension();
    expect(fake.hasHandler("agent_settled")).toBe(true);
  });

  it("after ORIENTATION completes, agent_settled calls newSession exactly once with the next stage's kickoff", async () => {
    const fake = await loadExtension();
    // After ORIENTATION done: currentStage="tool_discipline", completed={orientation}.
    seed(fake, "tool_discipline", ["orientation"]);

    // Reset recorded calls before the action under test.
    const session: FakeSessionPort = fake.session;
    session.calls.length = 0;

    await fake.invokeAgentSettled({});

    expect(session.newSessionCalls()).toHaveLength(1);
    expect(session.sendUserMessageCalls()).toHaveLength(0);

    const kickoff = session.newSessionCalls()[0]?.kickoff ?? "";
    expect(kickoff).toContain("TOOL DISCIPLINE");
    expect(kickoff).toContain(FULL_PROMPT_PATH);
    expect(kickoff).toContain("ralph_stage_done");
  });

  it("awaits waitForIdle before invoking newSession when the context exposes it", async () => {
    const fake = await loadExtension();
    seed(fake, "execute", ["orientation", "tool_discipline"]);
    fake.session.calls.length = 0;
    await fake.invokeAgentSettled({});

    const calls = fake.session.calls.map((c) => c.kind);
    expect(calls[0]).toBe("waitForIdle");
    expect(calls[calls.length - 1]).toBe("newSession");
  });

  it("the new kickoff does not contain the previous stage's tool_call trace", async () => {
    const fake = await loadExtension();
    seed(fake, "tool_discipline", ["orientation"]);

    fake.session.calls.length = 0;
    await fake.invokeAgentSettled({});

    const kickoff = fake.session.newSessionCalls()[0]?.kickoff ?? "";
    expect(kickoff).not.toMatch(/tool_call_id|tool_result|function_call/);
  });

  it("successive advances record call order: waitForIdle then newSession on each call", async () => {
    const fake = await loadExtension();
    seed(fake, "tool_discipline", ["orientation"]);
    fake.session.calls.length = 0;

    await fake.invokeAgentSettled({});

    expect(fake.session.newSessionCalls()).toHaveLength(1);
    const firstKickoff = fake.session.newSessionCalls()[0]?.kickoff ?? "";
    expect(firstKickoff).toContain("TOOL DISCIPLINE");
    expect(fake.session.calls[0]?.kind).toBe("waitForIdle");
    expect(fake.session.calls[fake.session.calls.length - 1]?.kind).toBe("newSession");
  });

  it("after EXECUTE done, advance produces the VERIFY kickoff", async () => {
    const fake = await loadExtension();
    seed(fake, "verify", ["orientation", "tool_discipline", "execute"]);
    fake.session.calls.length = 0;

    await fake.invokeAgentSettled({});

    expect(fake.session.newSessionCalls()).toHaveLength(1);
    const kickoff = fake.session.newSessionCalls()[0]?.kickoff ?? "";
    expect(kickoff).toContain("VERIFY");
  });
});

describe("U9 ATDD — S12: terminal-stage completion does NOT invoke newSession", () => {
  it("does NOT call newSession when currentStage is the actual last stage (REPORT)", async () => {
    const fake = await loadExtension();
    seed(fake, "report", ["orientation", "tool_discipline", "execute", "verify"]);
    fake.session.calls.length = 0;

    await fake.invokeAgentSettled({});

    expect(fake.session.newSessionCalls()).toHaveLength(0);
    expect(fake.session.sendUserMessageCalls()).toHaveLength(0);
    expect(fake.session.waitForIdleCalls()).toHaveLength(0);
  });

  it("does NOT call newSession when agent_settled fires on a session that never took over", async () => {
    const fake = await loadExtension();
    fake.session.calls.length = 0;
    await fake.invokeAgentSettled({});
    expect(fake.session.newSessionCalls()).toHaveLength(0);
  });
});

describe("U9 ATDD — no overlap with U8 first-turn surface", () => {
  it("extension's `before_agent_start` is registered alongside agent_settled", async () => {
    const fake = await loadExtension();
    expect(fake.hasHandler("before_agent_start")).toBe(true);
    expect(fake.hasHandler("context")).toBe(true);
    expect(fake.hasHandler("agent_settled")).toBe(true);
    expect(fake.registeredTools().some((t) => t.name === "ralph_stage_done")).toBe(true);
  });
});

describe("U9 ATDD — end-to-end through tool execute", () => {
  it("a stage_done tool call returns the tool-side result without invoking the session port", async () => {
    const fake = await loadExtension();
    seed(fake, "orientation", []);

    await driveStageDone(fake, {
      tool_call_id: "tc-orientation-1",
      name: "ralph_stage_done",
      args: { stage: "orientation" },
    });

    // Tool execution must NOT have called any session port. Only the
    // agent_settled hook is the one allowed to do that.
    expect(fake.session.calls).toHaveLength(0);
  });
});
