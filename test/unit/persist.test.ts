import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { persistFullPrompt, type FileIo } from "../../src/persist.js";

/**
 * Best-effort cleanup helpers — U5 cleanup is a best-effort policy, so the
 * tests must not leak tmpdir entries between runs. Each test keeps a list of
 * paths it created and removes them in `afterEach`.
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
      // best-effort; never let cleanup failures fail the test run
    }
  }
});

describe("persistFullPrompt — default Node IO", () => {
  let repoRoot: string;

  beforeEach(() => {
    // The repository's project root — used to assert that persistence does not
    // touch the .ralph/ ledger or any file under the repo tree.
    repoRoot = join(import.meta.dirname, "..", "..");
  });

  it("returns an absolute path under os.tmpdir()", async () => {
    const result = await persistFullPrompt("hello world");
    expect(result).toBeTruthy();
    expect(result.startsWith(sep)).toBe(true);
    // The path must live under tmpdir(); we compare by prefix because tmpdir()
    // on macOS is /var/folders/... but symlinks resolve to /private/var/... .
    const tmpRoot = tmpdir();
    expect(result.startsWith(tmpRoot) || result.startsWith(await realpathOf(tmpRoot))).toBe(true);
    // track for cleanup: derive the parent dir
    const parent = result.substring(0, result.lastIndexOf(sep));
    if (parent) track(parent);
  });

  it("uses a directory whose name starts with the pi-ralph-phased- prefix", async () => {
    const result = await persistFullPrompt("hello world");
    const parent = result.substring(0, result.lastIndexOf(sep));
    const dirName = parent.substring(parent.lastIndexOf(sep) + 1);
    expect(dirName.startsWith("pi-ralph-phased-")).toBe(true);
    track(parent);
  });

  it("writes the file with the same bytes as the input (round-trip)", async () => {
    const text = "alpha\nbeta\tgamma\n";
    const result = await persistFullPrompt(text);
    const onDisk = readFileSync(result, "utf8");
    expect(onDisk).toBe(text);
    // Buffer equality — also asserts no encoding transformation.
    const buffer = readFileSync(result);
    expect(buffer.toString("utf8")).toBe(text);
    const parent = result.substring(0, result.lastIndexOf(sep));
    if (parent) track(parent);
  });

  it("writes an empty string (not refuse it) and round-trips an empty payload", async () => {
    const result = await persistFullPrompt("");
    expect(result).toBeTruthy();
    expect(result.startsWith(sep)).toBe(true);
    const onDisk = readFileSync(result, "utf8");
    expect(onDisk).toBe("");
    const parent = result.substring(0, result.lastIndexOf(sep));
    if (parent) track(parent);
  });

  it("restricts the file permissions to user-only (0600) on POSIX systems", async () => {
    if (process.platform === "win32") return;
    const result = await persistFullPrompt("permission-test");
    const stats = statSync(result);
    // 0o777 mask isolates the permission bits.
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
    const parent = result.substring(0, result.lastIndexOf(sep));
    if (parent) track(parent);
  });

  it("does not place the persisted file inside the repository's .ralph/ tree", async () => {
    const result = await persistFullPrompt("leakage-canary");
    const realPath = await realpathOf(result);
    const realRepo = await realpathOf(repoRoot);
    expect(realPath.startsWith(realRepo + sep)).toBe(false);
    const realParent = realPath.substring(0, realPath.lastIndexOf(sep));
    expect(realParent.endsWith(join(".ralph"))).toBe(false);
    // Also: nothing matching `.ralph/events.jsonl` should exist anywhere along
    // the persistence path. The parent dir name does not contain `.ralph`.
    const parent = result.substring(0, result.lastIndexOf(sep));
    expect(parent.includes(".ralph")).toBe(false);
    if (parent) track(parent);
  });

  it("uses a fresh tmp directory per call (high-entropy names are not shared)", async () => {
    const first = await persistFullPrompt("first");
    const second = await persistFullPrompt("second");
    expect(first).not.toBe(second);
    const firstParent = first.substring(0, first.lastIndexOf(sep));
    const secondParent = second.substring(0, second.lastIndexOf(sep));
    expect(firstParent).not.toBe(secondParent);
    track(firstParent);
    track(secondParent);
  });
});

/**
 * Local helper that resolves symlinks without importing the unused `realpath`
 * module at the top level — kept in this file to avoid a global import.
 */
async function realpathOf(path: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  return realpath(path);
}

describe("persistFullPrompt — injected FileIo (no real filesystem touches outside the temp dir)", () => {
  it("calls io.writeFile with the absolute path and the exact text", async () => {
    const captured: { path: string; contents: string } = { path: "", contents: "" };
    const fakeIo: FileIo = {
      async writeFile(path: string, contents: string): Promise<void> {
        captured.path = path;
        captured.contents = contents;
      },
      async realpath(path: string): Promise<string> {
        return path;
      },
    };
    const fixedPath = `/tmp/pi-ralph-phased-test/${randomUUID()}.md`;
    const result = await persistFullPrompt("hello", { io: fakeIo, path: fixedPath });
    expect(captured.path).toBe(fixedPath);
    expect(captured.contents).toBe("hello");
    expect(result).toBe(fixedPath);
  });

  it("returns the realpath provided by io.realpath rather than the raw write target", async () => {
    const fakeIo: FileIo = {
      async writeFile(_path: string, _contents: string): Promise<void> {
        // no-op
      },
      async realpath(path: string): Promise<string> {
        return `${path}/real`;
      },
    };
    const result = await persistFullPrompt("x", { io: fakeIo, path: "/tmp/somewhere/file" });
    expect(result).toBe("/tmp/somewhere/file/real");
  });

  it("uses the explicit tempDirectory from options when provided", async () => {
    const writtenTo: { value: string | null } = { value: null };
    const fakeIo: FileIo = {
      async writeFile(path: string, _contents: string): Promise<void> {
        writtenTo.value = path;
      },
      async realpath(path: string): Promise<string> {
        return path;
      },
    };
    const explicitDir = `/tmp/explicit-${randomUUID()}`;
    const result = await persistFullPrompt("x", { io: fakeIo, tempDirectory: explicitDir });
    expect(writtenTo.value).not.toBeNull();
    if (writtenTo.value !== null) {
      expect(writtenTo.value.startsWith(explicitDir + sep)).toBe(true);
    }
    expect(result.startsWith(explicitDir + sep)).toBe(true);
  });
});

/**
 * Reference comparison to a manually-built tmp directory prefix — used to
 * document the expected default name shape in the U5 plan.
 */
describe("persistFullPrompt — tmp directory name format", () => {
  it("default name pattern matches the plan's `pi-ralph-phased-` prefix", async () => {
    const reference = mkdtempSync(join(tmpdir(), "pi-ralph-phased-"));
    track(reference);
    expect(reference.split(sep).pop()?.startsWith("pi-ralph-phased-")).toBe(true);
  });
});
