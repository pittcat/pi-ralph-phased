import type { RalphSessionState, StageId } from "./types.js";

export type StageTransition =
  | { ok: true; advancedTo?: StageId }
  | { ok: false; error: string };

export interface StageMachine {
  readonly current: StageId | undefined;
  readonly nextId: StageId | undefined;
  readonly isComplete: boolean;
  completeStage(stage: StageId): StageTransition;
}

/** U4 implementation seam. Kept explicit so Pi hooks do not enter the domain. */
export function createStageMachine(stages: readonly StageId[]): StageMachine {
  const queue = [...stages];
  const completed = new Set<StageId>();
  let currentIndex = 0;

  return {
    get current(): StageId | undefined {
      return queue[currentIndex];
    },

    get nextId(): StageId | undefined {
      return queue[currentIndex + 1];
    },

    get isComplete(): boolean {
      return currentIndex >= queue.length;
    },

    completeStage(stage: StageId): StageTransition {
      if (completed.has(stage)) return { ok: true };

      const current = queue[currentIndex];
      if (stage !== current) {
        const expected = current === undefined ? "no stage (machine is complete)" : `'${current}'`;
        return { ok: false, error: `Cannot complete '${stage}'; expected ${expected}.` };
      }

      completed.add(stage);
      currentIndex += 1;

      const advancedTo = queue[currentIndex];
      return advancedTo === undefined ? { ok: true } : { ok: true, advancedTo };
    },
  };
}

/**
 * U1 alignment seam: build a {@link StageMachine} that already reflects the
 * live `currentStage` and `completedStages` carried by a `RalphSessionState`.
 *
 * Why this exists: after one or more `ralph_stage_done` tool calls have
 * advanced the live session state in `handleStageDone`, the next tool call
 * must NOT see a fresh queue starting at `stages[0]`. A naive
 * `createStageMachine(state.parsed.stages.map(...))` would reject the
 * "already done" current stage as out-of-order. This helper preserves the
 * queue order but seeds the machine's position from the live state so that
 * `completeStage(state.currentStage)` is always a legal idempotent success.
 *
 * Contract:
 * - `state.currentStage` MUST be present in `state.parsed.stages`; if it is
 *   not, the helper throws — the caller is responsible for guarding the
 *   input. (Production wiring in `handleStageDone` only ever feeds a state
 *   that came from `createSessionState`, so this invariant holds.)
 * - Completed stages from the live state are pre-seeded into the machine's
 *   completed set so that a repeated `completeStage(completed)` call is the
 *   same idempotent `{ ok: true }` return as a fresh machine would give.
 */
export function createStageMachineFromState(state: RalphSessionState): StageMachine {
  const stageIds = state.parsed.stages.map((stage) => stage.id) as StageId[];
  const startIndex = stageIds.indexOf(state.currentStage);
  if (startIndex === -1) {
    throw new Error(
      `createStageMachineFromState: currentStage '${state.currentStage}' is not present in parsed stages [${stageIds.join(", ")}]`,
    );
  }

  const queue = [...stageIds];
  const completed = new Set<StageId>(state.completedStages);
  let currentIndex = startIndex;

  return {
    get current(): StageId | undefined {
      return queue[currentIndex];
    },

    get nextId(): StageId | undefined {
      return queue[currentIndex + 1];
    },

    get isComplete(): boolean {
      return currentIndex >= queue.length;
    },

    completeStage(stage: StageId): StageTransition {
      if (completed.has(stage)) return { ok: true };

      const current = queue[currentIndex];
      if (stage !== current) {
        const expected = current === undefined ? "no stage (machine is complete)" : `'${current}'`;
        return { ok: false, error: `Cannot complete '${stage}'; expected ${expected}.` };
      }

      completed.add(stage);
      currentIndex += 1;

      const advancedTo = queue[currentIndex];
      return advancedTo === undefined ? { ok: true } : { ok: true, advancedTo };
    },
  };
}
