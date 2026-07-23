import { describe, expect, it } from "vitest";

import { parseRalphPrompt } from "../../src/parse.js";
import type { StageId } from "../../src/types.js";

const fixture = `You are Ralph, the autonomous implementation hat.

### 0. ORIENTATION
Read the task.

### 0b. TOOL DISCIPLINE
Use bounded commands.

### 1. EXECUTE
Implement it.
<ralph-tools-skill id="delivery">Use ralph emit work.done.</ralph-tools-skill>

### 2. VERIFY
Run checks.

### 3. REPORT
publishes: work.done, delivery.report
`;

describe("parseRalphPrompt", () => {
  it("parses standard stages in source order and removes deferred XML", () => {
    const parsed = parseRalphPrompt(fixture);
    expect(parsed).not.toBeNull();
    expect(parsed?.stages.map(({ id }) => id)).toEqual([
      "orientation", "tool_discipline", "execute", "verify", "report",
    ] satisfies StageId[]);
    expect(parsed?.preamble).toContain("You are Ralph");
    expect(parsed?.deferredSkills).toEqual([{
      name: "ralph-tools-skill",
      source: '<ralph-tools-skill id="delivery">Use ralph emit work.done.</ralph-tools-skill>',
    }]);
    expect(parsed?.stages.every(({ body }) => !body.includes("<ralph-tools-skill"))).toBe(true);
  });

  it("keeps only the stages present when sections are missing", () => {
    const parsed = parseRalphPrompt("### 0. ORIENTATION\nOrient.\n### 3. REPORT\nReport.");
    expect(parsed?.stages.map(({ id }) => id)).toEqual(["orientation", "report"]);
  });

  it("returns null with fewer than two known stages", () => {
    expect(parseRalphPrompt("### 1. EXECUTE\nOnly one.")).toBeNull();
  });

  it.each([
    ["###  orientation  ", "orientation"],
    ["### 0B. tool_discipline", "tool_discipline"],
    ["### 1 . execute", "execute"],
    ["### 2. VERIFY", "verify"],
    ["### 3. report", "report"],
  ] as const)("recognizes heading variant %s", (heading, id) => {
    const parsed = parseRalphPrompt(`${heading}\nBody\n### 3. REPORT\nReport.`);
    expect(parsed?.stages.some((stage) => stage.id === id)).toBe(true);
  });

  it("extracts skill XML variants and topics best-effort", () => {
    const parsed = parseRalphPrompt(`### 0. ORIENTATION\nA\n### 1. EXECUTE\nB\n<ralph-tools-alpha-skill x="1">Alpha</ralph-tools-alpha-skill>\n<ralph-tools-skill>Core</ralph-tools-skill>\n### 3. REPORT\nYou publish to: work.done\nPublishes: work.done, report.done`);
    expect(parsed?.deferredSkills.map(({ name }) => name)).toEqual([
      "ralph-tools-alpha-skill", "ralph-tools-skill",
    ]);
    // publishTopics is deliberately best-effort: explicit declarations only, de-duplicated.
    expect(parsed?.publishTopics).toEqual(["work.done", "report.done"]);
  });

  it("returns empty topics when no explicit declaration exists", () => {
    const parsed = parseRalphPrompt("### 0. ORIENTATION\nA\n### 1. EXECUTE\nB");
    expect(parsed?.publishTopics).toEqual([]);
  });
});
