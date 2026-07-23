import type { StageId } from "./types.js";

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
