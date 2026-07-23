// U10 wiring acceptance (locked by tests):
//   * Pure handler derives `{ stageIsLast, command, publishTopics }` from
//     session state and the fake tool_call event, then forwards to
//     `shouldBlockTerminalEmit`.
//   * Returns `{ block: true, reason }` when policy decides to block;
//     returns `undefined` when policy decides to allow.
//   * Never marks the current stage as complete.
//   * When `store.active === undefined` the handler returns `undefined`
//     (pass-through) — this covers `RALPH_PI_PHASED=0` because the kill
//     switch prevents `before_agent_start` from ever populating the store.
//   * Non-bash tools fall through with no decision.
//   * Bash tools whose args use `cmd` (instead of `command`) are still
//     recognized so we cover Pi tool-name variants.
import { describe, expect, it } from "vitest";

import { shouldBlockTerminalEmit } from "../../src/emit-guard.js";
import {
  resolveToolCallGuard,
  extractCommand,
  type ToolCallGuardPort,
  type ToolCallGuardCommand,
} from "../../src/tool-call-guard.js";
import { createSessionState } from "../../src/session-state.js";
import { parseRalphPrompt } from "../../src/parse.js";
import type { RalphSessionState, StageId } from "../../src/types.js";

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
- ship.verified
`;

interface ToolCallEventLike {
  toolName: string;
  args: Record<string, unknown>;
}

function buildState(currentStage: StageId): RalphSessionState {
  const parsed = parseRalphPrompt(STANDARD_RALPH);
  if (!parsed) throw new Error("fixture must parse");
  return createSessionState({
    originalPrompt: STANDARD_RALPH,
    fullPromptPath: "/tmp/x.md",
    parsed,
    stageIds: parsed.stages.map((s) => s.id) as StageId[],
    currentStage,
  });
}

describe("resolveToolCallGuard — no active session (kill-switch path)", () => {
  it("returns undefined when port reports no active state (RALPH_PI_PHASED=0 covered here)", () => {
    const port: ToolCallGuardPort = {
      activeState: () => undefined,
      markStageDone: () => {
        throw new Error("markStageDone must NOT be called on pass-through");
      },
    };

    const event: ToolCallEventLike = {
      toolName: "bash",
      args: { command: "ralph emit work.done" },
    };

    const decision = resolveToolCallGuard(event, port);
    expect(decision).toBeUndefined();
  });
});

describe("resolveToolCallGuard — non-bash tools always allowed", () => {
  it("returns undefined for toolName=read", () => {
    const port: ToolCallGuardPort = {
      activeState: () => buildState("orientation"),
      markStageDone: () => {
        throw new Error("markStageDone must NOT be called for non-bash tools");
      },
    };
    const decision = resolveToolCallGuard(
      { toolName: "read", args: { path: "/etc/passwd" } },
      port,
    );
    expect(decision).toBeUndefined();
  });

  it("returns undefined for toolName=edit (also emits write but not bash)", () => {
    const port: ToolCallGuardPort = {
      activeState: () => buildState("execute"),
      markStageDone: () => {
        throw new Error("markStageDone must NOT be called for edit");
      },
    };
    const decision = resolveToolCallGuard(
      { toolName: "edit", args: { path: "foo.ts", newText: "x" } },
      port,
    );
    expect(decision).toBeUndefined();
  });
});

describe("resolveToolCallGuard — bash on non-last stage blocks terminal emit", () => {
  it("returns { block: true, reason } for `bash` with command=ralph emit work.done", () => {
    const port: ToolCallGuardPort = {
      activeState: () => buildState("execute"),
      markStageDone: () => {
        throw new Error("markStageDone must NOT be called when blocking");
      },
    };

    const decision = resolveToolCallGuard(
      {
        toolName: "bash",
        args: { command: "ralph emit work.done --payload x" },
      },
      port,
    );

    expect(decision?.block).toBe(true);
    expect(decision?.reason).toBeTruthy();
    expect(decision?.reason).toMatch(/work\.done/);
  });

  it("returns undefined on the actual last stage (REPORT) for the same command", () => {
    const port: ToolCallGuardPort = {
      activeState: () => buildState("report"),
      markStageDone: () => {
        throw new Error("markStageDone must NOT be called on pass-through");
      },
    };

    const decision = resolveToolCallGuard(
      {
        toolName: "bash",
        args: { command: "ralph emit work.done" },
      },
      port,
    );

    expect(decision).toBeUndefined();
  });

  it("returns undefined when the topic is not in publishTopics (false-negative policy)", () => {
    const port: ToolCallGuardPort = {
      activeState: () => buildState("execute"),
      markStageDone: () => {
        throw new Error("markStageDone must NOT be called on pass-through");
      },
    };

    const decision = resolveToolCallGuard(
      {
        toolName: "bash",
        args: { command: "ralph emit something.else" },
      },
      port,
    );

    expect(decision).toBeUndefined();
  });
});

describe("resolveToolCallGuard — derived stageIsLast mirrors parsed.stages last element", () => {
  it("does not block when currentStage is REPORT regardless of command shape", () => {
    const port: ToolCallGuardPort = {
      activeState: () => buildState("report"),
      markStageDone: () => {},
    };
    const decision = resolveToolCallGuard(
      { toolName: "bash", args: { command: "echo hello" } },
      port,
    );
    expect(decision).toBeUndefined();
  });

  it("blocks when currentStage is EXECUTE and bash command invokes ralph emit work.done", () => {
    const port: ToolCallGuardPort = {
      activeState: () => buildState("execute"),
      markStageDone: () => {},
    };
    const decision = resolveToolCallGuard(
      { toolName: "bash", args: { command: "ralph emit work.done" } },
      port,
    );
    expect(decision?.block).toBe(true);
  });
});

describe("resolveToolCallGuard — does NOT mark stage done on block", () => {
  it("never invokes port.markStageDone regardless of decision", () => {
    let marked = false;
    const port: ToolCallGuardPort = {
      activeState: () => buildState("execute"),
      markStageDone: () => {
        marked = true;
      },
    };

    resolveToolCallGuard(
      { toolName: "bash", args: { command: "ralph emit work.done" } },
      port,
    );

    expect(marked).toBe(false);
  });
});

describe("resolveToolCallGuard — command field variants", () => {
  it("recognizes `cmd` field as an alias for bash-issued tools", () => {
    const port: ToolCallGuardPort = {
      activeState: () => buildState("execute"),
      markStageDone: () => {},
    };

    const decision = resolveToolCallGuard(
      { toolName: "bash", args: { cmd: "ralph emit work.done" } },
      port,
    );
    expect(decision?.block).toBe(true);
  });

  it("returns undefined for bash tools whose args have no command or cmd field", () => {
    const port: ToolCallGuardPort = {
      activeState: () => buildState("execute"),
      markStageDone: () => {},
    };

    const decision = resolveToolCallGuard(
      { toolName: "bash", args: { stdout_path: "/tmp/x" } },
      port,
    );
    expect(decision).toBeUndefined();
  });
});

describe("resolveToolCallGuard — does not mutate input state", () => {
  it("reads publishTopics from the active state without mutating it", () => {
    const topics: readonly string[] = ["work.done"];
    const state: RalphSessionState = Object.assign(buildState("execute"), {
      parsed: { ...buildState("execute").parsed, publishTopics: [...topics] },
    });
    const port: ToolCallGuardPort = {
      activeState: () => state,
      markStageDone: () => {},
    };
    const before = [...state.parsed.publishTopics];
    resolveToolCallGuard(
      { toolName: "bash", args: { command: "ralph emit work.done" } },
      port,
    );
    expect(state.parsed.publishTopics).toEqual(before);
  });
});

// Sanity: this is the unit seam — we pin it so future refactors don't
// accidentally delete the responsibility we wired up in U10.
// Re-assert the helper contract from the production module — keeps the
// unit test honest about how the seam is supposed to extract commands.
describe("extractCommand — helper contract", () => {
  it("reads `command` first then `cmd` then null", () => {
    const cases: ReadonlyArray<{ args: Record<string, unknown>; expected: ToolCallGuardCommand }> = [
      { args: { command: "x" }, expected: { present: true, value: "x" } },
      { args: { cmd: "y" }, expected: { present: true, value: "y" } },
      { args: {}, expected: { present: false } },
    ];
    for (const c of cases) {
      expect(extractCommand(c.args)).toEqual(c.expected);
    }
  });
});

// Re-confirm the policy seam that the wiring delegates to — U6 already locks
// this, but we ensure the wiring uses the exact same function.
describe("resolveToolCallGuard — delegates to shouldBlockTerminalEmit", () => {
  it("policy decision and wiring decision agree on the same input", () => {
    const state = buildState("execute");
    const ports: ToolCallGuardPort = {
      activeState: () => state,
      markStageDone: () => {},
    };
    const policyDecision = shouldBlockTerminalEmit({
      stageIsLast: false,
      command: "ralph emit work.done",
      publishTopics: state.parsed.publishTopics,
    });
    const wireDecision = resolveToolCallGuard(
      { toolName: "bash", args: { command: "ralph emit work.done" } },
      ports,
    );
    expect(wireDecision?.block).toBe(policyDecision.block);
    expect(wireDecision?.reason).toBe(policyDecision.reason);
  });
});
