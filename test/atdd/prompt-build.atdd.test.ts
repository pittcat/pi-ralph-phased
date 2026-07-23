import { describe, expect, it } from "vitest";

import { buildStageUserMessage } from "../../src/prompt-build.js";
import { parseRalphPrompt } from "../../src/parse.js";
import type { ParsedRalphPrompt } from "../../src/types.js";

/**
 * ATDD acceptance for U3 — short stage prompt build.
 *
 * Scenarios S6 and S7 from the plan: each stage's visible user text must
 * satisfy the short contract while ORIENTATION must NOT leak EXECUTE or
 * deferred skill XML, and EXECUTE must inline deferred skills.
 */

const FULL_PROMPT_PATH = "/tmp/ralph-phased/abc123-original.md";
const HANDOFF_BRIEF = "Hand-off context from the previous stage.";

function loadParsed(): ParsedRalphPrompt {
  const result = parseRalphPrompt(`You are Ralph, the autonomous implementation hat.

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
`);
  if (!result) throw new Error("ATDD fixture must parse");
  return result;
}

describe("S6 — first-turn visible text does NOT include full EXECUTE body", () => {
  it("ORIENTATION message excludes the EXECUTE body", () => {
    const result = loadParsed();
    const message = buildStageUserMessage(result, "orientation", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).not.toContain("Execute stage body marker.");
  });

  it("ORIENTATION message includes the absolute full-prompt path for read", () => {
    const result = loadParsed();
    const message = buildStageUserMessage(result, "orientation", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).toContain(FULL_PROMPT_PATH);
  });

  it("ORIENTATION message includes a short contract with stage identity and the stage_done instruction", () => {
    const result = loadParsed();
    const message = buildStageUserMessage(result, "orientation", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).toContain("ORIENTATION");
    expect(message).toContain("ralph_stage_done");
  });
});

describe("S7 — ORIENTATION must NOT include deferred skill XML; EXECUTE inline policy", () => {
  it("ORIENTATION does NOT include the deferred skill XML", () => {
    const result = loadParsed();
    const message = buildStageUserMessage(result, "orientation", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).not.toContain("<ralph-tools-skill");
    expect(message).not.toContain("Deferred skill XML body marker.");
  });

  it("EXECUTE DOES include the deferred skill XML inline (U3 policy lock)", () => {
    const result = loadParsed();
    const message = buildStageUserMessage(result, "execute", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).toContain("<ralph-tools-skill");
    expect(message).toContain("Deferred skill XML body marker.");
  });
});

describe("U3 — short contract always present", () => {
  it.each([
    "orientation",
    "tool_discipline",
    "execute",
    "verify",
    "report",
  ] as const)("stage '%s' message carries stage name, full prompt path, and ralph_stage_done instruction", (stageId) => {
    const result = loadParsed();
    if (!result.stages.some((s) => s.id === stageId)) return;
    const message = buildStageUserMessage(result, stageId, { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).toContain(FULL_PROMPT_PATH);
    expect(message).toContain("ralph_stage_done");
    expect(message.toLowerCase()).toContain(stageId.replace(/_/g, " "));
  });
});

describe("U3 — handoff brief", () => {
  it("the handoff brief is included verbatim when provided", () => {
    const result = loadParsed();
    const message = buildStageUserMessage(result, "execute", {
      fullPromptPath: FULL_PROMPT_PATH,
      handoffBrief: HANDOFF_BRIEF,
    });
    expect(message).toContain(HANDOFF_BRIEF);
  });
});

describe("U3 — non-last stages carry the no-terminal-emit reminder", () => {
  it("non-terminal stages mention the no-terminal-emit reminder", () => {
    const result = loadParsed();
    const message = buildStageUserMessage(result, "execute", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message.toLowerCase()).toContain("emit");
    expect(message.toLowerCase()).toMatch(/do not|don't|forbid|prohibit|never/);
  });

  it("the actual last stage (REPORT) does NOT carry the no-terminal-emit wording", () => {
    const result = loadParsed();
    const lastId = result.stages[result.stages.length - 1]?.id;
    expect(lastId).toBe("report");
    const message = buildStageUserMessage(result, lastId!, { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).not.toMatch(/do not emit|don't emit|forbid.*emit|prohibit.*emit|never emit/i);
  });
});