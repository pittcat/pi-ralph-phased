import type { DeferredSkill, ParsedRalphPrompt, RalphStage, StageId } from "./types.js";

const STAGE_HEADINGS = /^(?:0\s*\.\s*)?ORIENTATION$|^0\s*b\s*\.\s*TOOL[\s_-]+DISCIPLINE$|^1\s*\.\s*EXECUTE$|^2\s*\.\s*VERIFY$|^3\s*\.\s*REPORT$/i;
const STAGE_IDS: Readonly<Record<string, StageId>> = {
  orientation: "orientation",
  "tool discipline": "tool_discipline",
  execute: "execute",
  verify: "verify",
  report: "report",
};
const SKILL_XML = /<((?:ralph-tools-[\w-]*skill))(?:\s[^>]*)?>[\s\S]*?<\/\1\s*>/gi;

function stageFromHeading(raw: string): { id: StageId; title: string } | null {
  const title = raw.trim().replace(/\s+/g, " ");
  if (!STAGE_HEADINGS.test(title)) return null;
  const normalized = title.replace(/^\d\s*b?\s*\.\s*/i, "").replace(/^0\s*\.\s*/i, "").trim().toLowerCase().replace(/[_-]+/g, " ");
  const id = STAGE_IDS[normalized];
  return id ? { id, title } : null;
}

export function parseRalphPrompt(prompt: string): ParsedRalphPrompt | null {
  const deferredSkills: DeferredSkill[] = [];
  const withoutSkills = prompt.replace(SKILL_XML, (source, name: string) => {
    deferredSkills.push({ name, source });
    return "";
  });
  const heading = /^###\s+(.+?)\s*$/gm;
  const matches = [...withoutSkills.matchAll(heading)]
    .map((match) => {
      const parsed = stageFromHeading(match[1] ?? "");
      return parsed ? { ...parsed, index: match.index ?? 0, end: (match.index ?? 0) + match[0].length } : null;
    })
    .filter((match): match is { id: StageId; title: string; index: number; end: number } => match !== null);
  if (matches.length < 2) return null;

  const stages: RalphStage[] = matches.map((match, index) => ({
    id: match.id,
    title: match.title,
    body: withoutSkills.slice(match.end, matches[index + 1]?.index ?? withoutSkills.length).trim(),
  }));
  const preamble = withoutSkills.slice(0, matches[0]?.index ?? 0).trim();
  const publishTopics: string[] = [];
  const topicPattern = /(?:publishes|you publish to)\s*:\s*([^\n]+)/gi;
  for (const match of withoutSkills.matchAll(topicPattern)) {
    for (const topic of (match[1] ?? "").split(/[,\s]+/)) {
      const cleaned = topic.trim().replace(/[.`]+$/g, "");
      if (cleaned && !publishTopics.includes(cleaned)) publishTopics.push(cleaned);
    }
  }
  return { preamble, stages, deferredSkills, publishTopics };
}
