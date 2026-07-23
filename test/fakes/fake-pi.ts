/**
 * U8 Fake Pi: minimal stand-in for the ExtensionAPI surface used by this unit.
 *
 * Only records `on(event, handler)` registrations and `registerTool(name, def)`
 * calls, plus enough state to replay the events the tests need to drive.
 * Deliberately omits `newSession`, `sendUserMessage`, `waitForIdle`, and any
 * session-control surface — U9 will own those.
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

interface FakeHandlerRegistry {
  "before_agent_start": FakeBeforeAgentStartHandler[];
  "context": FakeContextHandler[];
}

export class FakeExtensionAPI {
  readonly #handlers: FakeHandlerRegistry = {
    "before_agent_start": [],
    "context": [],
  };
  readonly #tools: FakeRegisteredTool[] = [];

  on(event: "before_agent_start", handler: FakeBeforeAgentStartHandler): void;
  on(event: "context", handler: FakeContextHandler): void;
  on(event: string, handler: (...args: unknown[]) => unknown): void;
  on(
    event: "before_agent_start" | "context" | string,
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
    throw new Error(`FakeExtensionAPI: unsupported event '${event}'`);
  }

  registerTool(definition: { name: string } & Record<string, unknown>): void {
    this.#tools.push({ name: definition.name, definition });
  }

  hasHandler(event: "before_agent_start" | "context"): boolean {
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
}