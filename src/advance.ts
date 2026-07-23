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
  /**
   * Wait for the current run loop to settle before issuing newSession.
   * Per the U9 contract: optional; absent on real Pi 0.81.1
   * `ExtensionContext` (which only carries it on `ExtensionCommandContext`).
   * The fake and any future-compatible runtime can supply it.
   */
  waitForIdle?(): Promise<void>;
  newSession(options: {
    kickoff: string;
  }): Promise<void>;
  /**
   * sendUserMessage is intentionally NOT used for stage advance — sending a
   * message would merely stack history instead of resetting context. We
   * model it here only so the seam can document that we never call it. The
   * fake extends the port with it so ATDD can prove the negative.
   */
  sendUserMessage?(text: string): Promise<void>;
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
 * Host-independent orchestration seam for U9.
 *
 * U9 contract:
 *  - When `nextStage` (or the fallback `state.currentStage`) is NOT the
 *    actual last stage in `state.parsed.stages`, this function:
 *      1. Awaits `port.waitForIdle?.()` if the port exposes it
 *         (skipping silently otherwise).
 *      2. Computes a kickoff via `buildStageUserMessage` plus a derived
 *         handoff brief (≤ HANDOFF_BRIEF_MAX_CHARS) and awaits
 *         `port.newSession({ kickoff })`.
 *      3. Does NOT call `port.sendUserMessage` (sending a message would
 *         only stack history — the whole point of U9 is to RESET context).
 *  - When the resolved stage IS the actual last stage, this function
 *    returns immediately without invoking ANY port method.
 *  - Every call is `await`ed end-to-end so the surrounding harness can be
 *    sure the side-effect completed (print-mode dispose safety).
 */
export async function advanceAfterSettled(
  state: RalphSessionState,
  port: SessionAdvancePort,
  input: SessionAdvanceInput = {},
): Promise<void> {
  const nextStage = resolveNextStage(state, input.nextStage);
  if (isTerminal(nextStage, state.parsed)) {
    // S12: terminal stage — no advance, no push. Completion surfaces through
    // `state.isComplete` (see `src/stage-machine.ts`).
    return;
  }

  if (typeof port.waitForIdle === "function") {
    await port.waitForIdle();
  }

  const kickoff = buildNextKickoff(state, nextStage);
  await port.newSession({ kickoff });
}

// Re-exports keep the typed ParsedRalphPrompt/StageId import alive for tooling
// that wants to share the same module-reach surface as the rest of the package.
export type { ParsedRalphPrompt, RalphSessionState, StageId };
