import type { SessionItem } from "./live-threads";
import { isLive, isWaiting, needsInput } from "./thread-rows";
import type { VisitedThread } from "./thread-history";

export const SWITCHER_LIMIT = 20;

/*
 * The order a person triages in: what is blocked on them, then what has
 * something new to read, then what is still going. A thread that has come to
 * rest with nothing unread is not in the list at all — it is done with you.
 */
export const GROUP_ORDER = ["needs-input", "turn-done", "running"] as const;

export type SwitcherGroup = (typeof GROUP_ORDER)[number];

const GROUP_LABEL: Record<SwitcherGroup, string> = {
  "needs-input": "Needs input",
  "turn-done": "Turn completed",
  running: "Running",
};

export function groupLabel(group: SwitcherGroup): string {
  return GROUP_LABEL[group];
}

export interface SwitcherItem {
  threadId: string;
  title: string;
  channelSlug: string;
  status: string;
  turnUnseen: boolean;
  href: string;
  group: SwitcherGroup;
  isCurrent: boolean;
}

export interface CycleKey {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
}

export type Step = "next" | "previous";

export function isCycleKey(event: CycleKey): boolean {
  // Matching the physical key rather than the character means Shift+Cmd+/
  // still reads as slash instead of as a question mark.
  if (event.code !== "Slash") return false;
  return event.metaKey || event.ctrlKey;
}

export function stepFor(
  event: CycleKey & { shiftKey: boolean },
  open: boolean,
): Step | null {
  if (isCycleKey(event)) return event.shiftKey ? "previous" : "next";

  // Arrows walk the list too, but only once the switcher is up — the modifier
  // is already down by then, and an arrow anywhere else belongs to the page.
  if (!open) return null;
  if (event.code === "ArrowDown") return "next";
  if (event.code === "ArrowUp") return "previous";
  return null;
}

export function isReleaseKey(event: { key: string }): boolean {
  return event.key === "Meta" || event.key === "Control";
}

export function isCancelKey(event: { key: string }): boolean {
  return event.key === "Escape";
}

export function initialIndex(items: SwitcherItem[]): number {
  // Cmd+Tab's whole trick: the first tap is already on the thing you left, so
  // tap-and-release toggles between the last two. Grouping moves the thread
  // you are in off the top, so find it rather than assuming where it sits.
  const index = items.findIndex((item) => !item.isCurrent);
  return index === -1 ? 0 : index;
}

export function cycleIndex(
  current: number,
  length: number,
  backwards: boolean,
): number {
  if (length < 2) return 0;
  const step = backwards ? -1 : 1;
  return (current + step + length) % length;
}

export function toSwitcherItems({
  history,
  sessions,
  currentThreadId,
}: {
  history: VisitedThread[];
  sessions: SessionItem[];
  currentThreadId: string | null;
}): SwitcherItem[] {
  const live = new Map(sessions.map((session) => [session.id, session]));

  const fromSession = (session: SessionItem): SwitcherItem | null => {
    const group = groupOf(session.status, session.turnUnseen);
    if (!group) return null;

    return {
      threadId: session.id,
      title: session.title,
      channelSlug: session.channelSlug,
      status: session.status,
      turnUnseen: session.turnUnseen,
      href: session.href,
      group,
      isCurrent: session.id === currentThreadId,
    };
  };

  const items: SwitcherItem[] = [];

  // History supplies the order, not the membership: a thread that has come to
  // rest with its last turn read is finished with you, and putting it in the
  // list only makes you flick past it.
  for (const entry of history) {
    const session = live.get(entry.threadId);
    if (!session) continue;

    const item = fromSession(session);
    if (item) items.push(item);
  }

  const visited = new Set(history.map((entry) => entry.threadId));
  for (const session of sessions) {
    if (visited.has(session.id)) continue;

    const item = fromSession(session);
    if (item) items.push(item);
  }

  // Most recent first inside each group, groups in triage order. Order here is
  // the order the gesture walks, so the list cannot disagree with what a tap
  // does.
  const ordered = GROUP_ORDER.flatMap((group) =>
    items.filter((item) => item.group === group),
  );

  return ordered.slice(0, SWITCHER_LIMIT);
}

// Same precedence the sessions count uses: what a thread is doing now beats an
// unread turn behind it. Only the order the groups are shown in differs. Null
// is a thread with nothing left to show you, which the switcher leaves out.
function groupOf(status: string, turnUnseen: boolean): SwitcherGroup | null {
  if (needsInput(status)) return "needs-input";
  if (isLive(status) || isWaiting(status)) return "running";
  if (turnUnseen) return "turn-done";
  return null;
}
