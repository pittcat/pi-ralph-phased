import { describe, expect, it } from "vitest";

import { FakeExtensionAPI } from "../fakes/fake-pi.js";
import piRalphPhased from "../../src/index.js";
import { parseRalphPrompt } from "../../src/parse.js";
import { createSessionState } from "../../src/session-state.js";
import type { RalphSessionState, StageId } from "../../src/types.js";

/**
 * U10 ATDD — tool_call early-emit guard end-to-end (Fake).
 *
 * Scenarios covered:
 *   S13 — the extension's tool_call handler returns `{ block: true, reason }`
 *         when the active stage is non-last and a bash tool attempts
 *         `ralph emit <declared-topic>`.
 *   S14 — the extension's tool_call handler returns `undefined` (pass-through)
 *         when the active stage is the actual last stage for the same command.
 *   S2  — kill-switch path: when `store.active` is `undefined` (e.g.
 *         `RALPH_PI_PHASED=0` prevented `before_agent_start` from populating
 *         the store, OR when the prompt was a short non-Ralph dump),
 *         the tool_call handler MUST return `undefined` for any bash command.
 *
 * Why the Fake already exposes a seedable `store`:
 *   U9 established `fake.store.active` and the `ctx.store?.active` fallback so
 *   ATDDs can drive the extension's existing handlers (`agent_settled`)
 *   without going through `before_agent_start`. We reuse that for U10 so the
 *   tool_call hook can be exercised against a real seeded session without
 *   writing temp files the U8 first-turn ATDD enumerates.
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

publishes:
- work.done
`;

const FULL_PROMPT_PATH = "/tmp/pi-ralph-phased-test/abcdef/original.md";

function parsedRalph(): NonNullable<ReturnType<typeof parseRalphPrompt>> {
  const parsed = parseRalphPrompt(STANDARD_RALPH);
  if (!parsed) throw new Error("ATDD fixture must parse");
  return parsed;
}

async function loadExtension(): Promise<FakeExtensionAPI> {
  const fake = new FakeExtensionAPI();
  await piRalphPhased(fake as unknown as Parameters<typeof piRalphPhased>[0]);
  return fake;
}

/**
 * Seed `fake.store` directly so we can drive tool_call without invoking
 * `before_agent_start`. The seeded state has `currentStage` and an explicit
 * `completedStages` set so the wiring can derive `stageIsLast`.
 */
function seed(
  fake: FakeExtensionAPI,
  currentStage: StageId,
  completed: ReadonlyArray<StageId> = [],
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

describe("U10 ATDD — S13: tool_call blocks terminal emit before the actual last stage", () => {
  it("registers a tool_call handler on extension load", async () => {
    const fake = await loadExtension();
    expect(fake.hasHandler("tool_call")).toBe(true);
  });

  it("returns { block: true, reason } when bash command invokes `ralph emit work.done` on EXECUTE", async () => {
    const fake = await loadExtension();
    seed(fake, "execute");

    const decision = (await fake.invokeToolCall({
      toolName: "bash",
      args: { command: "ralph emit work.done --payload 'ok'" },
    })) as { block: true; reason: string } | undefined;

    expect(decision).toBeDefined();
    expect(decision!.block).toBe(true);
    expect(decision!.reason).toBeTruthy();
    expect(decision!.reason).toMatch(/work\.done/);
  });

  it("$RALPH_BIN form is also blocked on EXECUTE", async () => {
    const fake = await loadExtension();
    seed(fake, "execute");

    const decision = (await fake.invokeToolCall({
      toolName: "bash",
      args: { command: "$RALPH_BIN emit work.done" },
    })) as { block: true; reason: string } | undefined;

    expect(decision?.block).toBe(true);
    expect(decision?.reason).toMatch(/work\.done/);
  });

  it("blocking does NOT mark the current stage as complete (S13 explicit)", async () => {
    const fake = await loadExtension();
    seed(fake, "execute");

    // Capture the seeded state's completed-set size BEFORE the tool_call.
    // We assert through the same path U8/U9 use to observe state.
    const before = fake.store.active;
    expect(before).toBeDefined();
    const beforeCompleted = (before!.completedStages as Set<StageId>).size;

    await fake.invokeToolCall({
      toolName: "bash",
      args: { command: "ralph emit work.done" },
    });

    const after = fake.store.active;
    expect(after).toBeDefined();
    // S13: blocking the call MUST NOT have grown the completed-set.
    expect((after!.completedStages as Set<StageId>).size).toBe(beforeCompleted);
    // S13: the current stage remains EXECUTE (no implicit completion).
    expect(after!.currentStage).toBe("execute");
  });
});

describe("U10 ATDD — S14: tool_call passes through on the actual last stage", () => {
  it("returns undefined when currentStage is REPORT for the same command", async () => {
    const fake = await loadExtension();
    seed(fake, "report", ["orientation", "tool_discipline", "execute", "verify"]);

    const decision = await fake.invokeToolCall({
      toolName: "bash",
      args: { command: "ralph emit work.done" },
    });

    expect(decision).toBeUndefined();
  });

  it("returns undefined when currentStage is REPORT regardless of command shape", async () => {
    const fake = await loadExtension();
    seed(fake, "report", ["orientation", "tool_discipline", "execute", "verify"]);

    // Even an arbitrary command is pass-through on the last stage.
    const decision = await fake.invokeToolCall({
      toolName: "bash",
      args: { command: "echo 'not a real publish'" },
    });
    expect(decision).toBeUndefined();
  });
});

describe("U10 ATDD — S2: kill switch (store.active undefined) → pass-through", () => {
  it("returns undefined when no active session exists (RALPH_PI_PHASED=0 covered here)", async () => {
    const fake = await loadExtension();
    // No seed: store.active stays undefined. This is the path that the
    // kill switch forces by preventing before_agent_start from populating
    // the store.
    const decision = await fake.invokeToolCall({
      toolName: "bash",
      args: { command: "ralph emit work.done" },
    });
    expect(decision).toBeUndefined();
  });

  it("non-bash tools pass through regardless of session", async () => {
    const fake = await loadExtension();
    seed(fake, "execute");

    const decision = await fake.invokeToolCall({
      toolName: "read",
      args: { path: "/etc/passwd" },
    });
    expect(decision).toBeUndefined();
  });

  it("bash tool without `command` or `cmd` field passes through", async () => {
    const fake = await loadExtension();
    seed(fake, "execute");

    const decision = await fake.invokeToolCall({
      toolName: "bash",
      args: { stdout_path: "/tmp/x" },
    });
    expect(decision).toBeUndefined();
  });

  it("bash tool whose topic is not in publishTopics passes through", async () => {
    const fake = await loadExtension();
    seed(fake, "execute");

    const decision = await fake.invokeToolCall({
      toolName: "bash",
      args: { command: "ralph emit something.else" },
    });
    expect(decision).toBeUndefined();
  });
});

describe("U10 ATDD — Fake tool_call surface shape", () => {
  it("invokeToolCall returns undefined when no handler is registered", async () => {
    const fake = new FakeExtensionAPI();
    const result = await fake.invokeToolCall({
      toolName: "bash",
      args: { command: "echo hi" },
    });
    expect(result).toBeUndefined();
  });

  it("invokeToolCall does not throw even with an undefined event", async () => {
    const fake = await loadExtension();
    const result = await fake.invokeToolCall(undefined);
    expect(result).toBeUndefined();
  });
});
