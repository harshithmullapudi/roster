"use client";

import type { ChannelGroups } from "@roster/api";
import { cn } from "@roster/ui";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { ChannelMark } from "~/components/logo/channel-mark";
import { flattenChannels } from "~/components/tasks/channel-picker";
import { liveThreadsKey, toSessionItems } from "~/utils/live-threads";
import { isLive, isWaiting, statusLabel, statusTone } from "~/utils/thread-rows";
import { trpc } from "~/utils/trpc";
import { readHistory } from "~/utils/thread-history";
import {
  cycleIndex,
  initialIndex,
  isCancelKey,
  isCycleKey,
  isReleaseKey,
  toSwitcherItems,
  type SwitcherItem,
} from "~/utils/thread-switcher";

interface Session {
  items: SwitcherItem[];
  index: number;
}

export interface ThreadSwitcherProps {
  orgSlug: string;
  channels: ChannelGroups;
  currentThreadId: string | null;
}

export function ThreadSwitcher({
  orgSlug,
  channels,
  currentThreadId,
}: ThreadSwitcherProps) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const open = session !== null;

  const allChannels = useMemo(() => flattenChannels(channels), [channels]);

  const { data: live } = useQuery({
    queryKey: liveThreadsKey(),
    queryFn: () => trpc.threads.live.query(),
    enabled: open,
    staleTime: 5_000,
  });

  const sessions = useMemo(
    () => toSessionItems(live ?? [], allChannels, orgSlug),
    [live, allChannels, orgSlug],
  );

  const latest = useRef({ sessions, currentThreadId, orgSlug });
  latest.current = { sessions, currentThreadId, orgSlug };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isCycleKey(event)) {
        event.preventDefault();
        const backwards = event.shiftKey;

        setSession((current) => {
          if (current) {
            return {
              ...current,
              index: cycleIndex(current.index, current.items.length, backwards),
            };
          }

          const items = toSwitcherItems({
            history: readHistory(),
            sessions: latest.current.sessions,
            orgSlug: latest.current.orgSlug,
            currentThreadId: latest.current.currentThreadId,
          });
          if (items.length === 0) return null;

          const start = initialIndex({
            length: items.length,
            onThread: latest.current.currentThreadId !== null,
          });
          return {
            items,
            index: backwards ? cycleIndex(0, items.length, true) : start,
          };
        });
        return;
      }

      if (isCancelKey(event)) {
        // Only swallow the key when there is something to cancel — the thread
        // pane listens for Escape too.
        setSession((current) => {
          if (current) event.preventDefault();
          return null;
        });
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (!isReleaseKey(event)) return;

      setSession((current) => {
        const target = current?.items[current.index];
        if (target && target.threadId !== latest.current.currentThreadId) {
          router.push(target.href);
        }
        return null;
      });
    }

    // Cmd+Tabbing out of the app leaves the modifier up in another window, so
    // the release that would commit never arrives here.
    const onBlur = () => setSession(null);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [router]);

  const rows = useMemo(() => {
    if (!session) return [];

    // The order is frozen for the life of the hold so a thread changing state
    // mid-flick cannot move what you are about to land on. Status is not.
    const byId = new Map(sessions.map((item) => [item.id, item]));
    return session.items.map((item) => {
      const fresh = byId.get(item.threadId);
      return fresh
        ? { ...item, status: fresh.status, turnUnseen: fresh.turnUnseen }
        : item;
    });
  }, [session, sessions]);

  if (!session) return null;

  const current = rows[session.index];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4">
      <div
        role="listbox"
        aria-label="Switch thread"
        className="bg-popover/95 text-popover-foreground ring-border flex max-w-[min(56rem,100%)] flex-col items-center gap-4 rounded-2xl p-5 shadow-2xl ring-1 backdrop-blur-xl"
      >
        <div className="no-scrollbar flex max-w-full items-center gap-3 overflow-x-auto">
          {rows.map((item, index) => (
            <SwitcherTile
              key={item.threadId}
              item={item}
              selected={index === session.index}
            />
          ))}
        </div>

        {/*
         * One caption for the whole strip, the way macOS names only the app
         * you are holding on. A title per tile would not fit and would turn
         * the strip into the list this replaced.
         */}
        <div className="flex min-h-10 w-full max-w-md flex-col items-center gap-1 text-center">
          <span className="w-full truncate text-sm font-medium">
            {current?.title}
          </span>
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <span>{current?.channelSlug}</span>
            <span aria-hidden>·</span>
            <span>
              {current?.turnUnseen
                ? "Turn completed"
                : statusLabel(current?.status ?? "")}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

function SwitcherTile({
  item,
  selected,
}: {
  item: SwitcherItem;
  selected: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [selected]);

  const tone = item.turnUnseen
    ? "bg-success"
    : (statusTone(item.status) ?? "bg-muted-foreground");

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      aria-label={`${item.title} · ${item.channelSlug}`}
      className={cn(
        "relative flex size-16 shrink-0 items-center justify-center rounded-2xl transition-colors",
        selected
          ? "bg-accent text-foreground"
          : "text-muted-foreground/70 hover:text-muted-foreground",
      )}
    >
      <ChannelMark className="size-7" />
      <span
        className={cn(
          "ring-popover absolute bottom-1.5 right-1.5 size-2.5 rounded-full ring-2",
          tone,
          // A pulse means work is happening, matching the thread list. Needs
          // input is deliberately still.
          (isLive(item.status) || isWaiting(item.status)) && "animate-pulse",
        )}
      />
    </div>
  );
}
