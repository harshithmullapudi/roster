const HIT_OPEN = "\u0002";
const HIT_CLOSE = "\u0003";

/*
 * Postgres marks the matched words for us. It marks them with sentinels rather
 * than with <mark>, because a snippet carries whatever the author typed: a
 * snippet that arrived as HTML would have to be injected as HTML to render.
 */
export const HEADLINE_OPTIONS = [
  `StartSel=${HIT_OPEN}`,
  `StopSel=${HIT_CLOSE}`,
  "MaxWords=24",
  "MinWords=10",
].join(", ");

export interface SnippetSegment {
  text: string;
  hit: boolean;
}

const MAX_TERMS = 10;

export function toTsQuery(raw: string): string | null {
  const tokens = raw.trim().split(/\s+/).slice(0, MAX_TERMS);

  const parts: string[] = [];
  let positives = 0;

  tokens.forEach((token, index) => {
    const negated = token.startsWith("-");
    const word = token.replace(/[^\p{L}\p{N}]/gu, "");
    if (word.length === 0) return;

    if (negated) {
      parts.push(`!${word}`);
      return;
    }

    positives += 1;
    parts.push(index === tokens.length - 1 ? `${word}:*` : word);
  });

  if (positives === 0) return null;

  return parts.join(" & ");
}

export function toSegments(headline: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  let rest = headline;

  while (rest.length > 0) {
    const open = rest.indexOf(HIT_OPEN);
    if (open === -1) {
      segments.push({ text: rest, hit: false });
      break;
    }

    if (open > 0) segments.push({ text: rest.slice(0, open), hit: false });

    const close = rest.indexOf(HIT_CLOSE, open);
    if (close === -1) {
      segments.push({ text: rest.slice(open + HIT_OPEN.length), hit: true });
      break;
    }

    segments.push({
      text: rest.slice(open + HIT_OPEN.length, close),
      hit: true,
    });
    rest = rest.slice(close + HIT_CLOSE.length);
  }

  return segments.filter((segment) => segment.text.length > 0);
}
