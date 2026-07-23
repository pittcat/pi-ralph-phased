import type { ParsedRalphPrompt } from "./types.js";

export type RalphEnvironment = Readonly<
  Record<string, string | undefined>
>;

/**
 * Safe scaffold behavior: never take over until U1/U2 tests lock down both the
 * detection heuristic and parser agreement. False negatives are preferable to
 * leaking a false-positive prompt into the phased path.
 */
export function shouldTakeover(
  _prompt: string,
  env: RalphEnvironment,
  _parsed?: ParsedRalphPrompt | null,
): boolean {
  if (env.RALPH_PI_PHASED === "0") {
    return false;
  }

  // TODO(U1): require >=2 recognized stage headings plus a strong Ralph signal.
  // TODO(U2): decide whether parser success is mandatory or only corroborating.
  return false;
}
