// U6 policy (locked by tests):
//   * stageIsLast === true  -> always { block: false }. The actual final stage
//     must be free to emit terminal events.
//   * publishTopics empty    -> never block on the non-last path; the policy
//     prefers false negatives when the operator did not declare topics.
//   * non-last + non-empty publishTopics -> block ONLY when the shell command
//     actually invokes `ralph emit <topic>` (or `$RALPH_BIN emit <topic>` or
//     an executable path whose basename is `ralph` followed by `emit`) AND
//     the literal token at the emit position is one of publishTopics.
//   * When blocked, the reason must mention the offending topic and the
//     non-terminal-stage constraint so downstream callers can surface it.
//
// Heuristic limits explicitly accepted:
//   - A bounded shell tokenizer: we do not parse quoted shell strings with
//     full fidelity. The tests below lock the variants we care about
//     (single/double quotes, env assignment, executable absolute path,
//     multi-topic lists, command chains).
//   - Plain text mentioning `ralph emit` inside JSON / comments / echo
//     arguments does NOT count as an emit invocation.
import { describe, expect, it } from "vitest";

import { shouldBlockTerminalEmit } from "../../src/emit-guard.js";

describe("shouldBlockTerminalEmit — last-stage allow", () => {
  it("allows terminal emit on the actual last stage regardless of topics", () => {
    const decision = shouldBlockTerminalEmit({
      stageIsLast: true,
      command: "ralph emit work.done",
      publishTopics: ["work.done"],
    });
    expect(decision.block).toBe(false);
    expect(decision.reason).toBeUndefined();
  });

  it("allows arbitrary commands on the actual last stage even if they mention ralph emit", () => {
    const decision = shouldBlockTerminalEmit({
      stageIsLast: true,
      command: "echo ralph emit work.done",
      publishTopics: ["work.done"],
    });
    expect(decision.block).toBe(false);
  });
});

describe("shouldBlockTerminalEmit — empty publish topics", () => {
  it("does not block when publishTopics is empty (no guess, no false positive)", () => {
    const decision = shouldBlockTerminalEmit({
      stageIsLast: false,
      command: "ralph emit work.done",
      publishTopics: [],
    });
    expect(decision.block).toBe(false);
  });

  it("does not block when publishTopics is empty even with $RALPH_BIN emit", () => {
    const decision = shouldBlockTerminalEmit({
      stageIsLast: false,
      command: "$RALPH_BIN emit work.done",
      publishTopics: [],
    });
    expect(decision.block).toBe(false);
  });
});

describe("shouldBlockTerminalEmit — non-last stage positive matrix", () => {
  it.each([
    {
      name: "blocks `ralph emit work.done` when work.done is in topics",
      command: "ralph emit work.done",
      publishTopics: ["work.done"],
    },
    {
      name: "blocks `$RALPH_BIN emit work.done` form",
      command: "$RALPH_BIN emit work.done",
      publishTopics: ["work.done"],
    },
    {
      name: "blocks executable-absolute-path form `/usr/local/bin/ralph emit work.done`",
      command: "/usr/local/bin/ralph emit work.done",
      publishTopics: ["work.done"],
    },
    {
      name: "blocks single-quoted topic",
      command: `ralph emit 'work.done'`,
      publishTopics: ["work.done"],
    },
    {
      name: "blocks double-quoted topic",
      command: `ralph emit "work.done"`,
      publishTopics: ["work.done"],
    },
    {
      name: "blocks with a leading env assignment before ralph emit",
      command: "FOO=bar ralph emit work.done --payload X",
      publishTopics: ["work.done"],
    },
    {
      name: "blocks when emit appears inside a chained command (after &&)",
      command: "echo step1 && ralph emit work.done",
      publishTopics: ["work.done"],
    },
    {
      name: "blocks when emit appears inside a chained command (after ;)",
      command: "echo step1; ralph emit work.done",
      publishTopics: ["work.done"],
    },
    {
      name: "blocks when emit appears inside a piped chain",
      command: "echo step1 | ralph emit work.done",
      publishTopics: ["work.done"],
    },
    {
      name: "blocks against any one of multiple publishTopics",
      command: "ralph emit work.done",
      publishTopics: ["foo", "work.done", "bar"],
    },
    {
      name: "blocks the alternative topic from a multi-topic list",
      command: "ralph emit foo.bar",
      publishTopics: ["foo.bar", "work.done"],
    },
  ])("$name", ({ command, publishTopics }) => {
    const decision = shouldBlockTerminalEmit({
      stageIsLast: false,
      command,
      publishTopics,
    });
    expect(decision.block).toBe(true);
    expect(typeof decision.reason).toBe("string");
    expect(decision.reason).toBeTruthy();
    // The reason must mention the offending topic so the model can act on it.
    expect(decision.reason).toMatch(/work\.done|foo\.bar/);
    // The reason must mention the non-terminal-stage constraint.
    expect(decision.reason).toMatch(/non-(?:final|terminal|last)|not\s+(?:the\s+)?(?:final|last)|terminal/i);
  });
});

describe("shouldBlockTerminalEmit — non-last stage negative matrix (allow)", () => {
  it.each([
    {
      name: "topic not in publishTopics is allowed even if it looks terminal",
      command: "ralph emit other.thing",
      publishTopics: ["work.done"],
    },
    {
      name: "echo argument that merely mentions ralph emit is allowed",
      command: "echo 'ralph emit work.done'",
      publishTopics: ["work.done"],
    },
    {
      name: "JSON literal containing ralph emit is allowed",
      command: `printf '{"cmd":"ralph emit work.done"}'`,
      publishTopics: ["work.done"],
    },
    {
      name: "shell comment that mentions ralph emit is allowed",
      command: "# remember to run ralph emit work.done later",
      publishTopics: ["work.done"],
    },
    {
      name: "`ralph events` (not emit) is allowed",
      command: "ralph events list",
      publishTopics: ["work.done"],
    },
    {
      name: "plain non-ralph commands are allowed",
      command: "ls -la",
      publishTopics: ["work.done"],
    },
    {
      name: "command without emit verb is allowed even if topic matches text",
      command: "echo work.done",
      publishTopics: ["work.done"],
    },
    {
      name: "ralph with a different subcommand is allowed",
      command: "ralph status",
      publishTopics: ["work.done"],
    },
  ])("$name", ({ command, publishTopics }) => {
    const decision = shouldBlockTerminalEmit({
      stageIsLast: false,
      command,
      publishTopics,
    });
    expect(decision.block).toBe(false);
    expect(decision.reason).toBeUndefined();
  });
});

describe("shouldBlockTerminalEmit — input shape", () => {
  it("returns block=false for empty command strings", () => {
    const decision = shouldBlockTerminalEmit({
      stageIsLast: false,
      command: "",
      publishTopics: ["work.done"],
    });
    expect(decision.block).toBe(false);
  });

  it("does not mutate the publishTopics array (readonly contract)", () => {
    const topics = ["work.done"];
    const snapshot = [...topics];
    shouldBlockTerminalEmit({
      stageIsLast: false,
      command: "ralph emit work.done",
      publishTopics: topics,
    });
    expect(topics).toEqual(snapshot);
  });
});