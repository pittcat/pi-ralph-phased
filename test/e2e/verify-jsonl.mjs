import { readFileSync } from "node:fs";

const outputPath = process.argv[2];
if (!outputPath) {
  console.error("usage: node test/e2e/verify-jsonl.mjs <pi-jsonl-output>");
  process.exit(2);
}

const events = readFileSync(outputPath, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`invalid JSON on output line ${index + 1}`);
    }
  });

const stages = events
  .filter((event) =>
    event.type === "tool_execution_start" &&
    event.toolName === "ralph_stage_done")
  .map((event) => event.args)
  .map((args) => typeof args === "string" ? JSON.parse(args).stage : args.stage)
  .filter(Boolean);
const expected = ["orientation", "tool_discipline", "execute", "verify", "report"];

if (JSON.stringify(stages) !== JSON.stringify(expected)) {
  console.error(`FAIL: expected stage calls ${expected.join(" -> ")}, got ${stages.join(" -> ") || "(none)"}`);
  process.exit(1);
}

const agentEnds = events.filter((event) => event.type === "agent_end").length;
if (agentEnds < 1) {
  console.error("FAIL: no agent_end event was observed.");
  process.exit(1);
}

if (!events.some((event) =>
  event.type === "message_end" &&
  event.message?.role === "assistant" &&
  event.message.content?.some?.((part) =>
    part.type === "text" && part.text === "RALPH_PHASED_COMPLETE"))) {
  console.error("FAIL: terminal RALPH_PHASED_COMPLETE response was not observed.");
  process.exit(1);
}

const rejected = events.filter((event) =>
  event.type === "tool_execution_end" &&
  event.toolName === "ralph_stage_done" &&
  (event.isError === true || event.result?.details?.ok === false));
if (rejected.length > 0) {
  console.error(`FAIL: ${rejected.length} ralph_stage_done call(s) were rejected.`);
  process.exit(1);
}

console.log(`PASS: observed ${stages.join(" -> ")} and clean terminal completion.`);
