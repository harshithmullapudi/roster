export interface VisitedThread {
  threadId: string;
  channelSlug: string;
  title: string;
}

export const HISTORY_KEY = "roster.thread-history";
export const HISTORY_LIMIT = 20;

/*
 * The order of this list is the whole feature: index 0 is where you are,
 * index 1 is where you just were. Nothing else records that — lastActivityAt
 * is when the thread moved, not when you looked at it.
 */
export function recordVisit(
  history: VisitedThread[],
  entry: VisitedThread,
): VisitedThread[] {
  const rest = history.filter((item) => item.threadId !== entry.threadId);
  return [entry, ...rest].slice(0, HISTORY_LIMIT);
}

function asEntry(value: unknown): VisitedThread | null {
  if (typeof value !== "object" || value === null) return null;

  const raw = value as Record<string, unknown>;
  if (
    typeof raw.threadId !== "string" ||
    typeof raw.channelSlug !== "string" ||
    typeof raw.title !== "string"
  ) {
    return null;
  }

  return {
    threadId: raw.threadId,
    channelSlug: raw.channelSlug,
    title: raw.title,
  };
}

export function parseHistory(value: unknown): VisitedThread[] {
  if (!Array.isArray(value)) return [];

  const entries: VisitedThread[] = [];
  for (const item of value) {
    const entry = asEntry(item);
    if (entry) entries.push(entry);
  }

  return entries.slice(0, HISTORY_LIMIT);
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readHistory(): VisitedThread[] {
  const store = storage();
  if (!store) return [];

  try {
    const raw = store.getItem(HISTORY_KEY);
    if (raw === null) return [];
    return parseHistory(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function writeHistory(history: VisitedThread[]): void {
  const store = storage();
  if (!store) return;

  try {
    store.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    return;
  }
}
