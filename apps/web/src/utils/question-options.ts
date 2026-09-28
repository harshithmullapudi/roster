const OPTION_LINE = /^\s*(\d+)[.)]\s+(.+)$/;
const MAX_OPTIONS = 6;
const MAX_OPTION_LENGTH = 160;

/**
 * The answer choices offered by an agent's question, when its message ends in
 * a numbered list. A list is only read as choices when it starts at 1, runs
 * without gaps, and every entry is short enough to be an answer rather than a
 * paragraph that happens to be numbered.
 */
export function questionOptions(text: string): string[] {
  const options: string[] = [];

  for (const line of text.split("\n")) {
    const match = OPTION_LINE.exec(line);
    if (!match) continue;

    const number = Number(match[1]);
    if (number !== options.length + 1) {
      if (number === 1) options.length = 0;
      else return [];
    }
    if (number === 1) options.length = 0;

    const option = match[2]!.trim();
    if (option.length > MAX_OPTION_LENGTH) return [];
    options.push(option);
  }

  if (options.length < 2) return [];
  return options.slice(0, MAX_OPTIONS);
}
