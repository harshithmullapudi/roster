const OPTION_LINE = /^\s*(\d+)[.)]\s+(.+)$/;
const MAX_OPTIONS = 6;
const MAX_OPTION_LENGTH = 160;

export interface QuestionGroup {
  question: string | null;
  options: string[];
}

function cleanQuestion(line: string | null): string | null {
  if (!line) return null;
  const cleaned = line
    .replace(/^#+\s*/, "")
    .replace(/\*\*/g, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * The answer choices offered by an agent's message, one group per numbered
 * list, each labeled with the prose line above it. A list is only read as
 * choices when it starts at 1, runs without gaps, and every entry is short
 * enough to be an answer rather than a paragraph that happens to be
 * numbered. An agent can ask several things at once — every list in the
 * message becomes its own group.
 */
export function questionGroups(text: string): QuestionGroup[] {
  const groups: QuestionGroup[] = [];
  let current: QuestionGroup | null = null;
  let broken = false;
  let lastProse: string | null = null;

  const commit = () => {
    if (current && !broken && current.options.length >= 2) {
      groups.push({
        question: current.question,
        options: current.options.slice(0, MAX_OPTIONS),
      });
    }
    current = null;
    broken = false;
  };

  for (const line of text.split("\n")) {
    const match = OPTION_LINE.exec(line);

    if (!match) {
      if (line.trim().length > 0) {
        commit();
        lastProse = line;
      }
      continue;
    }

    const number = Number(match[1]);
    const option = match[2]!.trim();

    if (number === 1) {
      commit();
      current = { question: cleanQuestion(lastProse), options: [] };
      lastProse = null;
    } else if (!current || broken || number !== current.options.length + 1) {
      broken = true;
      continue;
    }

    if (option.length > MAX_OPTION_LENGTH) {
      broken = true;
      continue;
    }
    current?.options.push(option);
  }
  commit();

  return groups;
}

/**
 * One reply that answers every group, quoting each question above its
 * chosen answer so the agent can tell which answer belongs to which
 * question. A single unlabeled group needs no framing — the choice stands
 * on its own.
 */
export function combinedAnswer(
  groups: QuestionGroup[],
  choices: string[],
): string {
  if (groups.length === 1) return choices[0] ?? "";

  return groups
    .map((group, index) =>
      group.question
        ? `> ${group.question}\n${choices[index] ?? ""}`
        : (choices[index] ?? ""),
    )
    .join("\n\n");
}
