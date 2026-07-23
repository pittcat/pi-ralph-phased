import type {
  BeforeAgentStartEvent,
  ContextEvent,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

import { shouldTakeover } from "./detect.js";
import { parseRalphPrompt } from "./parse.js";
import { persistFullPrompt } from "./persist.js";
import { createSessionState, SessionStateStore } from "./session-state.js";
import { rewriteContextMessages } from "./context-rewrite.js";
import { executeStageDoneTool } from "./tools/stage-done.js";
import { createStageMachine } from "./stage-machine.js";
import type { RalphSessionState, StageId } from "./types.js";

/**
 * Structural shape of `BeforeAgentStartEventResult`. The official name is
 * exported from the inner extensions module but not re-exported by the top-
 * level package entry, so we declare it locally to keep type-only imports
 * stable across Pi releases.
 */
interface BeforeAgentStartEventResultLike {
  message?: unknown;
  systemPrompt?: string;
}

/**
 * Structural shape of `ContextEventResult`. Same caveat as above.
 */
interface ContextEventResultLike {
  messages?: unknown;
}

/**
 * U8 wiring: register the three behaviours that are needed for the first
 * turn + stage tool, but stay narrowly scoped so U9/U10 can add their own
 * hooks without disturbing this surface.
 *
 * Constraints honoured here:
 * - `before_agent_start` may only return `message?` / `systemPrompt?` per
 *   the official Pi 0.81.1 `BeforeAgentStartEventResult`; we never invent a
 *   `prompt` replacement field. The long user prompt is rewritten later by
 *   the `context` handler.
 * - `context` is the only allowed channel for rewriting the user-visible
 *   text. C1/C2 require that.
 * - The tool registration uses a hand-rolled JSON-schema-shaped `parameters`
 *   literal because the project deliberately avoids adding `@sinclair/typebox`
 *   as a direct dependency. Pi's `ToolDefinition.parameters` is typed
 *   `TSchema`; passing an object that conforms to that shape works at the
 *   Pi runtime boundary — U11 will replace this with the official helper.
 * - U9 (agent_settled, newSession, sendUserMessage, waitForIdle) and U10
 *   (tool_call emit guard) are deliberately NOT registered here.
 */

interface RalphStageDoneParams {
  stage: StageId;
  summary?: string;
}

const RALPH_STAGE_DONE_PARAMETERS = {
  type: "object",
  properties: {
    stage: {
      type: "string",
      enum: ["orientation", "tool_discipline", "execute", "verify", "report"],
    },
    summary: { type: "string" },
  },
  required: ["stage"],
  additionalProperties: false,
} as const;

export default function piRalphPhased(pi: ExtensionAPI): void {
  const store = new SessionStateStore();

  pi.on("before_agent_start" as never, (((event: BeforeAgentStartEvent) =>
    handleBeforeAgentStart(event, store)) as unknown) as never);

  pi.on("context" as never, (((event: ContextEvent) =>
    handleContext(event, store)) as unknown) as never);

  pi.registerTool({
    name: "ralph_stage_done",
    label: "Mark current Ralph stage complete",
    description: "Signal that the current Ralph stage is complete and advance the stage machine.",
    parameters: RALPH_STAGE_DONE_PARAMETERS,
    execute: async (
      _toolCallId: string,
      params: RalphStageDoneParams,
    ): Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }> => {
      return handleStageDone(params, store);
    },
  } as never);
}

async function handleBeforeAgentStart(
  event: BeforeAgentStartEvent,
  store: SessionStateStore,
): Promise<BeforeAgentStartEventResultLike | void> {
  if (!shouldTakeover(event.prompt, process.env)) return;

  const parsed = parseRalphPrompt(event.prompt);
  if (!parsed) return;

  const fullPromptPath = await persistFullPrompt(event.prompt);
  const stageIds = parsed.stages.map((stage) => stage.id) as StageId[];

  const state = createSessionState({
    originalPrompt: event.prompt,
    fullPromptPath,
    parsed,
    stageIds,
  });

  store.set(state);

  // C1/C2 — we cannot replace the user prompt here, so the hook simply
  // returns undefined and lets the `context` handler rewrite messages.
  return undefined;
}

function handleContext(
  event: ContextEvent,
  store: SessionStateStore,
): ContextEventResultLike | void {
  const state = store.active;
  if (state === undefined) return;

  const messages = rewriteContextMessages(event.messages as readonly unknown[], state);
  return { messages };
}

async function handleStageDone(
  params: RalphStageDoneParams,
  store: SessionStateStore,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }> {
  const state = store.active;
  if (state === undefined) {
    return {
      content: [{ type: "text", text: "ralph_stage_done rejected: no active Ralph session." }],
      details: { ok: false, error: "no active session" },
    };
  }

  const stageIds = state.parsed.stages.map((stage) => stage.id) as StageId[];
  const machine = createStageMachine(stageIds);

  const result = await executeStageDoneTool(
    {
      stage: params.stage,
      ...(params.summary !== undefined ? { summary: params.summary } : {}),
    },
    machine,
  );

  // Advance the in-memory session state so the next context rewrite uses
  // the new stage's short message. U9 will replace this in-memory tracking
  // with the real `newSession` flow.
  const next = applyTransition(state, result.transition);
  if (next !== undefined) {
    store.set(next);
  }

  return {
    content: [{ type: "text", text: result.content }],
    details: { transition: result.transition },
  };
}

function applyTransition(
  state: RalphSessionState,
  transition: { ok: true; advancedTo?: StageId } | { ok: false; error: string },
): RalphSessionState | undefined {
  if (!transition.ok) return undefined;
  if (transition.advancedTo === undefined) return undefined;
  const completed = new Set(state.completedStages);
  completed.add(state.currentStage);
  return {
    ...state,
    currentStage: transition.advancedTo,
    completedStages: completed,
  };
}