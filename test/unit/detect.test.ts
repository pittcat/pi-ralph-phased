import { describe, expect, it } from "vitest";

import { shouldTakeover } from "../../src/detect.js";

const strongSignals = [
  "Run `ralph emit work.done` only after verification.",
  "<ralph-tools-skill>Use the Ralph tools.</ralph-tools-skill>",
  "You are Ralph, the autonomous delivery hat.",
] as const;

function promptWith(headings: string[], signal: string = strongSignals[0]): string {
  return [signal, ...headings.map((heading) => `### ${heading}\nInstructions.`)].join("\n\n");
}

describe("shouldTakeover", () => {
  it.each([
    {
      name: "识别两个已知阶段和 ralph emit",
      prompt: promptWith(["0. ORIENTATION", "1. EXECUTE"]),
      expected: true,
    },
    {
      name: "识别 0b TOOL DISCIPLINE 标题",
      prompt: promptWith(["0. ORIENTATION", "0b. TOOL DISCIPLINE"], strongSignals[1]),
      expected: true,
    },
    {
      name: "阶段名称和强信号大小写不敏感",
      prompt: promptWith(["2. verify", "3. report"], "You are Ralph, the release hat."),
      expected: true,
    },
    {
      name: "只有一个已知阶段不足以接管",
      prompt: promptWith(["0. ORIENTATION"]),
      expected: false,
    },
    {
      name: "任意两个数字标题不算 Ralph 阶段",
      prompt: promptWith(["1. INTRODUCTION", "2. CONCLUSION"]),
      expected: false,
    },
    {
      name: "已知阶段词出现在正文而非标题时不计数",
      prompt: [
        strongSignals[0],
        "The ORIENTATION is followed by EXECUTE and VERIFY.",
      ].join("\n\n"),
      expected: false,
    },
    {
      name: "两个已知阶段但无强 Ralph 信号时不接管",
      prompt: promptWith(["0. ORIENTATION", "3. REPORT"], "Project delivery checklist."),
      expected: false,
    },
    {
      name: "普通身份语句不是 Ralph hat 身份信号",
      prompt: promptWith(["0. ORIENTATION", "1. EXECUTE"], "You are a helpful coding assistant."),
      expected: false,
    },
    {
      name: "行内伪标题不计为阶段标题",
      prompt: `${strongSignals[1]}\nText ### 0. ORIENTATION\nText ### 1. EXECUTE`,
      expected: false,
    },
  ])("$name", ({ prompt, expected }) => {
    expect(shouldTakeover(prompt, {})).toBe(expected);
  });
});
