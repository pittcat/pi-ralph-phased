export interface EmitGuardInput {
  stageIsLast: boolean;
  command: string;
  publishTopics: readonly string[];
}

export interface EmitGuardDecision {
  block: boolean;
  reason?: string;
}

/**
 * Safe scaffold behavior is non-blocking. U6 must lock the command/topic policy
 * in a table-driven test before this function starts blocking user commands.
 */
export function shouldBlockTerminalEmit(
  _input: EmitGuardInput,
): EmitGuardDecision {
  return { block: false };
}
