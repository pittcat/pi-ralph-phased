import { describe, expect, it } from "vitest";

import { FakeExtensionAPI } from "../fakes/fake-pi.js";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import piRalphPhased from "../../src/index.js";

/**
 * U8 — Fake Pi extension wiring ATDD.
 *
 * Loads the real `src/index.ts` default export against a Fake `ExtensionAPI`,
 * then drives the Fake through the exact event sequence Pi would deliver:
 *   1. `before_agent_start`  → must persist full prompt + set session state
 *   2. `context`             → must rewrite first user message to orientation
 *   3. `registerTool("ralph_stage_done")` → must be observable on Fake
 *
 * Scenarios covered: S1 (short prompt — no takeover, no rewrite),
 * S6 (takeover — visible text excludes full EXECUTE body),
 * S7 (ORIENTATION excludes skill XML full body).
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

interface FakeTextPart {
  type: "text";
  text: string;
}

interface FakeUserMessage {
  role: "user";
  content: FakeTextPart[];
}

function userMessage(text: string): FakeUserMessage {
  return { role: "user", content: [{ type: "text", text }] };
}

async function loadExtension(): Promise<FakeExtensionAPI> {
  const fake = new FakeExtensionAPI();
  await piRalphPhased(fake as unknown as Parameters<typeof piRalphPhased>[0]);
  return fake;
}

describe("U8 ATDD — S1 short prompt pass-through", () => {
  it("registers before_agent_start and context handlers but does NOT take over short prompts", async () => {
    const fake = await loadExtension();
    expect(fake.hasHandler("before_agent_start")).toBe(true);
    expect(fake.hasHandler("context")).toBe(true);

    const shortPrompt = "hello world";
    const beforeTemp = await listRalphTempFiles();
    const beforeResult = await fake.invokeBeforeAgentStart({
      prompt: shortPrompt,
      systemPrompt: "sys",
      systemPromptOptions: { skills: [], projectContext: [] } as never,
    } as never);

    expect(beforeResult).toBeUndefined();

    const messages: FakeUserMessage[] = [userMessage(shortPrompt)];
    const contextResult = await fake.invokeContext({
      type: "context",
      messages: messages as unknown as never[],
    } as never);

    expect(contextResult).toBeUndefined();

    // No new pi-ralph-phased temp file should have been written for a short prompt.
    const afterTemp = await listRalphTempFiles();
    expect(afterTemp).toEqual(beforeTemp);
  });
});

describe("U8 ATDD — S6 takeover persists full prompt", () => {
  it("Ralph dump causes before_agent_start to persist the full prompt to disk", async () => {
    const fake = await loadExtension();
    expect(fake.hasHandler("before_agent_start")).toBe(true);

    const beforeTemp = await listRalphTempFiles();
    await fake.invokeBeforeAgentStart({
      prompt: STANDARD_RALPH,
      systemPrompt: "sys",
      systemPromptOptions: { skills: [], projectContext: [] } as never,
    } as never);

    const afterTemp = await listRalphTempFiles();
    const newlyCreated = afterTemp.filter((entry) => !beforeTemp.includes(entry));
    expect(newlyCreated.length).toBeGreaterThan(0);

    const onDisk = await readFile(newlyCreated[newlyCreated.length - 1]!, "utf8");
    expect(onDisk).toBe(STANDARD_RALPH);
  });
});

describe("U8 ATDD — S6 first-turn visible text excludes full EXECUTE body", () => {
  it("after takeover, context handler rewrites the user message to orientation short text", async () => {
    const fake = await loadExtension();

    await fake.invokeBeforeAgentStart({
      prompt: STANDARD_RALPH,
      systemPrompt: "sys",
      systemPromptOptions: { skills: [], projectContext: [] } as never,
    } as never);

    const messages: FakeUserMessage[] = [userMessage(STANDARD_RALPH)];
    const result = (await fake.invokeContext({
      type: "context",
      messages: messages as unknown as never[],
    } as never)) as { messages?: FakeUserMessage[] } | undefined;

    expect(result).toBeDefined();
    expect(result!.messages).toBeDefined();

    const rewritten = result!.messages![0]!;
    expect(rewritten.role).toBe("user");
    const text = rewritten.content[0]!.text;

    // Core gate: the orientation message must NOT leak the EXECUTE body.
    expect(text).not.toContain("Execute stage body marker.");
    // The orientation message must include a short contract.
    expect(text).toContain("ORIENTATION");
    expect(text).toContain("ralph_stage_done");
    // And expose the absolute path to the full prompt for read access.
    expect(text).toMatch(/pi-ralph-phased-[A-Za-z0-9]+\/[A-Za-z0-9]+\.md/);
  });
});

/**
 * Enumerate `.md` files inside `pi-ralph-phased-*` temp directories under
 * `os.tmpdir()`. Used to discover the path the extension just wrote.
 */
async function listRalphTempFiles(): Promise<string[]> {
  const base = tmpdir();
  const entries = await readdir(base, { withFileTypes: true });
  const matches: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith("pi-ralph-phased-")) continue;
    const dir = join(base, entry.name);
    const files = await readdir(dir);
    for (const file of files) {
      if (file.endsWith(".md")) matches.push(join(dir, file));
    }
  }
  return matches;
}

describe("U8 ATDD — S7 ORIENTATION must NOT contain deferred skill XML", () => {
  it("orientation visible text contains neither <ralph-tools-skill nor its body marker", async () => {
    const fake = await loadExtension();

    await fake.invokeBeforeAgentStart({
      prompt: STANDARD_RALPH,
      systemPrompt: "sys",
      systemPromptOptions: { skills: [], projectContext: [] } as never,
    } as never);

    const messages: FakeUserMessage[] = [userMessage(STANDARD_RALPH)];
    const result = (await fake.invokeContext({
      type: "context",
      messages: messages as unknown as never[],
    } as never)) as { messages?: FakeUserMessage[] } | undefined;

    const text = result!.messages![0]!.content[0]!.text;
    expect(text).not.toContain("<ralph-tools-skill");
    expect(text).not.toContain("Deferred skill XML body marker.");
  });
});

describe("U8 ATDD — ralph_stage_done tool registration", () => {
  it("registerTool('ralph_stage_done') is invoked during extension load", async () => {
    const fake = await loadExtension();
    const registered = fake.registeredTools();
    expect(registered.some((t) => t.name === "ralph_stage_done")).toBe(true);
  });
});