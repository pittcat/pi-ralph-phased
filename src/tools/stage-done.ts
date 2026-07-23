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

const STAGE_IDS = [
  "orientation",
  "tool_discipline",
  "execute",
  "verify",
  "report",
] as const satisfies readonly StageId[];

function isStageId(value: unknown): value is StageId {
  return typeof value === "string" && (STAGE_IDS as readonly string[]).includes(value);
}

function isStageDoneArguments(value: unknown): value is StageDoneArguments {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (!isStageId(record["stage"])) return false;
  const summary = record["summary"];
  if (summary !== undefined && typeof summary !== "string") return false;
  return true;
}

function renderTransition(transition: StageTransition): string {
  if (transition.ok) {
    if (transition.advancedTo === undefined) {
      return `Stage complete; machine is finished.`;
    }
    return `Stage complete; advanced to '${transition.advancedTo}'.`;
  }
  return `Stage completion rejected: ${transition.error}`;
}

/**
 * Pure execution seam for U7. Registration and TypeBox schema belong in the Pi
 * adapter (U8); domain validation should not depend on the extension host.
 */
export async function executeStageDoneTool(
  args: StageDoneArguments,
  machine: StageMachine,
): Promise<StageDoneResult> {
  if (!isStageDoneArguments(args)) {
    if (args === null || args === undefined || typeof args !== "object") {
      const message = "args must be an object with a 'stage' field";
      return {
        transition: { ok: false, error: message },
        content: `Stage completion rejected: ${message}`,
      };
    }
    const record = args as Record<string, unknown>;
    const rawStage = record["stage"];
    const stagePart =
      typeof rawStage === "string"
        ? ` (got ${JSON.stringify(rawStage)})`
        : ` (got ${typeof rawStage === "object" && rawStage !== null ? "object" : typeof rawStage})`;
    const message = `args.stage must be one of the StageId union values${stagePart}`;
    return {
      transition: { ok: false, error: message },
      content: `Stage completion rejected: ${message}`,
    };
  }

  const transition = machine.completeStage(args.stage);
  return {
    transition,
    content: renderTransition(transition),
  };
}