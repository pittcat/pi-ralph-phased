import type { ParsedRalphPrompt } from "./types.js";

/**
 * Parse a Ralph activation dump without performing IO.
 *
 * Scaffold only. U2 must define exact heading variants, XML extraction, and
 * publish-topic extraction with fixtures copied from build_custom_hat output.
 */
export function parseRalphPrompt(_prompt: string): ParsedRalphPrompt | null {
  return null;
}
