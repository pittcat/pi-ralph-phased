import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import type { RalphSessionState } from "./types.js";
import { buildStageUserMessage } from "./prompt-build.js";

type AgentMessage = ContextEvent["messages"][number];

interface ContentPart {
  type: string;
  text?: string;
}

interface RewritableUserMessage {
  role: "user";
  content: ReadonlyArray<ContentPart> | string;
}

function isUserMessage(message: unknown): message is AgentMessage & RewritableUserMessage {
  if (typeof message !== "object" || message === null) return false;
  return (message as { role?: unknown }).role === "user";
}

function asArray<T>(value: readonly T[]): T[] {
  return [...value];
}

function getTextParts(content: ReadonlyArray<ContentPart> | string): ContentPart[] | null {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  const parts: ContentPart[] = [];
  for (const part of content) {
    if (part && part.type === "text") {
      parts.push(part);
    }
  }
  return parts.length > 0 ? parts : null;
}

function buildRewriteContent(state: RalphSessionState): ContentPart[] {
  const text = buildStageUserMessage(state.parsed, state.currentStage, {
    fullPromptPath: state.fullPromptPath,
  });
  return [{ type: "text", text }];
}

/**
 * U8 security-critical seam: replace the original long user message before
 * the provider sees it. Do not mutate messages in place.
 *
 * Pass-through (no state) returns a shallow copy of the input. Takeover
 * replaces the FIRST user message's text with the stage's short contract.
 * After at least one stage completed, prior-stage history is discarded and
 * only the current kickoff is returned. This is the event-safe equivalent of
 * a session reset on Pi 0.81.1, whose event context cannot call newSession.
 *
 * The function accepts `readonly unknown[]` so callers (and tests) can pass
 * Pi-shaped or simplified user messages without TS gymnastics; the runtime
 * contract is purely structural.
 */
export function rewriteContextMessages(
  messages: readonly unknown[],
  state: RalphSessionState | undefined,
): AgentMessage[] {
  if (state === undefined) {
    return asArray(messages as readonly AgentMessage[]);
  }

  if (state.completedStages.size > 0) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const raw = messages[index];
      if (isUserMessage(raw) && getTextParts(raw.content) !== null) {
        return [{
          ...(raw as object),
          content: buildRewriteContent(state),
        } as AgentMessage];
      }
    }
    return [];
  }

  const result: AgentMessage[] = [];
  let rewritten = false;

  for (const raw of messages) {
    if (!rewritten && isUserMessage(raw)) {
      const parts = getTextParts(raw.content);
      if (parts !== null) {
        const replacement: AgentMessage = {
          ...(raw as object),
          content: buildRewriteContent(state),
        } as AgentMessage;
        result.push(replacement);
        rewritten = true;
        continue;
      }
    }
    result.push(raw as AgentMessage);
  }

  return result;
}
