import type { MessageHit, TaskHit } from "@roster/api";

export const MIN_QUERY_LENGTH = 2;

export function searchKey(query: string, projectId?: string) {
  return ["search", projectId ?? "org", query] as const;
}

export function searchable(query: string): boolean {
  return query.trim().length >= MIN_QUERY_LENGTH;
}

/*
 * Only a message that addressed an agent has a thread to open. Plain channel
 * chatter has none, so it lands on the channel rather than nowhere.
 */
export function messageHref(orgSlug: string, hit: MessageHit): string {
  return hit.threadId
    ? `/${orgSlug}/${hit.channelSlug}?thread=${hit.threadId}`
    : `/${orgSlug}/${hit.channelSlug}`;
}

export function taskHref(orgSlug: string, hit: TaskHit): string {
  if (hit.threadId && hit.channelSlug) {
    return `/${orgSlug}/${hit.channelSlug}?thread=${hit.threadId}`;
  }

  return hit.channelSlug
    ? `/${orgSlug}/${hit.channelSlug}?tab=tasks&channel=${encodeURIComponent(hit.channelSlug)}`
    : `/${orgSlug}/tasks`;
}
