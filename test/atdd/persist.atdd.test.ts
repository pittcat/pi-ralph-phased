import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, sep } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { persistFullPrompt } from "../../src/persist.js";

/**
 * U5 acceptance test — outside-in ATDD for full-prompt persistence.
 *
 * Scenarios locked here:
 *  - The default code path writes a readable, absolute file whose bytes
 *    exactly equal the input prompt.
 *  - Persistence is non-leaky: it never touches the repository tree and
 *    specifically never writes `.ralph/events.jsonl`.
 *  - The persisted file is private (POSIX 0600) so the dump is not exposed
 *    to other users on the host.
 *  - Empty payloads are accepted (the spec says "byte-equal, including
 *    empty strings"), not refused.
 *
 * Each test owns its own temp directory and cleans up best-effort; no test
 * ever leaves state inside the repository.
 */

const cleanupPaths: string[] = [];

function track(path: string): string {
  cleanupPaths.push(path);
  return path;
}

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (!path) continue;
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // best-effort cleanup must never fail the run
    }
  }
});

describe("ATDD: U5 full-prompt persistence contract", () => {
  it("writes a long Ralph-style dump byte-for-byte and returns a readable absolute path", async () => {
    const sample = `You are Ralph, the autonomous implementation hat.

### 0. ORIENTATION
Read the task.

### 1. EXECUTE
Implement the change.

<ralph-tools-skill id="delivery">Use ralph emit work.done.</ralph-tools-skill>

### 2. VERIFY
Run checks.

### 3. REPORT
publishes: work.done
`;

    const persisted = await persistFullPrompt(sample);
    expect(persisted).toBeTruthy();
    expect(persisted.startsWith(sep)).toBe(true);
    expect(existsSync(persisted)).toBe(true);

    const readBack = readFileSync(persisted, "utf8");
    expect(readBack).toBe(sample);
    expect(readBack.length).toBe(sample.length);

    const parent = persisted.substring(0, persisted.lastIndexOf(sep));
    if (parent) track(parent);
  });

  it("does not write to the repository's .ralph/ ledger (S6 contract)", async () => {
    const repoRoot = join(import.meta.dirname, "..", "..");
    const ledger = join(repoRoot, ".ralph", "events.jsonl");
    const beforeExists = existsSync(ledger);
    const beforeSize = beforeExists ? statSync(ledger).size : 0;

    const persisted = await persistFullPrompt("ledger-canary-content");
    const parent = persisted.substring(0, persisted.lastIndexOf(sep));
    if (parent) track(parent);

    // Persistence must not create the ledger file.
    if (!beforeExists) {
      expect(existsSync(ledger)).toBe(false);
    } else {
      // If the ledger already exists for unrelated reasons, the size must not
      // have changed as a result of this test.
      expect(statSync(ledger).size).toBe(beforeSize);
    }

    // And the persisted file must not live inside .ralph/.
    expect(persisted.includes(join(".ralph"))).toBe(false);
  });

  it("round-trips the empty string", async () => {
    const persisted = await persistFullPrompt("");
    expect(persisted).toBeTruthy();
    expect(persisted.startsWith(sep)).toBe(true);
    expect(readFileSync(persisted, "utf8")).toBe("");
    const parent = persisted.substring(0, persisted.lastIndexOf(sep));
    if (parent) track(parent);
  });

  it("produces a parent directory whose name begins with the `pi-ralph-phased-` prefix", async () => {
    const persisted = await persistFullPrompt("prefix-check");
    const parent = persisted.substring(0, persisted.lastIndexOf(sep));
    const dirName = parent.substring(parent.lastIndexOf(sep) + 1);
    expect(dirName.startsWith("pi-ralph-phased-")).toBe(true);
    track(parent);
  });

  it("sets the file mode to 0600 on POSIX systems (user-only read/write)", async () => {
    if (process.platform === "win32") return;
    const persisted = await persistFullPrompt("permission-check");
    const mode = statSync(persisted).mode & 0o777;
    expect(mode).toBe(0o600);
    const parent = persisted.substring(0, persisted.lastIndexOf(sep));
    if (parent) track(parent);
  });
});
