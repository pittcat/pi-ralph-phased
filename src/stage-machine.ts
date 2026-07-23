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
export function createStageMachine(_stages: readonly StageId[]): StageMachine {
  throw new Error("TODO(U4): createStageMachine is not implemented");
}
