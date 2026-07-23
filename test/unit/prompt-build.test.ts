import { describe, expect, it } from "vitest";

import { buildStageUserMessage } from "../../src/prompt-build.js";
import { parseRalphPrompt } from "../../src/parse.js";
import type { ParsedRalphPrompt, StageId } from "../../src/types.js";

/**
 * Standard fixture mirrors the plan and parse.atdd fixture. The ORIENTATION
 * body, the EXECUTE body, and the deferred skill XML are all distinct so we
 * can assert non-leakage between stages.
 */
const standardRalph = `You are Ralph, the autonomous implementation hat.

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

const FULL_PROMPT_PATH = "/tmp/ralph-phased/abc123-original.md";
const HANDOFF_BRIEF = "Previous stage summary for handoff.";

function parsed(): ParsedRalphPrompt {
  const result = parseRalphPrompt(standardRalph);
  if (!result) throw new Error("test fixture must parse");
  return result;
}

describe("buildStageUserMessage — ORIENTATION", () => {
  it("includes the current stage identity and a single-event budget reminder", () => {
    const message = buildStageUserMessage(parsed(), "orientation", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).toContain("ORIENTATION");
    expect(message.toLowerCase()).toContain("orientation");
  });

  it("reminds the model that one business event budget applies", () => {
    const message = buildStageUserMessage(parsed(), "orientation", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).toMatch(/single.{0,40}business.{0,40}event|business.{0,40}event.{0,40}budget|one.{0,40}business.{0,40}event/i);
  });

  it("exposes the absolute path to the full prompt for read", () => {
    const message = buildStageUserMessage(parsed(), "orientation", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).toContain(FULL_PROMPT_PATH);
  });

  it("instructs the model to call ralph_stage_done on completion", () => {
    const message = buildStageUserMessage(parsed(), "orientation", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).toContain("ralph_stage_done");
  });

  it("includes the ORIENTATION stage body itself", () => {
    const message = buildStageUserMessage(parsed(), "orientation", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).toContain("Orient stage body marker.");
  });

  it("does NOT leak the EXECUTE stage body into ORIENTATION", () => {
    const message = buildStageUserMessage(parsed(), "orientation", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).not.toContain("Execute stage body marker.");
  });

  it("does NOT leak deferred skill XML into ORIENTATION (EXECUTE inline policy)", () => {
    const message = buildStageUserMessage(parsed(), "orientation", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).not.toContain("<ralph-tools-skill");
    expect(message).not.toContain("Deferred skill XML body marker.");
  });

  it("does NOT leak downstream stage bodies into ORIENTATION", () => {
    const message = buildStageUserMessage(parsed(), "orientation", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).not.toContain("Tool discipline stage body marker.");
    expect(message).not.toContain("Verify stage body marker.");
    expect(message).not.toContain("Report stage body marker.");
  });
});

describe("buildStageUserMessage — EXECUTE (inline deferredSkills policy)", () => {
  it("includes the current stage identity", () => {
    const message = buildStageUserMessage(parsed(), "execute", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).toContain("EXECUTE");
    expect(message.toLowerCase()).toContain("execute");
  });

  it("includes the EXECUTE stage body itself", () => {
    const message = buildStageUserMessage(parsed(), "execute", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).toContain("Execute stage body marker.");
  });

  it("includes the absolute path to the full prompt", () => {
    const message = buildStageUserMessage(parsed(), "execute", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).toContain(FULL_PROMPT_PATH);
  });

  it("includes the deferred skill XML inline (U3 policy lock: EXECUTE inlines deferredSkills[].source)", () => {
    const message = buildStageUserMessage(parsed(), "execute", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).toContain("Deferred skill XML body marker.");
    expect(message).toContain("<ralph-tools-skill");
  });

  it("instructs the model to call ralph_stage_done on completion", () => {
    const message = buildStageUserMessage(parsed(), "execute", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).toContain("ralph_stage_done");
  });
});

describe("buildStageUserMessage — terminal-stage emit guard text", () => {
  it("forbids business-terminal emit on non-terminal stages", () => {
    const message = buildStageUserMessage(parsed(), "execute", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message.toLowerCase()).toMatch(/do not|don't|forbid|prohibit|never/);
    expect(message.toLowerCase()).toContain("emit");
  });

  it("does NOT include the 'forbid terminal emit' wording when building the actual last stage", () => {
    const result = parsed();
    const lastStageId = result.stages[result.stages.length - 1]?.id as StageId;
    const message = buildStageUserMessage(result, lastStageId, { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).not.toMatch(/do not emit|don't emit|forbid.*emit|prohibit.*emit|never emit/i);
  });
});

describe("buildStageUserMessage — handoffBrief", () => {
  it("includes the handoff brief when provided", () => {
    const message = buildStageUserMessage(parsed(), "execute", {
      fullPromptPath: FULL_PROMPT_PATH,
      handoffBrief: HANDOFF_BRIEF,
    });
    expect(message).toContain(HANDOFF_BRIEF);
  });

  it("omits the handoff marker when no handoffBrief is provided", () => {
    const message = buildStageUserMessage(parsed(), "execute", { fullPromptPath: FULL_PROMPT_PATH });
    expect(message).not.toContain(HANDOFF_BRIEF);
  });
});

describe("buildStageUserMessage — invalid stageId", () => {
  it("throws when the requested stageId does not exist in the parsed queue", () => {
    const result = parsed();
    // Remove the EXECUTE stage from a copy so it is a known-id-but-missing stage.
    const trimmed: ParsedRalphPrompt = {
      ...result,
      stages: result.stages.filter((s) => s.id !== "execute"),
    };
    expect(() => buildStageUserMessage(trimmed, "execute", { fullPromptPath: FULL_PROMPT_PATH })).toThrow();
  });

  it("does not throw when the requested stageId exists in the parsed queue", () => {
    expect(() =>
      buildStageUserMessage(parsed(), "orientation", { fullPromptPath: FULL_PROMPT_PATH }),
    ).not.toThrow();
  });
});