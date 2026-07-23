/**
 * U8+U9 Fake Pi: minimal stand-in for the ExtensionAPI surface used by these
 * units.
 *
 * Only records `on(event, handler)` registrations and `registerTool(name, def)`
 * calls, plus enough state to replay the events the tests need to drive.
 *
 * U9 widening: the fake now also records `agent_settled` handlers and exposes
 * a `FakeSessionPort` that can be driven through `invokeAgentSettled` so the
 * extension advance path can be asserted without instantiating a real Pi
 * runtime. The port keeps a chronological list of every
 * `newSession`/`sendUserMessage`/`waitForIdle` invocation.
 *
 * Deliberately still omits any persistence, message-store, or provider-side
 * surface — U11 will own those.
 *
 * The fake intentionally does NOT `implements Pick<ExtensionAPI, ...>` because
 * the official Pi interface has dozens of overloads that would force every
 * fake method to mirror Pi's full surface. Instead we declare the minimal
 * structural shape the extension consumes and cast at the boundary.
 */
export interface FakeRegisteredTool {
  name: string;
  definition: Record<string, unknown>;
}

interface FakeBeforeAgentStartHandler {
  (event: unknown, ctx: unknown): unknown;
}

interface FakeContextHandler {
  (event: unknown, ctx: unknown): unknown;
}

interface FakeAgentSettledHandler {
  (event: unknown, ctx: unknown): unknown;
}

/**
 * Structural shape exposed to `agent_settled` handlers in U9. The real Pi
 * `ExtensionContext` does NOT declare `newSession`, `sendUserMessage`, or
 * `waitForIdle` — those only appear on `ExtensionCommandContext` per the
 * 0.81.1 types. The Fake therefore documents the gap explicitly and exposes
 * the methods only because we have not yet proven a single-context shape on
 * real Pi. See docs/SCAFFOLD_DECISIONS.md, item 1.
 *
 * The fake mirrors the documented Pi surface so the unit tests can assert on
 * the same call shape real Pi will eventually expose (or so we can prove the
 * runtime refutes the surface and we fall back to a different mechanism).
 */
export interface FakeAgentSettledContext {
  newSession(options: { kickoff: string }): Promise<void>;
  sendUserMessage?(text: string): Promise<void>;
  waitForIdle?(): Promise<void>;
}

interface FakeHandlerRegistry {
  "before_agent_start": FakeBeforeAgentStartHandler[];
  "context": FakeContextHandler[];
  "agent_settled": FakeAgentSettledHandler[];
}

/**
 * Call record kept by `FakeSessionPort` so tests can assert both count and
 * ordering of `newSession`/`sendUserMessage`/`waitForIdle` invocations.
 */
export interface FakeSessionCallRecord {
  kind: "waitForIdle" | "newSession" | "sendUserMessage";
  order: number;
  kickoff?: string;
  text?: string;
}

export class FakeSessionPort {
  readonly calls: FakeSessionCallRecord[] = [];
  #order = 0;

  async newSession(options: { kickoff: string }): Promise<void> {
    this.#order += 1;
    this.calls.push({ kind: "newSession", order: this.#order, kickoff: options.kickoff });
  }

  async sendUserMessage(text: string): Promise<void> {
    this.#order += 1;
    this.calls.push({ kind: "sendUserMessage", order: this.#order, text });
  }

  async waitForIdle(): Promise<void> {
    this.#order += 1;
    this.calls.push({ kind: "waitForIdle", order: this.#order });
  }

  newSessionCalls(): FakeSessionCallRecord[] {
    return this.calls.filter((c) => c.kind === "newSession");
  }

  sendUserMessageCalls(): FakeSessionCallRecord[] {
    return this.calls.filter((c) => c.kind === "sendUserMessage");
  }

  waitForIdleCalls(): FakeSessionCallRecord[] {
    return this.calls.filter((c) => c.kind === "waitForIdle");
  }
}

/**
 * Lightweight store contract that the extension uses to keep per-process
 * Ralph activation state. The Fake exposes a setter so U9 tests can pre-fill
 * the store without invoking `before_agent_start` (which would otherwise
 * write a tmp file the U8 first-turn ATDD diff-snapshot is sensitive to).
 */
export interface FakeRalphSessionStateLike {
  currentStage: string;
  completedStages: ReadonlySet<string>;
  parsed: unknown;
  fullPromptPath: string;
}

export class FakeSessionStore {
  #state: FakeRalphSessionStateLike | undefined;

  get active(): FakeRalphSessionStateLike | undefined {
    return this.#state;
  }

  set(state: FakeRalphSessionStateLike | undefined): void {
    this.#state = state;
  }
}

export class FakeExtensionAPI {
  readonly #handlers: FakeHandlerRegistry = {
    "before_agent_start": [],
    "context": [],
    "agent_settled": [],
  };
  readonly #tools: FakeRegisteredTool[] = [];
  readonly session: FakeSessionPort = new FakeSessionPort();
  readonly store: FakeSessionStore = new FakeSessionStore();

  on(event: "before_agent_start", handler: FakeBeforeAgentStartHandler): void;
  on(event: "context", handler: FakeContextHandler): void;
  on(event: "agent_settled", handler: FakeAgentSettledHandler): void;
  on(event: string, handler: (...args: unknown[]) => unknown): void;
  on(
    event: "before_agent_start" | "context" | "agent_settled" | string,
    handler: (...args: unknown[]) => unknown,
  ): void {
    if (event === "before_agent_start") {
      this.#handlers["before_agent_start"].push(handler as FakeBeforeAgentStartHandler);
      return;
    }
    if (event === "context") {
      this.#handlers["context"].push(handler as FakeContextHandler);
      return;
    }
    if (event === "agent_settled") {
      this.#handlers["agent_settled"].push(handler as FakeAgentSettledHandler);
      return;
    }
    throw new Error(`FakeExtensionAPI: unsupported event '${event}'`);
  }

  registerTool(definition: { name: string } & Record<string, unknown>): void {
    this.#tools.push({ name: definition.name, definition });
  }

  hasHandler(event: "before_agent_start" | "context" | "agent_settled"): boolean {
    return this.#handlers[event].length > 0;
  }

  registeredTools(): FakeRegisteredTool[] {
    return [...this.#tools];
  }

  async invokeBeforeAgentStart(event: unknown): Promise<unknown> {
    const ctx = {};
    for (const handler of this.#handlers["before_agent_start"]) {
      const result = await handler(event, ctx);
      if (result !== undefined) return result;
    }
    return undefined;
  }

  async invokeContext(event: unknown): Promise<unknown> {
    const ctx = {};
    for (const handler of this.#handlers["context"]) {
      const result = await handler(event, ctx);
      if (result !== undefined) return result;
    }
    return undefined;
  }

  async invokeAgentSettled(event: unknown = {}): Promise<unknown> {
    // The extension's `handleAgentSettled` reads `ctx.store?.active` as a
    // test-only fallback so ATDD can drive `agent_settled` without going
    // through `before_agent_start` (which would otherwise write a tmp file
    // to the shared OS tmpdir and race with U8's first-turn snapshot).
    // Real Pi 0.81.1 never exposes `store` on the agent_settled ctx, so the
    // production path is unaffected.
    const ctx: FakeAgentSettledContext & { store: FakeSessionStore } = Object.assign(
      this.session as unknown as FakeAgentSettledContext,
      { store: this.store },
    );
    for (const handler of this.#handlers["agent_settled"]) {
      const result = await handler(event, ctx);
      if (result !== undefined) return result;
    }
    return undefined;
  }
}
