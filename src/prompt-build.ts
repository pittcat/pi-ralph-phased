import type { ParsedRalphPrompt, StageId } from "./types.js";

export interface BuildStageMessageOptions {
  fullPromptPath: string;
  handoffBrief?: string;
}

/**
 * Build the only user message that should be visible to the model for a stage.
 *
 * U3 must keep ORIENTATION free of later-stage bodies and deferred skill XML.
 * The deferred-skill delivery choice is intentionally unresolved; see
 * docs/SCAFFOLD_DECISIONS.md.
 */
export function buildStageUserMessage(
  _parsed: ParsedRalphPrompt,
  _stageId: StageId,
  _options: BuildStageMessageOptions,
): string {
  throw new Error("TODO(U3): buildStageUserMessage is not implemented");
}
