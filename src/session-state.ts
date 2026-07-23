import type { RalphSessionState } from "./types.js";

/**
 * Process-local state holder for Pi print/headless mode.
 *
 * U8 must decide the state key/lifetime for multiple runs in one process and
 * clear state on pass-through prompts and session replacement.
 */
export class SessionStateStore {
  #active: RalphSessionState | undefined;

  get active(): RalphSessionState | undefined {
    return this.#active;
  }

  set(state: RalphSessionState): void {
    this.#active = state;
  }

  clear(): void {
    this.#active = undefined;
  }
}
