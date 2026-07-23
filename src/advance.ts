import { buildStageUserMessage } from "./prompt-build.js";
import type { ParsedRalphPrompt, RalphSessionState, StageId } from "./types.js";

/**
 * Maximum size of a handoff brief (in characters) appended to the new
 * session kickoff message. Anything longer is truncated and annotated so a
 * stale or pathological brief cannot blow up the kickoff. Locked by U9
 * unit tests.
 */
export const HANDOFF_BRIEF_MAX_CHARS = 4096;

/**
 * Truncation marker appended when a brief is cut. The presence of this
 * marker is the contract tests assert on (they only require the marker
 * text to appear at the tail).
 */
export const HANDOFF_BRIEF_TRUNCATED_MARKER = "[truncated]";

export interface SessionAdvancePort {
  sendUserMessage(text: string): void | Promise<void>;
}

export interface SessionAdvanceInput {
  /**
   * The new stage the machine has advanced to. When omitted, the helper
   * falls back to `state.currentStage`. The caller (`handleAgentSettled`
   * in `src/index.ts`) is responsible for providing this when it holds a
   * fresher answer than the cached in-memory state.
   */
  nextStage?: StageId;
}

/**
 * Render a (possibly truncated) handoff brief. The output is always
 * `HANDOFF_BRIEF_MAX_CHARS` characters or fewer; an empty/null/undefined
 * input collapses to "" with NO truncation marker (U9 contract).
 */
export function renderHandoffBrief(
  _state: RalphSessionState,
  brief: string | null | undefined,
): string {
  if (brief === null || brief === undefined || brief.length === 0) {
    return "";
  }
  if (brief.length <= HANDOFF_BRIEF_MAX_CHARS) {
    return brief;
  }
  const marker = HANDOFF_BRIEF_TRUNCATED_MARKER;
  const headBudget = HANDOFF_BRIEF_MAX_CHARS - marker.length - 1;
  const head = brief.slice(0, Math.max(0, headBudget));
  return `${head} ${marker}`;
}

function deriveHandoffBrief(state: RalphSessionState, nextStage: StageId): string {
  // The brief is what we tell the next-stage model happened on the previous
  // turn. We intentionally limit it to the previous stage's identity plus a
  // marker, NOT the previous turn's tool_call trace — U9 contract requires
  // the new kickoff never include tool_call artifacts.
  // We accept `nextStage` so the helper can describe the previous turn
  // ("you're entering EXECUTE after TOOL DISCIPLINE"), independent of
  // whether `state.currentStage` is up to date.
  const stageIds = state.parsed.stages.map((s) => s.id);
  const nextIdx = stageIds.indexOf(nextStage);
  const previousStage =
    nextIdx > 0 ? stageIds[nextIdx - 1] : undefined;
  if (previousStage === undefined) return "";
  return `Previous stage completed: ${previousStage}. Entering ${nextStage}. Full prompt still on disk at ${state.fullPromptPath}.`;
}

function isTerminal(stage: StageId, parsed: ParsedRalphPrompt): boolean {
  const last = parsed.stages[parsed.stages.length - 1];
  return last !== undefined && last.id === stage;
}

function buildNextKickoff(state: RalphSessionState, nextStage: StageId): string {
  const handoffBrief = renderHandoffBrief(
    state,
    deriveHandoffBrief(state, nextStage),
  );
  return buildStageUserMessage(state.parsed, nextStage, {
    fullPromptPath: state.fullPromptPath,
    ...(handoffBrief.length > 0 ? { handoffBrief } : {}),
  });
}

/**
 * Resolve which stage should run in the new session.
 *
 * The function accepts the explicit `nextStage` argument first; if absent,
 * it falls back to `state.currentStage`. This indirection exists because the
 * U9 caller (`handleAgentSettled`) can hold a fresher answer than the
 * in-memory store, and tests want to drive the contract directly without
 * going through `Tool call -> applyTransition`.
 */
function resolveNextStage(
  state: RalphSessionState,
  nextStage: StageId | undefined,
): StageId {
  return nextStage ?? state.currentStage;
}

/**
 * U3 R7 — should the seam advance at all?
 *
 * Two regimes:
 *  1. Explicit `nextStage` was provided by the caller (the U3 R7
 *     `handleAgentSettled` path that read the parsed queue + completed
 *     set to derive the post-completion next stage). The caller has a
 *     fresher answer than the cached `state.currentStage`, so we trust
 *     it: advance even when the value happens to be the terminal stage
 *     (this is what fires the REPORT kickoff in a fresh session).
 *  2. No explicit `nextStage` — fall back to `state.currentStage`. When
 *     that already IS the terminal stage, the previous U9 S12 path was
 *     supposed to be a no-op. That stays: do not fire a stray
 *     `newSession` after a steady-state idle on the terminal stage.
 *
 * The non-explicit `state.currentStage` fallback is what the U9 unit
 * tests drive (e.g. `makeState({ advancedTo: "report" })`), so it must
 * stay short-circuiting at terminal; R7 does NOT widen that fallback.
 */
function shouldAdvance(
  state: RalphSessionState,
  nextStage: StageId | undefined,
): boolean {
  if (nextStage !== undefined) return true;
  return !isTerminal(state.currentStage, state.parsed);
}

/**
 * Host-independent orchestration seam for U9 + U3 R7.
 *
 * U9 contract:
 *  - When the seam decides to advance (see {@link shouldAdvance}):
 *      1. Computes a kickoff via `buildStageUserMessage` plus a derived
 *         handoff brief (≤ HANDOFF_BRIEF_MAX_CHARS).
 *      2. Uses Pi's event-safe `sendUserMessage` API to trigger the next turn.
 *         The context hook removes prior-stage history before that turn is
 *         sent to the model.
 *  - When the seam decides to no-op, it returns immediately without
 *    invoking ANY port method.
 *  - Every call is `await`ed end-to-end so the surrounding harness can be
 *    sure the side-effect completed (print-mode dispose safety).
 *
 * U3 R7 widening: the seam is now neutral about the terminal-stage
 * `state.currentStage` short-circuit. The caller (U3 R7
 * `handleAgentSettled`) is responsible for telling the seam the
 * post-completion `nextStage` via `input.nextStage` whenever the live
 * state still has the just-completed non-terminal stage as
 * `currentStage`. When `input.nextStage` is the terminal stage, the
 * seam still advances (kickoff = REPORT short contract) — that is the
 * R7 contract that makes the terminal stage actually run in a fresh
 * session.
 */
export async function advanceAfterSettled(
  state: RalphSessionState,
  port: SessionAdvancePort,
  input: SessionAdvanceInput = {},
): Promise<void> {
  const nextStage = resolveNextStage(state, input.nextStage);
  if (!shouldAdvance(state, input.nextStage)) {
    // S12 / R7 no-op: the cached currentStage is already the terminal
    // stage and the caller did not provide a fresher nextStage. Stay
    // idle; do NOT touch the session port.
    return;
  }

  const kickoff = buildNextKickoff(state, nextStage);
  await port.sendUserMessage(kickoff);
}

// Re-exports keep the typed ParsedRalphPrompt/StageId import alive for tooling
// that wants to share the same module-reach surface as the rest of the package.
export type { ParsedRalphPrompt, RalphSessionState, StageId };
