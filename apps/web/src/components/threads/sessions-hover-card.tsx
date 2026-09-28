"use client";

import {
  HoverCard,
  HoverCardContent,
  HoverCardPortal,
  HoverCardTrigger,
} from "@roster/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import { ChannelMark } from "~/components/logo/channel-mark";
import { threadTitle } from "~/utils/live-threads";

import { ThreadStatus, TurnCompleted } from "./thread-status";

export interface HoverCardThread {
  id: string;
  rootText: string;
  status: string;
  lastProgress: string | null;
  turnUnseen: boolean;
  href?: string;
  channelSlug?: string;
}

export interface SessionsHoverCardProps {
  threads: HoverCardThread[];
  basePath: string;
  heading: string;
  side: "top" | "right";
  align: "start" | "end";
  children: ReactNode;
}

/*
 * Threads arrive most-recent-first; groups keep the order each channel first
 * appears in, so the busiest channel floats to the top without a second sort.
 */
function groupByChannel(
  threads: HoverCardThread[],
): { channelSlug: string | null; threads: HoverCardThread[] }[] {
  const groups = new Map<string | null, HoverCardThread[]>();
  for (const thread of threads) {
    const key = thread.channelSlug ?? null;
    const bucket = groups.get(key);
    if (bucket) bucket.push(thread);
    else groups.set(key, [thread]);
  }
  return [...groups.entries()].map(([channelSlug, grouped]) => ({
    channelSlug,
    threads: grouped,
  }));
}

function ThreadRow({
  thread,
  basePath,
}: {
  thread: HoverCardThread;
  basePath: string;
}) {
  return (
    <Link
      href={thread.href ?? `${basePath}?thread=${thread.id}`}
      className="hover:bg-accent flex flex-col gap-0.5 rounded-md px-2 py-1.5"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">
          {threadTitle(thread.rootText)}
        </span>
        {thread.turnUnseen ? (
          <TurnCompleted />
        ) : (
          <ThreadStatus status={thread.status} />
        )}
      </span>

      {thread.lastProgress ? (
        <span className="text-muted-foreground truncate text-xs">
          {thread.lastProgress}
        </span>
      ) : null}
    </Link>
  );
}

export function SessionsHoverCard({
  threads,
  basePath,
  heading,
  side,
  align,
  children,
}: SessionsHoverCardProps) {
  const groups = groupByChannel(threads);

  return (
    <HoverCard openDelay={120} closeDelay={120}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>

      <HoverCardPortal>
        <HoverCardContent side={side} align={align} className="w-80">
          <p className="text-muted-foreground px-2 pb-1 pt-1.5 text-xs">
            {heading}
          </p>

          <div className="flex flex-col">
            {groups.map((group) => (
              <div key={group.channelSlug ?? ""} className="flex flex-col">
                {group.channelSlug ? (
                  <span className="text-muted-foreground flex items-center gap-1.5 px-2 pb-0.5 pt-1.5 text-xs">
                    <ChannelMark className="size-[12px]" />
                    {group.channelSlug}
                  </span>
                ) : null}
                {group.threads.map((thread) => (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    basePath={basePath}
                  />
                ))}
              </div>
            ))}
          </div>
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
}
