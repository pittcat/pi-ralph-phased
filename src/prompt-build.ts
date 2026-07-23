import type { ParsedRalphPrompt, StageId } from "./types.js";

export interface BuildStageMessageOptions {
  fullPromptPath: string;
  handoffBrief?: string;
}

/**
 * U3 policy lock — EXECUTE inlines deferredSkills[].source verbatim.
 *
 * Other stages do not unconditionally inline deferred skill XML; ORIENTATION
 * must remain free of any deferred skill text per S7. This keeps the
 * ORIENTATION message small and prevents later-stage rules from leaking
 * into the orientation briefing.
 */
const STAGE_DISPLAY_NAME: Readonly<Record<StageId, string>> = {
  orientation: "ORIENTATION",
  tool_discipline: "TOOL DISCIPLINE",
  execute: "EXECUTE",
  verify: "VERIFY",
  report: "REPORT",
};

/**
 * Build the only user message that should be visible to the model for a stage.
 *
 * The output contains the short core contract (stage name/id, single-business-
 * event budget reminder, full prompt absolute path, non-last-stage terminal
 * emit prohibition, completion instruction to call ralph_stage_done) followed
 * by the current stage's body and optional handoff brief.
 *
 * U3 invariants:
 * - ORIENTATION does NOT contain later-stage bodies (EXECUTE / VERIFY / REPORT)
 *   nor any deferred skill XML.
 * - EXECUTE inlines every entry in parsed.deferredSkills[].source verbatim.
 * - The actual last stage in the parsed queue omits the terminal-emit
 *   prohibition so the model may publish the final topic.
 * - Requesting a stageId absent from the parsed queue throws (safe default).
 *
 * The function is pure: it does not depend on StageMachine, Pi hooks, or IO.
 */
export function buildStageUserMessage(
  parsed: ParsedRalphPrompt,
  stageId: StageId,
  options: BuildStageMessageOptions,
): string {
  const stage = parsed.stages.find((s) => s.id === stageId);
  if (!stage) {
    throw new Error(`buildStageUserMessage: stage '${stageId}' not found in parsed queue`);
  }

  const lastStage = parsed.stages[parsed.stages.length - 1];
  const isLastStage = lastStage !== undefined && lastStage.id === stageId;
  const displayName = STAGE_DISPLAY_NAME[stageId];
  const fullPromptPath = options.fullPromptPath;

  const sections: string[] = [];

  // Header: stage identity banner.
  sections.push(`[STAGE] ${displayName} (${stageId})`);

  // Core contract — kept short on purpose.
  sections.push(`[BUDGET] This stage is one business event. Do not chain multiple business events here.`);

  // Full prompt path for read access.
  sections.push(`[FULL PROMPT] The complete Ralph activation prompt is on disk at: ${fullPromptPath}`);

  // Terminal-emit prohibition — only on non-terminal stages.
  if (!isLastStage) {
    sections.push(`[EMIT] This is not the final stage. Do not emit a terminal business event (e.g. work.done) here; only the final stage may publish.`);
  }

  // Completion instruction — always present.
  sections.push(`[DONE] When this stage is complete, call ralph_stage_done with stage="${stageId}".`);

  // Optional handoff brief from previous stage.
  if (options.handoffBrief && options.handoffBrief.length > 0) {
    sections.push(`[HANDOFF] ${options.handoffBrief}`);
  }

  // Stage body — current stage only.
  sections.push(`[BODY]\n${stage.body}`);

  // EXECUTE inline policy: inline every deferred skill source verbatim.
  if (stageId === "execute") {
    for (const skill of parsed.deferredSkills) {
      sections.push(`[DEFERRED SKILL: ${skill.name}]\n${skill.source}`);
    }
  }

  return sections.join("\n\n");
}