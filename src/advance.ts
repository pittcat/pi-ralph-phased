import type { RalphSessionState } from "./types.js";

export interface SessionAdvancePort {
  waitForIdle?(): Promise<void>;
  newSession(options: {
    kickoff: string;
  }): Promise<void>;
}

/**
 * Host-independent orchestration seam for U9.
 *
 * The current Pi 0.81.1 AgentSettled handler is typed with ExtensionContext,
 * which does not expose newSession. Do not wire this port to agent_settled until
 * the runtime capability question in docs/SCAFFOLD_DECISIONS.md is resolved.
 */
export async function advanceAfterSettled(
  _state: RalphSessionState,
  _port: SessionAdvancePort,
): Promise<void> {
  throw new Error("TODO(U9): advanceAfterSettled is not implemented");
}
