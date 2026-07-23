/**
 * Domain contracts shared by the parser, prompt builder, and state machine.
 *
 * Keep this module free of Pi runtime types. The pure domain should remain
 * testable without loading the extension host.
 */
export type StageId =
  | "orientation"
  | "tool_discipline"
  | "execute"
  | "verify"
  | "report";

export interface RalphStage {
  id: StageId;
  title: string;
  body: string;
}

export interface DeferredSkill {
  /** XML element name, for example `ralph-tools-skill`. */
  name: string;
  /** Exact source text, retained so deferral never silently loses rules. */
  source: string;
}

export interface ParsedRalphPrompt {
  preamble: string;
  stages: RalphStage[];
  deferredSkills: DeferredSkill[];
  publishTopics: string[];
}

export interface RalphSessionState {
  originalPrompt: string;
  fullPromptPath: string;
  parsed: ParsedRalphPrompt;
  currentStage: StageId;
  completedStages: ReadonlySet<StageId>;
  pendingAdvance: boolean;
}
