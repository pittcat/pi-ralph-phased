/**
 * U10 — pure hook handler seam for the `tool_call` early-emit guard.
 *
 * Why this exists as its own module:
 *   The Pi-runtime `tool_call` registration must live in `src/index.ts`
 *   because that is the adapter layer, but the *decision logic* — derive
 *   `stageIsLast` / `command` / `publishTopics` from session state, call the
 *   pure U6 policy, and return the result — must be unit-testable without
 *   constructing a Fake Pi. We expose that here as `resolveToolCallGuard`.
 *
 * U10 contract (mirrors `docs/plans/2026-07-23-001-feat-ralph-phased-execution-plan.md`
 * Section 5 — Unit 10):
 *   1. If `port.activeState()` is `undefined`, return `undefined`. The
 *      kill switch `RALPH_PI_PHASED=0` lands here because `before_agent_start`
 *      never populates the store. S2 is covered.
 *   2. If the tool is not `bash`, return `undefined`. (Residual risk
 *      recorded in plan: shell-out through other tools is NOT guarded here;
 *      the plan documents it as accepted. We do not invent new policy.)
 *   3. Pull `command` (preferred) or `cmd` (alias) from `event.args`. If
 *      absent, return `undefined`.
 *   4. Compute `stageIsLast` by comparing `state.currentStage` to the last
 *      element of `state.parsed.stages` — same definition U9 uses, so the
 *      terminal-stage allow path matches `agent_settled`'s last-stage path.
 *   5. Forward to `shouldBlockTerminalEmit`. Return its result verbatim.
 *   6. NEVER call `port.markStageDone(...)` — the plan forbids marking the
 *      current stage complete on a blocked call (S13).
 */

import type { RalphSessionState, StageId } from "./types.js";
import { shouldBlockTerminalEmit, type EmitGuardDecision } from "./emit-guard.js";

/**
 * Minimal adapter contract the wiring layer must satisfy so this module
 * stays free of Pi runtime imports. Tests inject fakes; `src/index.ts`
 * adapts to the real Pi `tool_call` event.
 */
export interface ToolCallGuardPort {
  /**
   * Return the in-flight Ralph session state, or `undefined` when no
   * takeover is active. The Fake's seed path and the production path both
   * converge on this seam.
   */
  activeState(): RalphSessionState | undefined;
  /**
   * Placeholder seam reserved for future U10+ work — never invoked by
   * `resolveToolCallGuard` today; we keep it on the port so a refactor that
   * later needs to record a "blocked attempt" event can do so without
   * changing the index layer wiring.
   */
  markStageDone(stage: StageId): void;
}

/**
 * Structural shape of a Pi `tool_call` event reduced to what this seam
 * actually reads. Real Pi delivers more fields; we deliberately ignore them.
 */
export interface ToolCallEventShape {
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * Result of resolving `event.args.command` / `event.args.cmd`. Either we
 * have a string value, or we don't. We never return `null` to keep the
 * branching at the call site obvious.
 */
export type ToolCallGuardCommand =
  | { readonly present: true; readonly value: string }
  | { readonly present: false };

/**
 * Extract the shell command string a `bash` (or alias) tool invocation is
 * about to run. Prefers `command`, then falls back to `cmd`. Anything else
 * (missing, non-string, empty) is "not present" so the caller lets the call
 * proceed.
 */
export function extractCommand(args: Record<string, unknown>): ToolCallGuardCommand {
  const candidate = args["command"] ?? args["cmd"];
  if (typeof candidate !== "string") return { present: false };
  if (candidate.length === 0) return { present: false };
  return { present: true, value: candidate };
}

/**
 * Compute `stageIsLast` for the active session. Identical semantics to
 * `advance.ts::isTerminal`, inlined here to keep `src/advance.ts` a U9-only
 * file (no U10 imports) and to avoid a cross-module helper for a 3-line
 * check.
 */
export function isLastStage(state: RalphSessionState): boolean {
  const last = state.parsed.stages[state.parsed.stages.length - 1];
  if (last === undefined) return true;
  return last.id === state.currentStage;
}

/**
 * The pure handler. Returns `undefined` when the call should pass through,
 * or an `EmitGuardDecision` when the policy says to block.
 *
 * Side effects: ONLY `port.markStageDone` is reachable in principle, and
 * today this function never invokes it. State is read, never written.
 */
export function resolveToolCallGuard(
  event: ToolCallEventShape,
  port: ToolCallGuardPort,
): EmitGuardDecision | undefined {
  const state = port.activeState();
  if (state === undefined) {
    // S2 / kill-switch path: pass through unconditionally.
    return undefined;
  }

  // Only bash-shaped tools are guarded. Everything else is pass-through
  // by explicit plan risk record.
  if (event.toolName !== "bash" && event.toolName !== "shell") {
    return undefined;
  }

  const cmd = extractCommand(event.args);
  if (!cmd.present) return undefined;

  const stageIsLast = isLastStage(state);
  const decision = shouldBlockTerminalEmit({
    stageIsLast,
    command: cmd.value,
    publishTopics: state.parsed.publishTopics,
  });

  // Explicit: blocking does NOT mark the current stage as complete. The
  // model must run remaining stages or call ralph_stage_done itself.
  //
  // Per the plan, the wiring only returns `{ block: true, reason }` on the
  // non-last path. When the policy decides to allow, we collapse to
  // `undefined` so the extension handler is shape-uniform with the
  // pass-through paths above.
  if (!decision.block) return undefined;
  return decision;
}
