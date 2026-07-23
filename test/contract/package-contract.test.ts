import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

interface PackageManifest {
  type?: unknown;
  pi?: { extensions?: unknown };
  peerDependencies?: Record<string, unknown>;
}

describe("package contract", () => {
  it("declares the ESM Pi extension and compatible Pi peer", async () => {
    const packageUrl = new URL("../../package.json", import.meta.url);
    const manifest = JSON.parse(
      await readFile(packageUrl, "utf8"),
    ) as PackageManifest;

    expect(manifest.type).toBe("module");
    expect(manifest.pi?.extensions).toEqual(["./src/index.ts"]);
    expect(
      manifest.peerDependencies?.["@earendil-works/pi-coding-agent"],
    ).toMatch(/^\^0\.81\.1$/);
  });
});
