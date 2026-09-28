"use client";

import type { InboxThread } from "@roster/api";
import { cn } from "@roster/ui";
import { AtSign, BellOff, Folder, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import {
  groupInboxThreads,
  isUnread,
  subscriptionLabel,
} from "~/utils/inbox-threads";
import { liveThreadsKey, threadTitle } from "~/utils/live-threads";
import { relativeTime } from "~/utils/relative-time";
import { unreadCountKey } from "~/utils/notification-cache";
import { replyCountLabel } from "~/utils/thread-rows";
import { trpc } from "~/utils/trpc";

import { ReplyAvatars } from "./reply-avatars";
import { ThreadStatus } from "./thread-status";
import { WaitingOnCard } from "./waiting-on";

function useClearUnreadOnOpen(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let disposed = false;

    void trpc.notifications.markAllRead
      .mutate()
      .then(() => {
        if (disposed) return;
        queryClient.setQueryData<number>(unreadCountKey(), 0);
        void queryClient.invalidateQueries({ queryKey: liveThreadsKey() });
      })
      .catch(() => {
        queryClient.invalidateQueries({ queryKey: unreadCountKey() });
      });

    return () => {
      disposed = true;
    };
  }, [queryClient]);
}

export interface ThreadInboxProps {
  threads: InboxThread[];
  orgSlug: string;
}

function ThreadRow({
  thread,
  orgSlug,
}: {
  thread: InboxThread;
  orgSlug: string;
}) {
  const unread = isUnread(thread);

  return (
    <li
      className={cn(
        "hover:bg-accent/50 relative flex flex-col gap-1 rounded-lg px-2 py-2 transition-colors sm:px-3",
        unread && "bg-accent/30",
      )}
    >
      <Link
        href={`/${orgSlug}/${thread.channelSlug}/thread/${thread.id}`}
        className="flex min-w-0 flex-col gap-1"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-label={unread ? "Unread" : undefined}
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              unread ? "bg-primary" : "bg-transparent",
            )}
          />
          <span className="text-muted-foreground flex min-w-0 items-center gap-0.5 text-xs">
            <Folder size={11} className="shrink-0" />
            <span className="truncate">{thread.channelName}</span>
          </span>

          {thread.reason === "mentioned" && (
            <span
              className="text-muted-foreground flex shrink-0 items-center gap-0.5 text-xs"
              title="You were mentioned"
            >
              <AtSign size={11} />
            </span>
          )}

          {thread.muted && (
            <span className="text-muted-foreground shrink-0" title="Muted">
              <BellOff size={11} />
            </span>
          )}

          <span className="ml-auto shrink-0">
            <ThreadStatus status={thread.status} />
          </span>
          <span className="text-muted-foreground w-16 shrink-0 text-right text-xs">
            {relativeTime(thread.lastActivityAt)}
          </span>
        </span>

        <span className="flex min-w-0 items-center gap-2 pl-3.5">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              unread ? "text-foreground font-medium" : "text-foreground/90",
            )}
          >
            {threadTitle(thread.rootText)}
          </span>
        </span>

        <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 pl-3.5 text-xs">
          {thread.replyCount > 0 && (
            <>
              <ReplyAvatars names={thread.replierNames} />
              <span className="shrink-0">
                {replyCountLabel(thread.replyCount)}
              </span>
              <span className="shrink-0">·</span>
            </>
          )}
          <span className="truncate">{subscriptionLabel(thread.reason)}</span>
        </span>
      </Link>

      {thread.waitingOn && (
        <div className="pl-3.5">
          <WaitingOnCard waiting={thread.waitingOn} />
        </div>
      )}
    </li>
  );
}

function EmptyInbox() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <MessagesSquare className="text-muted-foreground size-7" />
      <p className="text-sm font-medium">No threads yet</p>
      <p className="text-muted-foreground max-w-xs text-sm">
        Threads show up here when you start one, reply in one, or someone
        mentions you. The most recent activity stays on top.
      </p>
    </div>
  );
}

export function ThreadInbox({ threads, orgSlug }: ThreadInboxProps) {
  const groups = useMemo(() => groupInboxThreads(threads), [threads]);
  useClearUnreadOnOpen();

  if (groups.length === 0) return <EmptyInbox />;

  return (
    <div className="overscroll-contain min-h-0 flex-1 overflow-y-auto">
      <div className="pb-safe-2 flex w-full flex-col gap-4 p-1 sm:p-2">
        {groups.map((group) => (
          <section key={group.bucket} className="flex flex-col gap-0.5">
            <h2 className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-medium sm:px-3">
              {group.label}
            </h2>
            <ul className="flex flex-col gap-0.5">
              {group.threads.map((thread) => (
                <ThreadRow key={thread.id} thread={thread} orgSlug={orgSlug} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
