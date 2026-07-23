export type RalphEnvironment = Readonly<Record<string, string | undefined>>;

const RECOGNIZED_STAGE_HEADING =
  /^###\s+(?:0\.\s+ORIENTATION|0b\.\s+TOOL DISCIPLINE|1\.\s+EXECUTE|2\.\s+VERIFY|3\.\s+REPORT)\s*$/gim;

const STRONG_RALPH_SIGNALS = [
  /\bralph\s+emit\b/i,
  /<ralph-tools-skill(?:\s[^>]*)?>/i,
  /\byou\s+are\b[^\r\n]*\bralph\b[^\r\n]*\bhat\b/i,
  /\byou\s+are\b[^\r\n]*\bralph\b[^\r\n]*\bautonomous\b/i,
] as const;

/** Decide conservatively whether a prompt is a Ralph activation dump. */
export function shouldTakeover(
  prompt: string,
  env: RalphEnvironment,
): boolean {
  if (env.RALPH_PI_PHASED === "0") {
    return false;
  }

  const recognizedStageCount = Array.from(
    prompt.matchAll(RECOGNIZED_STAGE_HEADING),
  ).length;

  return (
    recognizedStageCount >= 2 &&
    STRONG_RALPH_SIGNALS.some((signal) => signal.test(prompt))
  );
}
