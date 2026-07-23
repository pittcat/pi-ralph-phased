import type { ParsedRalphPrompt, RalphSessionState, StageId } from "./types.js";
import { createStageMachine } from "./stage-machine.js";

export interface CreateSessionStateInput {
  originalPrompt: string;
  fullPromptPath: string;
  parsed: ParsedRalphPrompt;
  stageIds: readonly StageId[];
  currentStage?: StageId;
}

/**
 * Build a fresh {@link RalphSessionState} for one Ralph activation dump.
 *
 * U8 contract:
 * - Persist the original prompt verbatim alongside an absolute path the
 *   rewriter can advertise to the model.
 * - Carry the parsed stages, the current stage (defaults to first parsed
 *   stage), and an empty completed-set (the stage machine owns completion).
 * - Be deterministic so `context-rewrite.ts` and the ATDD can replay it.
 */
export function createSessionState(input: CreateSessionStateInput): RalphSessionState {
  const machine = createStageMachine(input.stageIds);
  const currentStage = input.currentStage ?? machine.current;
  if (currentStage === undefined) {
    throw new Error("createSessionState: cannot derive a current stage from an empty queue");
  }

  return {
    originalPrompt: input.originalPrompt,
    fullPromptPath: input.fullPromptPath,
    parsed: input.parsed,
    currentStage,
    completedStages: new Set<StageId>(),
    pendingAdvance: false,
  };
}

/**
 * Process-local state holder for Pi print/headless mode.
 *
 * U8 must decide the state key/lifetime for multiple runs in one process and
 * clear state on pass-through prompts and session replacement.
 */
export class SessionStateStore {
  #active: RalphSessionState | undefined;

  get active(): RalphSessionState | undefined {
    return this.#active;
  }

  set(state: RalphSessionState): void {
    this.#active = state;
  }

  clear(): void {
    this.#active = undefined;
  }
}
