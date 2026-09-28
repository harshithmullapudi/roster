"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@roster/ui";
import { SquareTerminal } from "lucide-react";

import { CountFlash } from "~/components/threads/count-flash";
import { SessionCounts } from "~/components/threads/session-counts";
import { SessionsHoverCard } from "~/components/threads/sessions-hover-card";
import {
  countByState,
  liveThreadsKey,
  sessionsHeading,
} from "~/utils/live-threads";
import { trpc } from "~/utils/trpc";

import { useDock } from "./dock-provider";

/*
 * The bar counts across every channel the member can see, not just the one on
 * screen, so it reads the same on Threads and Tasks as it does inside a
 * channel. Clicking it opens the dock — the folder picker works everywhere.
 */
function OrgCounts({ orgSlug, onOpen }: { orgSlug: string; onOpen: () => void }) {
  const { data: liveThreads } = useQuery({
    queryKey: liveThreadsKey(),
    queryFn: () => trpc.threads.live.query(),
    refetchInterval: 10_000,
  });

  const { data: openFolders } = useQuery({
    queryKey: ["terminals", "open-folders"],
    queryFn: () => trpc.terminals.openFolders.query(),
    refetchInterval: 15_000,
  });

  const sessions = liveThreads ?? [];
  const counts = countByState(sessions);
  const open = openFolders ?? 0;

  if (open === 0 && sessions.length === 0) return null;

  const button = (
    <button
      type="button"
      onClick={onOpen}
      className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-2.5 text-xs"
    >
      <CountFlash value={open} className={cn(open <= 0 && "hidden")}>
        {open} open
      </CountFlash>
      <SessionCounts
        running={counts.running}
        needsInput={counts.needsInput}
        turnDone={counts.turnDone}
        labeled
      />
    </button>
  );

  if (sessions.length === 0) return button;

  return (
    <SessionsHoverCard
      threads={sessions.map((thread) => ({
        id: thread.id,
        rootText: thread.rootText,
        status: thread.status,
        lastProgress: thread.lastProgress,
        turnUnseen: thread.turnUnseen,
        channelSlug: thread.channelSlug,
        href: `/${orgSlug}/${thread.channelSlug}?thread=${thread.id}`,
      }))}
      basePath={`/${orgSlug}/threads`}
      heading={sessionsHeading(counts, sessions.length)}
      side="top"
      align="end"
    >
      {button}
    </SessionsHoverCard>
  );
}

export function DockStatusBar({ orgSlug }: { orgSlug: string }) {
  const { mode, setMode, toggle } = useDock();

  return (
    <footer
      className={cn(
        "flex shrink-0 items-center justify-end gap-2",
        mode === "open" ? "px-1.5 py-1" : "p-2",
      )}
    >
      <OrgCounts orgSlug={orgSlug} onOpen={() => setMode("open")} />

      <button
        type="button"
        onClick={toggle}
        aria-label="Toggle agent sessions"
        className="text-muted-foreground hover:bg-accent hover:text-foreground flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors"
      >
        <SquareTerminal size={13} />
        <span>Agent</span>
      </button>
    </footer>
  );
}
