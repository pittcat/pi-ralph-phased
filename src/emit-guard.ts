// U6 policy (locked by tests in test/unit/emit-guard.test.ts and
// test/atdd/emit-guard.atdd.test.ts):
//   * stageIsLast === true  -> always { block: false }. The actual final
//     stage must be free to emit terminal events.
//   * publishTopics empty    -> never block on the non-last path; the
//     policy prefers false negatives when the operator did not declare
//     topics.
//   * non-last + non-empty publishTopics -> block ONLY when the shell
//     command actually invokes `ralph emit <topic>` (or `$RALPH_BIN emit
//     <topic>` or an executable path whose basename is `ralph` followed
//     by `emit`) AND the literal token at the emit position is one of
//     publishTopics.
//   * When blocked, the reason mentions the offending topic and the
//     non-terminal-stage constraint so downstream callers can surface it.
//
// Heuristic limits explicitly accepted (test file documents them too):
//   - A bounded shell tokenizer: we split on shell metacharacters while
//     respecting single/double quotes so quoted topic tokens like
//     `'work.done'` and `"work.done"` are extracted verbatim. We do not
//     claim a complete POSIX shell parser.
//   - Plain text mentioning `ralph emit` inside JSON / comments / echo
//     arguments does NOT count as an emit invocation: those tokens end
//     up as the value of an echo/printf/comment and never reach a token
//     position immediately following `emit` in the command stream.
export interface EmitGuardInput {
  stageIsLast: boolean;
  command: string;
  publishTopics: readonly string[];
}

export interface EmitGuardDecision {
  block: boolean;
  reason?: string;
}

const SHELL_METACHARS = /[|&;()<>\s]/;

/**
 * Recognize a POSIX shell-style line comment. We treat `#` as a comment
 * introducer only when it appears at the very start of the command or
 * immediately after a shell metacharacter / whitespace boundary — so
 * `echo a#b` is NOT misread as a comment, but a top-of-line `# ralph
 * emit work.done` is.
 */
function isCommentStart(command: string, index: number): boolean {
  if (command[index] !== "#") return false;
  if (index === 0) return true;
  const prev = command[index - 1] ?? "";
  return SHELL_METACHARS.test(prev);
}

/**
 * Tokenize a shell command line into argv-like tokens while keeping
 * single- and double-quoted spans intact. This is intentionally a small
 * bounded tokenizer: it is NOT a complete POSIX shell parser, but it
 * covers the variants our tests lock (env assignments, quoted topics,
 * command chains via `&&` / `;` / `|`, executable absolute paths).
 *
 * Quotes that wrap an entire token are stripped; nested escapes are not
 * modeled. Backslash escapes inside double quotes are passed through
 * literally (we keep the surrounding double-quote form so the comparison
 * can still see the topic); inside single quotes, the content is kept
 * verbatim.
 */
function tokenizeShell(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inToken = false;
  let quote: "'" | '"' | null = null;

  const flush = () => {
    if (inToken) {
      tokens.push(current);
      current = "";
      inToken = false;
    }
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i] ?? "";

    if (isCommentStart(command, i)) {
      // Drop any token we started on this line and skip to the next
      // newline (or end of input). Subsequent lines of a multiline
      // command are still scanned — only the rest of THIS line is
      // discarded.
      current = "";
      inToken = false;
      const newline = command.indexOf("\n", i);
      if (newline === -1) break;
      i = newline; // the for-loop's i += 1 will move us to the next char
      continue;
    }

    if (quote !== null) {
      // Inside a quoted span: closing quote ends the span.
      if (ch === quote) {
        quote = null;
        inToken = true; // the current token keeps what we collected
      } else {
        current += ch;
        inToken = true;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      // Quote character: enter quoted mode, do not add the quote itself.
      quote = ch;
      inToken = true;
      continue;
    }

    if (SHELL_METACHARS.test(ch)) {
      flush();
      continue;
    }

    current += ch;
    inToken = true;
  }

  flush();
  return tokens;
}

/**
 * Return the basename of a path-like token so `/usr/local/bin/ralph`
 * matches the `ralph` keyword. Falls back to the original token when no
 * slash is present.
 */
function basename(token: string): string {
  const slash = token.lastIndexOf("/");
  return slash >= 0 ? token.slice(slash + 1) : token;
}

/**
 * Look for `ralph emit <topic>` (or `$RALPH_BIN emit <topic>` /
 * `/path/to/ralph emit <topic>`) in the token stream and return the
 * literal topic token if found, otherwise null. Strips a single layer
 * of surrounding single/double quotes from the topic token for
 * comparison.
 */
function findEmitTopic(tokens: readonly string[]): string | null {
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const head = tokens[i] ?? "";
    // `$RALPH_BIN` is the documented way Ralph itself invokes emit.
    // Plain `ralph` and an executable basename of `ralph` both qualify.
    const isRalphInvocation =
      head === "$RALPH_BIN" ||
      head === "ralph" ||
      basename(head) === "ralph";
    if (!isRalphInvocation) continue;

    const subcommand = tokens[i + 1] ?? "";
    if (subcommand !== "emit") continue;

    const topicToken = tokens[i + 2];
    if (topicToken === undefined) return null;

    // Strip one layer of matching single or double quotes so we compare
    // the actual topic, not its quoted form.
    if (
      topicToken.length >= 2 &&
      ((topicToken.startsWith("'") && topicToken.endsWith("'")) ||
        (topicToken.startsWith('"') && topicToken.endsWith('"')))
    ) {
      return topicToken.slice(1, -1);
    }
    return topicToken;
  }
  return null;
}

/** Decide whether a `ralph emit <topic>` invocation in `command` is a
 * terminal business event the guard should block before the final stage.
 *
 * The function is pure: it reads only its inputs and never mutates the
 * `publishTopics` array (which is typed `readonly`). It does not perform
 * IO, does not import Pi runtime types, and does not advance any state.
 */
export function shouldBlockTerminalEmit(
  input: EmitGuardInput,
): EmitGuardDecision {
  if (input.stageIsLast) {
    return { block: false };
  }

  if (input.publishTopics.length === 0) {
    // No declared topics — refuse to guess.
    return { block: false };
  }

  const tokens = tokenizeShell(input.command);
  const observedTopic = findEmitTopic(tokens);
  if (observedTopic === null) {
    return { block: false };
  }

  if (!input.publishTopics.includes(observedTopic)) {
    return { block: false };
  }

  return {
    block: true,
    reason: `Terminal emit blocked: 'ralph emit ${observedTopic}' is not allowed before the final stage. Complete remaining stages or wait for the actual last stage before publishing '${observedTopic}'.`,
  };
}