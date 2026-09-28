import type { InboxThread } from "@roster/api";

export const INBOX_BUCKETS = ["today", "yesterday", "week", "earlier"] as const;

export type InboxBucket = (typeof INBOX_BUCKETS)[number];

export interface InboxGroup {
  bucket: InboxBucket;
  label: string;
  threads: InboxThread[];
}

const BUCKET_LABELS: Record<InboxBucket, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Earlier this week",
  earlier: "Older",
};

const DAY = 24 * 60 * 60 * 1000;

function dayStart(value: Date): number {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

export function inboxBucket(value: Date, now: Date = new Date()): InboxBucket {
  const days = Math.round((dayStart(now) - dayStart(value)) / DAY);

  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "week";
  return "earlier";
}

export function bucketLabel(bucket: InboxBucket): string {
  return BUCKET_LABELS[bucket];
}

export function isUnread(
  thread: Pick<InboxThread, "unread" | "muted">,
): boolean {
  return thread.unread && !thread.muted;
}

export type InboxFilter = "unread" | "needs-input" | "all";

export function parseInboxFilter(value: string | null): InboxFilter {
  if (value === "all") return "all";
  if (value === "needs-input") return "needs-input";
  return "unread";
}

export function filterInboxThreads(
  threads: InboxThread[],
  filter: InboxFilter,
  pinned: ReadonlySet<string> = new Set(),
): InboxThread[] {
  if (filter === "all") return threads;
  if (filter === "needs-input") {
    return threads.filter((thread) => thread.status === "needs_input");
  }
  return threads.filter((thread) => isUnread(thread) || pinned.has(thread.id));
}

export function groupInboxThreads(
  threads: InboxThread[],
  now: Date = new Date(),
): InboxGroup[] {
  const buckets = new Map<InboxBucket, InboxThread[]>();

  for (const thread of threads) {
    const bucket = inboxBucket(thread.lastActivityAt, now);
    const existing = buckets.get(bucket);
    if (existing) existing.push(thread);
    else buckets.set(bucket, [thread]);
  }

  return INBOX_BUCKETS.flatMap((bucket) => {
    const found = buckets.get(bucket);
    if (!found || found.length === 0) return [];
    return [{ bucket, label: BUCKET_LABELS[bucket], threads: found }];
  });
}

export function subscriptionLabel(reason: InboxThread["reason"]): string {
  switch (reason) {
    case "author":
      return "You started this";
    case "replied":
      return "You replied";
    case "mentioned":
      return "You were mentioned";
    default:
      return "Following";
  }
}
