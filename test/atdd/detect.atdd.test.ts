import { describe, expect, it } from "vitest";

import { shouldTakeover } from "../../src/detect.js";

const standardRalphPrompt = `
You are Ralph, the autonomous implementation hat.

### 0. ORIENTATION
Read the task and constraints.

### 0b. TOOL DISCIPLINE
Use bounded commands.

### 1. EXECUTE
Implement the requested change.

<ralph-tools-skill>
Use ralph emit for the configured topic only after completion.
</ralph-tools-skill>

### 2. VERIFY
Run the required checks.

### 3. REPORT
Report the result.
`;

describe("Ralph dump detection acceptance", () => {
  it("does not take over a short ordinary prompt", () => {
    expect(shouldTakeover("Reply with exactly OK", {})).toBe(false);
  });

  it("honors the kill switch before inspecting a valid Ralph dump", () => {
    expect(shouldTakeover(standardRalphPrompt, { RALPH_PI_PHASED: "0" })).toBe(false);
  });

  it("takes over a standard Ralph dump", () => {
    expect(shouldTakeover(standardRalphPrompt, {})).toBe(true);
  });

  it("does not take over ralph emit text without recognized stage headings", () => {
    const incomplete = "When finished, run ralph emit work.done with the result.";

    expect(shouldTakeover(incomplete, {})).toBe(false);
  });

  it("does not mistake an ordinary numbered document for a Ralph dump", () => {
    const ordinaryDocument = `
You are a helpful writing assistant.

### 1. ORIENTATION
Explain how readers should approach the guide.

### 2. EXECUTE
Show the steps with examples.
`;

    expect(shouldTakeover(ordinaryDocument, {})).toBe(false);
  });
});
