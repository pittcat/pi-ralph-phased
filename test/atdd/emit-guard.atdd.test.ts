// U6 acceptance (locked by tests):
//   * shouldBlockTerminalEmit is the only public seam of src/emit-guard.ts.
//   * Policy (see test/unit/emit-guard.test.ts header):
//       - last stage              -> always allow
//       - empty publishTopics     -> never block (no guess)
//       - non-last + non-empty    -> block iff shell command actually invokes
//         `ralph emit <topic>` and topic ∈ publishTopics.
//   * Decision shape:
//       { block: boolean; reason?: string }
//       reason present iff block=true; must mention topic + non-terminal
//       stage constraint.
//   * Function must be PURE — no IO, no globals, no state mutation, no
//     reliance on parse/detect/persist modules.
import { describe, expect, it } from "vitest";

import { shouldBlockTerminalEmit } from "../../src/emit-guard.js";

describe("Ralph emit guard acceptance", () => {
  it("S13 — blocks terminal emit before the actual last stage when topic is declared", () => {
    const decision = shouldBlockTerminalEmit({
      stageIsLast: false,
      command: "ralph emit work.done --payload 'ok'",
      publishTopics: ["work.done"],
    });
    expect(decision.block).toBe(true);
    expect(decision.reason).toBeTruthy();
    expect(decision.reason).toMatch(/work\.done/);
  });

  it("S13 — blocks the $RALPH_BIN variant before the actual last stage", () => {
    const decision = shouldBlockTerminalEmit({
      stageIsLast: false,
      command: "$RALPH_BIN emit work.done",
      publishTopics: ["work.done"],
    });
    expect(decision.block).toBe(true);
    expect(decision.reason).toMatch(/work\.done/);
  });

  it("S14 — does not block the actual last stage even with the same command", () => {
    const lastStageDecision = shouldBlockTerminalEmit({
      stageIsLast: true,
      command: "ralph emit work.done",
      publishTopics: ["work.done"],
    });
    expect(lastStageDecision.block).toBe(false);

    // The same command under the non-last path is still blocked — the
    // decision must depend on stageIsLast, not on the command alone.
    const nonLastDecision = shouldBlockTerminalEmit({
      stageIsLast: false,
      command: "ralph emit work.done",
      publishTopics: ["work.done"],
    });
    expect(nonLastDecision.block).toBe(true);
  });

  it("S14 — last stage allows terminal emit even when topics is empty", () => {
    const decision = shouldBlockTerminalEmit({
      stageIsLast: true,
      command: "ralph emit anything",
      publishTopics: [],
    });
    expect(decision.block).toBe(false);
  });

  it("does not block on the non-last path when topics is empty (no guess)", () => {
    const decision = shouldBlockTerminalEmit({
      stageIsLast: false,
      command: "ralph emit work.done",
      publishTopics: [],
    });
    expect(decision.block).toBe(false);
  });

  it("does not block when the topic is not in the declared publishTopics list", () => {
    const decision = shouldBlockTerminalEmit({
      stageIsLast: false,
      command: "ralph emit something.else",
      publishTopics: ["work.done"],
    });
    expect(decision.block).toBe(false);
  });

  it("ignores plain text mentioning ralph emit (echo / JSON / comment)", () => {
    const variants = [
      "echo 'ralph emit work.done'",
      `printf '{"cmd":"ralph emit work.done"}'`,
      "# ralph emit work.done",
    ];
    for (const command of variants) {
      const decision = shouldBlockTerminalEmit({
        stageIsLast: false,
        command,
        publishTopics: ["work.done"],
      });
      expect(decision.block, `command: ${command}`).toBe(false);
    }
  });
});