"use client";

import {
  HoverCard,
  HoverCardContent,
  HoverCardPortal,
  HoverCardTrigger,
} from "@roster/ui";
import Link from "next/link";
import type { ReactNode } from "react";

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

export function SessionsHoverCard({
  threads,
  basePath,
  heading,
  side,
  align,
  children,
}: SessionsHoverCardProps) {
  return (
    <HoverCard openDelay={120} closeDelay={120}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>

      <HoverCardPortal>
        <HoverCardContent side={side} align={align} className="w-80">
          <p className="text-muted-foreground px-2 pb-1 pt-1.5 text-xs">
            {heading}
          </p>

          <div className="flex flex-col">
            {threads.map((thread) => (
              <Link
                key={thread.id}
                href={thread.href ?? `${basePath}?thread=${thread.id}`}
                className="hover:bg-accent flex flex-col gap-0.5 rounded-md px-2 py-1.5"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {threadTitle(thread.rootText)}
                  </span>
                  {thread.channelSlug ? (
                    <span className="text-muted-foreground shrink-0 text-xs">
                      #{thread.channelSlug}
                    </span>
                  ) : null}
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
            ))}
          </div>
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
}
