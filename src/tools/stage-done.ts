import type { StageMachine, StageTransition } from "../stage-machine.js";
import type { StageId } from "../types.js";

export interface StageDoneArguments {
  stage: StageId;
  summary?: string;
}

export interface StageDoneResult {
  transition: StageTransition;
  content: string;
}

/**
 * Pure execution seam for U7. Registration and TypeBox schema belong in the Pi
 * adapter (U8); domain validation should not depend on the extension host.
 */
export async function executeStageDoneTool(
  _args: StageDoneArguments,
  _machine: StageMachine,
): Promise<StageDoneResult> {
  throw new Error("TODO(U7): executeStageDoneTool is not implemented");
}
