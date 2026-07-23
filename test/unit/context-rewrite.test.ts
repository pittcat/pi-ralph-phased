import { describe, expect, it } from "vitest";

import { rewriteContextMessages } from "../../src/context-rewrite.js";
import { parseRalphPrompt } from "../../src/parse.js";
import { createSessionState } from "../../src/session-state.js";
import type { RalphSessionState, StageId } from "../../src/types.js";

/**
 * U8 — context-rewrite unit tests.
 *
 * The seam must rewrite the FIRST user message in-place (text-only) when a
 * session state is provided. Pass-through (no state) must yield deep-equal
 * messages. Do NOT mutate the input array.
 *
 * The fixture mirrors test/atdd/extension-first-turn.atdd.test.ts so the ATDD
 * gate and this unit stay locked to the same identifiers.
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

const FULL_PROMPT_PATH = "/tmp/ralph-phased/abc123-original.md";

function loadParsed() {
  const parsed = parseRalphPrompt(STANDARD_RALPH);
  if (!parsed) throw new Error("test fixture must parse");
  return parsed;
}

function loadState(stageId: StageId = "orientation"): RalphSessionState {
  return createSessionState({
    originalPrompt: STANDARD_RALPH,
    fullPromptPath: FULL_PROMPT_PATH,
    parsed: loadParsed(),
    stageIds: ["orientation", "tool_discipline", "execute", "verify", "report"],
    currentStage: stageId,
  });
}

interface FakeUserTextPart {
  type: "text";
  text: string;
}

interface FakeUserMessage {
  role: "user";
  content: FakeUserTextPart[];
}

function userMessage(text: string): FakeUserMessage {
  return { role: "user", content: [{ type: "text", text }] };
}

describe("rewriteContextMessages — pass-through (no state)", () => {
  it("returns a structurally equal messages array when state is undefined", () => {
    const messages: FakeUserMessage[] = [userMessage("hello world")];
    const result = rewriteContextMessages(messages, undefined) as unknown as FakeUserMessage[];
    expect(result).toEqual(messages);
  });

  it("does not mutate the input messages array on pass-through", () => {
    const messages: FakeUserMessage[] = [userMessage("hello world")];
    const snapshot = JSON.parse(JSON.stringify(messages)) as FakeUserMessage[];
    rewriteContextMessages(messages, undefined);
    expect(messages).toEqual(snapshot);
  });

  it("returns a new array reference even when pass-through", () => {
    const messages: FakeUserMessage[] = [userMessage("hello world")];
    const result = rewriteContextMessages(messages, undefined);
    expect(result).not.toBe(messages);
  });
});

describe("rewriteContextMessages — takeover (state provided)", () => {
  it("rewrites the first user message text to the orientation short message", () => {
    const messages: FakeUserMessage[] = [userMessage(STANDARD_RALPH)];
    const state = loadState("orientation");
    const result = rewriteContextMessages(messages, state) as unknown as FakeUserMessage[];

    expect(result).not.toBe(messages);
    const first = result[0]!;
    expect(first.role).toBe("user");
    const text = first.content[0]!.text;
    expect(text).toContain("ORIENTATION");
    expect(text).toContain(FULL_PROMPT_PATH);
  });

  it("ORIENTATION rewrite must NOT contain the EXECUTE body marker (core gate)", () => {
    const messages: FakeUserMessage[] = [userMessage(STANDARD_RALPH)];
    const state = loadState("orientation");
    const result = rewriteContextMessages(messages, state) as unknown as FakeUserMessage[];

    const text = result[0]!.content[0]!.text;
    expect(text).not.toContain("Execute stage body marker.");
  });

  it("ORIENTATION rewrite must NOT contain the deferred skill XML body marker (core gate)", () => {
    const messages: FakeUserMessage[] = [userMessage(STANDARD_RALPH)];
    const state = loadState("orientation");
    const result = rewriteContextMessages(messages, state) as unknown as FakeUserMessage[];

    const text = result[0]!.content[0]!.text;
    expect(text).not.toContain("Deferred skill XML body marker.");
    expect(text).not.toContain("<ralph-tools-skill");
  });

  it("ORIENTATION rewrite must NOT contain downstream stage bodies", () => {
    const messages: FakeUserMessage[] = [userMessage(STANDARD_RALPH)];
    const state = loadState("orientation");
    const result = rewriteContextMessages(messages, state) as unknown as FakeUserMessage[];

    const text = result[0]!.content[0]!.text;
    expect(text).not.toContain("Tool discipline stage body marker.");
    expect(text).not.toContain("Verify stage body marker.");
    expect(text).not.toContain("Report stage body marker.");
  });

  it("EXECUTE rewrite inlines the deferred skill XML body marker", () => {
    const messages: FakeUserMessage[] = [userMessage(STANDARD_RALPH)];
    const state = loadState("execute");
    const result = rewriteContextMessages(messages, state) as unknown as FakeUserMessage[];

    const text = result[0]!.content[0]!.text;
    expect(text).toContain("EXECUTE");
    expect(text).toContain("Deferred skill XML body marker.");
    expect(text).toContain("<ralph-tools-skill");
  });

  it("preserves additional messages after the first user message", () => {
    const second: FakeUserMessage = userMessage("follow-up turn content");
    const messages: FakeUserMessage[] = [userMessage(STANDARD_RALPH), second];
    const state = loadState("orientation");
    const result = rewriteContextMessages(messages, state) as unknown as FakeUserMessage[];

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(second);
  });

  it("drops prior-stage history after a stage completes", () => {
    const state: RalphSessionState = {
      ...loadState("execute"),
      completedStages: new Set<StageId>(["orientation", "tool_discipline"]),
    };
    const messages = [
      userMessage(STANDARD_RALPH),
      { role: "assistant", content: [{ type: "text", text: "old stage trace" }] },
      userMessage("next-stage kickoff"),
    ];

    const result = rewriteContextMessages(messages, state) as unknown as FakeUserMessage[];

    expect(result).toHaveLength(1);
    expect(result[0]!.content[0]!.text).toContain("EXECUTE");
    expect(JSON.stringify(result)).not.toContain("old stage trace");
  });

  it("does not mutate the input messages array when rewriting", () => {
    const messages: FakeUserMessage[] = [userMessage(STANDARD_RALPH)];
    const snapshot = JSON.parse(JSON.stringify(messages)) as FakeUserMessage[];
    const state = loadState("orientation");

    rewriteContextMessages(messages, state);

    expect(messages).toEqual(snapshot);
    expect(messages[0]!.content[0]!.text).toBe(STANDARD_RALPH);
  });
});

describe("rewriteContextMessages — empty messages array", () => {
  it("returns an empty array when there are no messages and state is provided", () => {
    const messages: FakeUserMessage[] = [];
    const state = loadState("orientation");
    const result = rewriteContextMessages(messages, state);
    expect(result).toEqual([]);
  });

  it("returns an empty array when there are no messages and state is undefined", () => {
    const messages: FakeUserMessage[] = [];
    const result = rewriteContextMessages(messages, undefined);
    expect(result).toEqual([]);
  });
});
