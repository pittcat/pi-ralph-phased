# Scaffold decisions and unresolved items

This repository currently contains structure, contracts, and safe defaults only.
It does **not** claim that plan scenarios S1–S15 are implemented.

## Decisions fixed by the scaffold

- TypeScript ESM, Node 22.19+, Vitest, and the Pi extension entry at
  `src/index.ts`.
- Domain modules do not import Pi runtime types. Pi-specific wiring stays in the
  entrypoint/adapter layer.
- Until detection and context-rewrite tests pass, takeover is disabled and the
  extension registers no hooks. This preserves pass-through behavior.
- `ralph_stage_done` domain execution is separate from its TypeBox/Pi tool
  definition. Pi already depends on TypeBox, so U7/U8 may use the host schema
  type without inventing a second validator.

## Unresolved implementation decisions

1. **Resolved: `agent_settled` does not call `newSession` on Pi 0.81.1.**
   Event handlers receive `ExtensionContext`, so stage continuation uses the
   event-safe `ExtensionAPI.sendUserMessage`. The `context` hook returns only
   the current stage kickoff after a stage completes, preventing prior-stage
   history from reaching the model without an unsafe context cast.
2. **Deferred skill delivery in EXECUTE:** inline the extracted XML (plan
   recommendation) or require a file read. Recommendation: inline it because it
   is execution-critical and avoids reliance on model tool compliance. U3 tests
   must lock the choice.
3. **Emit behavior when `publishTopics` is empty:** recommendation is to avoid
   blocking unless a small, explicit terminal-topic whitelist matches. Blocking
   every `ralph emit` risks suppressing non-terminal protocol events. U6 tests
   must define the whitelist and shell-command variants.
4. **Detection/parser coupling:** recommendation is that takeover requires both
   a strong detector match and a non-null parse with at least two known stages.
   This favors false negatives over false positives.
5. **Prompt persistence lifecycle:** the plan chooses an OS temp directory but
   does not define permissions, filename entropy, cleanup timing, or crash
   cleanup. U5 should use a private temporary directory (mode `0700` where
   supported), unpredictable names, and document best-effort cleanup.
6. **Multiple activations in one process:** the plan calls for in-memory state
   but does not define whether overlapping or sequential hats share an
   extension instance. U8 needs a state key and explicit reset rules before the
   single-slot store is relied upon.
7. **Smoke-test contract:** `pi -e ... --help` proves loading without a model.
   The planned short-prompt output assertion requires usable model credentials
   and a deterministic model response. U11 should separate credential-free load
   smoke from credentialed/manual behavioral smoke.

## Verified Pi API facts

Against locally installed `@earendil-works/pi-coding-agent` 0.81.1:

- `before_agent_start` may return only `message` and/or `systemPrompt`; it cannot
  replace `event.prompt`.
- `context` may return `{ messages }`.
- `tool_call` may return `{ block, reason }`.
- `registerTool` accepts a TypeBox-backed tool definition.
