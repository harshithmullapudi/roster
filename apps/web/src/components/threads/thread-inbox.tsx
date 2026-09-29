"use client";

import type { InboxThread } from "@roster/api";
import { Button, cn } from "@roster/ui";
import { AtSign, BellOff, Folder, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  filterInboxThreads,
  groupInboxThreads,
  isUnread,
  parseInboxFilter,
  showsUnreadDot,
  subscriptionLabel,
  trackOpenThread,
  type InboxFilter,
  type InboxTriage,
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
}

function ThreadRow({
  thread,
  href,
  unread,
  selected,
}: {
  thread: InboxThread;
  href: string;
  unread: boolean;
  selected: boolean;
}) {
  return (
    <li
      className={cn(
        "hover:bg-accent/50 relative flex flex-col gap-1 rounded-lg px-2 py-2 transition-colors sm:px-3",
        unread && "bg-accent/30",
        selected && "bg-accent",
      )}
    >
      <Link href={href} scroll={false} className="flex min-w-0 flex-col gap-1">
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

function CaughtUp({
  filter,
  onShowAll,
}: {
  filter: InboxFilter;
  onShowAll: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <MessagesSquare className="text-muted-foreground size-7" />
      <p className="text-sm font-medium">
        {filter === "needs-input"
          ? "Nothing needs your input"
          : "You're all caught up"}
      </p>
      <p className="text-muted-foreground max-w-xs text-sm">
        {filter === "needs-input"
          ? "Threads show up here when an agent is waiting on an answer from you."
          : "Nothing unread right now. New activity in your threads lands here."}
      </p>
      <button
        type="button"
        onClick={onShowAll}
        className="text-primary text-sm hover:underline"
      >
        Show all threads
      </button>
    </div>
  );
}

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: "unread", label: "Unread" },
  { value: "needs-input", label: "Needs input" },
  { value: "all", label: "All" },
];

function FilterBar({
  filter,
  onChange,
}: {
  filter: InboxFilter;
  onChange: (filter: InboxFilter) => void;
}) {
  return (
    <div className="border-border flex shrink-0 items-center gap-0.5 border-b px-2 py-1.5 sm:px-3">
      {FILTERS.map(({ value, label }) => (
        <Button
          key={value}
          variant="ghost"
          isActive={filter === value}
          onClick={() => onChange(value)}
          aria-pressed={filter === value}
          className={cn(
            "text-muted-foreground shrink-0 !rounded-md px-2 text-sm",
            filter === value && "!bg-accent !text-accent-foreground",
          )}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

export function ThreadInbox({ threads }: ThreadInboxProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filter = parseInboxFilter(searchParams.get("filter"));
  const openThreadId = searchParams.get("thread");

  const setFilter = useCallback(
    (next: InboxFilter) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "unread") params.delete("filter");
      else params.set("filter", next);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname, searchParams],
  );

  const threadHref = useCallback(
    (threadId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("thread", threadId);
      return `${pathname}?${params.toString()}`;
    },
    [pathname, searchParams],
  );

  const [triage, setTriage] = useState<InboxTriage>(() => ({
    pinned: new Set(threads.filter(isUnread).map((thread) => thread.id)),
    opened: new Set(openThreadId ? [openThreadId] : []),
  }));

  useEffect(() => {
    setTriage((previous) => trackOpenThread(previous, openThreadId));
  }, [openThreadId]);

  const groups = useMemo(
    () => groupInboxThreads(filterInboxThreads(threads, filter, triage.pinned)),
    [threads, filter, triage.pinned],
  );
  useClearUnreadOnOpen();

  if (threads.length === 0) return <EmptyInbox />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilterBar filter={filter} onChange={setFilter} />
      {groups.length === 0 ? (
        <CaughtUp filter={filter} onShowAll={() => setFilter("all")} />
      ) : (
        <div className="overscroll-contain min-h-0 flex-1 overflow-y-auto">
          <div className="pb-safe-2 flex w-full flex-col gap-4 p-1 sm:p-2">
            {groups.map((group) => (
              <section key={group.bucket} className="flex flex-col gap-0.5">
                <h2 className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-medium sm:px-3">
                  {group.label}
                </h2>
                <ul className="flex flex-col gap-0.5">
                  {group.threads.map((thread) => (
                    <ThreadRow
                      key={thread.id}
                      thread={thread}
                      href={threadHref(thread.id)}
                      unread={showsUnreadDot(thread, triage.pinned, triage.opened)}
                      selected={thread.id === openThreadId}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
