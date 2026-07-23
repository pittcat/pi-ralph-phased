export interface FileIo {
  writeFile(path: string, contents: string): Promise<void>;
  realpath(path: string): Promise<string>;
}

export interface PersistOptions {
  io: FileIo;
  tempDirectory?: string;
}

/**
 * U5 implementation seam. It must write outside Ralph's event ledger and return
 * an absolute, read-compatible path. Cleanup policy remains best-effort.
 */
export async function persistFullPrompt(
  _text: string,
  _options: PersistOptions,
): Promise<string> {
  throw new Error("TODO(U5): persistFullPrompt is not implemented");
}
