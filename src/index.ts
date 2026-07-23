import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Pi extension entrypoint.
 *
 * This scaffold deliberately registers no hooks or tools. It therefore loads
 * safely and behaves exactly like an absent extension. U8 should add hooks only
 * after detection, parsing, persistence, and context-rewrite tests are green.
 */
export default function piRalphPhased(_pi: ExtensionAPI): void {
  // TODO(U8): register before_agent_start + context + ralph_stage_done.
  // TODO(U9): register agent_settled only after session-control API is proven.
  // TODO(U10): register tool_call emit guard after its pure policy is tested.
}
