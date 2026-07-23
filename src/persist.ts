import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Port for filesystem access. Injected so unit tests can assert call
 * contracts without touching the real filesystem; production uses the
 * {@link nodeFileIo} default.
 */
export interface FileIo {
  writeFile(path: string, contents: string): Promise<void>;
  realpath(path: string): Promise<string>;
}

export interface PersistOptions {
  /**
   * Filesystem port. When omitted, the production implementation uses
   * `node:fs/promises` directly.
   */
  io?: FileIo;
  /**
   * Override the parent directory. The default is `os.tmpdir()`. The
   * implementation still creates a `pi-ralph-phased-XXXXXXXX` sub-directory
   * under whatever directory is supplied here.
   */
  tempDirectory?: string;
  /**
   * Override the file name written inside the temp directory. Tests use
   * this to assert exact paths.
   */
  path?: string;
}

const nodeFileIo: FileIo = {
  async writeFile(path: string, contents: string): Promise<void> {
    await writeFile(path, contents, { encoding: "utf8", mode: 0o600 });
  },
  async realpath(path: string): Promise<string> {
    return realpath(path);
  },
};

/**
 * U5 implementation: persist the full Ralph prompt to a private temp file.
 *
 * Contract:
 *  - Returns an absolute, readable file path whose bytes equal the input
 *    (including the empty string).
 *  - The file lives in a fresh `pi-ralph-phased-XXXXXXXX` directory under
 *    `os.tmpdir()` (or under the supplied `tempDirectory`); it never touches
 *    the Ralph event ledger (`.ralph/events.jsonl`) or anything else inside
 *    the repository tree.
 *  - On POSIX systems the file is opened with mode `0o600` (user-only).
 *  - Cleanup is intentionally not performed here — the surrounding unit
 *    documents the best-effort cleanup policy.
 *
 * The function is host-independent: it does not import Pi runtime types,
 * and accepts a `FileIo` port so callers (and tests) can substitute the IO
 * surface.
 */
export async function persistFullPrompt(
  text: string,
  options: PersistOptions = {},
): Promise<string> {
  const io = options.io ?? nodeFileIo;

  // Compose the file path. When callers pin `path` we use it verbatim; this
  // lets tests assert exact locations. Otherwise we build a high-entropy
  // path under a fresh `pi-ralph-phased-XXXXXXXX` sub-directory of tmpdir.
  const filePath = options.path ?? (await defaultFilePath(options.tempDirectory));

  await io.writeFile(filePath, text);

  // For the real-filesystem path, also enforce 0o600 after the fact so tests
  // that only inspect mode (and not the open() flag) get the same answer.
  if (options.io === undefined && process.platform !== "win32") {
    await chmod(filePath, 0o600);
  }

  return io.realpath(filePath);
}

async function defaultFilePath(tempDirectory?: string): Promise<string> {
  const baseDir = tempDirectory ?? tmpdir();
  // Ensure the parent directory exists; mkdtemp only creates the last
  // segment. We create it with 0o700 so the parent is also user-only.
  if (process.platform !== "win32") {
    await mkdir(baseDir, { recursive: true, mode: 0o700 });
  } else {
    await mkdir(baseDir, { recursive: true });
  }
  const dir = await mkdtemp(join(baseDir, "pi-ralph-phased-"));
  const name = randomBytes(12).toString("hex") + ".md";
  return join(dir, name);
}
