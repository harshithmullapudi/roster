import type { SessionItem } from "./live-threads";
import type { VisitedThread } from "./thread-history";

export const SWITCHER_LIMIT = 20;

export interface SwitcherItem {
  threadId: string;
  title: string;
  channelSlug: string;
  status: string;
  turnUnseen: boolean;
  href: string;
}

export interface CycleKey {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
}

export function isCycleKey(event: CycleKey): boolean {
  // Matching the physical key rather than the character means Shift+Cmd+/
  // still reads as slash instead of as a question mark.
  if (event.code !== "Slash") return false;
  return event.metaKey || event.ctrlKey;
}

export function isReleaseKey(event: { key: string }): boolean {
  return event.key === "Meta" || event.key === "Control";
}

export function isCancelKey(event: { key: string }): boolean {
  return event.key === "Escape";
}

export function initialIndex({
  length,
  onThread,
}: {
  length: number;
  onThread: boolean;
}): number {
  // Cmd+Tab's whole trick: the first tap is already on the thing you left,
  // so tap-and-release toggles between the last two.
  return onThread && length > 1 ? 1 : 0;
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
  orgSlug,
  currentThreadId,
}: {
  history: VisitedThread[];
  sessions: SessionItem[];
  orgSlug: string;
  currentThreadId: string | null;
}): SwitcherItem[] {
  const live = new Map(sessions.map((session) => [session.id, session]));
  const items: SwitcherItem[] = [];

  for (const entry of history) {
    const session = live.get(entry.threadId);
    if (session) {
      items.push({
        threadId: session.id,
        title: session.title,
        channelSlug: session.channelSlug,
        status: session.status,
        turnUnseen: session.turnUnseen,
        href: session.href,
      });
      continue;
    }

    // A thread that is not live has, as far as the switcher cares, come to
    // rest. Whether it ended idle, completed or canceled is a distinction the
    // history entry cannot make and a person flicking past does not need.
    items.push({
      threadId: entry.threadId,
      title: entry.title,
      channelSlug: entry.channelSlug,
      status: "completed",
      turnUnseen: false,
      href: `/${orgSlug}/${entry.channelSlug}?thread=${entry.threadId}`,
    });
  }

  const visited = new Set(history.map((entry) => entry.threadId));
  for (const session of sessions) {
    if (visited.has(session.id)) continue;
    items.push({
      threadId: session.id,
      title: session.title,
      channelSlug: session.channelSlug,
      status: session.status,
      turnUnseen: session.turnUnseen,
      href: session.href,
    });
  }

  const current = items.find((item) => item.threadId === currentThreadId);
  const ordered = current
    ? [current, ...items.filter((item) => item !== current)]
    : items;

  return ordered.slice(0, SWITCHER_LIMIT);
}
