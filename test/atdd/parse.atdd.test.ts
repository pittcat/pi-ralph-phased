import { describe, expect, it } from "vitest";

import { parseRalphPrompt } from "../../src/parse.js";

const standard = `You are Ralph, the autonomous implementation hat.
### 0. ORIENTATION
Read the task.
### 0b. TOOL DISCIPLINE
Use bounded commands.
### 1. EXECUTE
Implement.
<ralph-tools-skill>Deferred rule.</ralph-tools-skill>
### 2. VERIFY
Verify.
### 3. REPORT
You publish to: work.done`;

describe("Ralph dump parsing acceptance", () => {
  it("parses the complete fixture contract", () => {
    const parsed = parseRalphPrompt(standard);
    expect(parsed?.stages).toHaveLength(5);
    expect(parsed?.deferredSkills).toHaveLength(1);
    expect(parsed?.publishTopics).toEqual(["work.done"]);
  });

  it("preserves an orientation/report-only stage queue", () => {
    const parsed = parseRalphPrompt("### 0. ORIENTATION\nOrient.\n### 3. REPORT\nReport.");
    expect(parsed?.stages.map((stage) => stage.id)).toEqual(["orientation", "report"]);
  });
});
