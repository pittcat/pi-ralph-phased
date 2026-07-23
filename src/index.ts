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
import { advanceAfterSettled, type SessionAdvancePort } from "./advance.js";
import {
  resolveToolCallGuard,
  type ToolCallGuardPort,
  type ToolCallEventShape,
} from "./tool-call-guard.js";
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
 * - U9 (agent_settled, newSession, sendUserMessage, waitForIdle) is now
 *   registered below — `agent_settled` calls `advanceAfterSettled` which
 *   only reads `waitForIdle?/newSession/sendUserMessage?` off the host
 *   context (Fake or real Pi).
 * - U10 (tool_call emit guard) — also registered below. It only listens to
 *   the `bash` (and `shell` alias) tool, derives `stageIsLast` /
 *   `command` / `publishTopics` from the in-memory session state, and
 *   delegates to the pure `shouldBlockTerminalEmit` seam. When no active
 *   session exists (kill-switch S2 path), it returns `undefined` so the
 *   call passes through untouched.
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

  pi.on("agent_settled" as never, (((event: unknown, ctx: unknown) =>
    handleAgentSettled(event, ctx, store)) as unknown) as never);

  pi.on("tool_call" as never, (((event: unknown, ctx: unknown) =>
    handleToolCall(event, ctx, store)) as unknown) as never);

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

/**
 * U9 handler for `agent_settled`.
 *
 * After every model turn, Pi delivers an `agent_settled` event. We translate
 * that into an awaited host session-port call so the next stage begins in a
 * fresh session — the only mechanism that actually resets Pi's accumulated
 * --no-session history. Sending another user message here would merely stack
 * tokens; the plan and S11 explicitly forbid that. S12 forbids advancing on
 * the actual last stage.
 *
 * The Pi 0.81.1 `ExtensionContext` typed for `agent_settled` does NOT expose
 * `newSession`, `sendUserMessage`, or `waitForIdle` (those appear only on
 * `ExtensionCommandContext`). Until a runtime spike proves the surface in the
 * real handler — see docs/SCAFFOLD_DECISIONS.md item 1 — we cast through
 * `unknown`. The Fake's FakeAgentSettledContext satisfies the same shape.
 */
async function handleAgentSettled(
  _event: unknown,
  ctx: unknown,
  store: SessionStateStore,
): Promise<void> {
  const state = store.active ?? readSeededState(ctx);
  if (state === undefined) return;

  const port = ctx as SessionAdvancePort;
  await advanceAfterSettled(state, port);
}

/**
 * Test-only fallback: when a host wires the agent_settled ctx with a
 * `{ store?: { active?: RalphSessionState } }` property, prefer that seeded
 * state over the empty in-process store. Production Pi 0.81.1 never sets
 * this — the field stays `undefined` and we fall through to the regular
 * store. U9 ATDD uses this to drive `agent_settled` without going through
 * `before_agent_start` (and thus without writing a tmp file the U8
 * first-turn diff snapshot is sensitive to).
 */
function readSeededState(ctx: unknown): RalphSessionState | undefined {
  if (ctx === null || typeof ctx !== "object") return undefined;
  const store = (ctx as { store?: { active?: RalphSessionState | undefined } }).store;
  return store?.active;
}

/**
 * U10 — `tool_call` handler. Delegates to the pure
 * {@link resolveToolCallGuard} seam and returns whatever it returns
 * (possibly `undefined` for pass-through, or `{ block: true, reason }` on
 * the non-last-path early-emit block). The handler MUST NOT mutate the
 * session state on a block — S13 requires that the current stage is left
 * uncompleted.
 *
 * Pi's `tool_call` event shape is reduced to `{ toolName, args }` here; the
 * pure seam is responsible for field selection (`command` vs `cmd`,
 * `toolName` allowlist). Real Pi 0.81.1 documents that a `tool_call`
 * handler returning `{ block: true }` cancels execution; returning
 * `undefined` lets the tool proceed.
 */
function handleToolCall(
  event: unknown,
  ctx: unknown,
  store: SessionStateStore,
): unknown {
  // Defensive: if Pi ever delivers an event without a useful shape, we
  // pass through rather than throw. The pure seam will also bail out.
  if (event === null || typeof event !== "object") return undefined;
  const ev = event as Partial<ToolCallEventShape>;
  if (typeof ev.toolName !== "string") return undefined;
  const args: Record<string, unknown> =
    ev.args !== undefined && typeof ev.args === "object" && ev.args !== null
      ? (ev.args as Record<string, unknown>)
      : {};

  const port: ToolCallGuardPort = {
    activeState: () => store.active ?? readSeededState(ctx),
    markStageDone: () => {
      // Reserved seam. Per plan, blocking a tool_call MUST NOT implicitly
      // complete the current stage; the model must call ralph_stage_done
      // explicitly.
    },
  };

  return resolveToolCallGuard({ toolName: ev.toolName, args }, port);
}
