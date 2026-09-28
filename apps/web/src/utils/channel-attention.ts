import type { InboxThread, LiveThread } from "@roster/api";

import { isUnread } from "./inbox-threads";
import { needsInput } from "./thread-rows";

export function inboxThreadsKey() {
  return ["threads", "inbox"] as const;
}

export type AttentionLiveThread = Pick<
  LiveThread,
  "projectId" | "status" | "turnUnseen"
>;

export type AttentionInboxThread = Pick<
  InboxThread,
  "projectId" | "unread" | "muted"
>;

/*
 * The channels worth bolding in the sidebar: a session is waiting on the
 * person, a turn finished that nobody has read, or a followed thread has
 * unread activity. A muted thread never bolds its channel.
 */
export function channelsNeedingAttention(
  live: AttentionLiveThread[],
  inbox: AttentionInboxThread[],
): Set<string> {
  const flagged = new Set<string>();

  for (const thread of live) {
    if (needsInput(thread.status) || thread.turnUnseen) {
      flagged.add(thread.projectId);
    }
  }

  for (const thread of inbox) {
    if (isUnread(thread)) flagged.add(thread.projectId);
  }

  return flagged;
}
