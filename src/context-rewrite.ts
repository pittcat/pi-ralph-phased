import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import type { RalphSessionState } from "./types.js";

type AgentMessage = ContextEvent["messages"][number];

/**
 * U8's security-critical seam: replace the original long user message before
 * the provider sees it. Do not mutate messages in place.
 *
 * Scaffold is a no-op because takeover is disabled. Enabling takeover before
 * this function has differential tests would expose the full dump to the LLM.
 */
export function rewriteContextMessages(
  messages: readonly AgentMessage[],
  _state: RalphSessionState | undefined,
): AgentMessage[] {
  return [...messages];
}
