"use client";

import type { ChannelGroups } from "@roster/api";
import { cn } from "@roster/ui";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

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

          const start = initialIndex(items);
          return {
            items,
            index: backwards ? cycleIndex(start, items.length, true) : start,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4">
      <div
        role="listbox"
        aria-label="Switch thread"
        className="bg-popover/95 text-popover-foreground ring-border flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-xl p-1.5 shadow-2xl ring-1 backdrop-blur-xl"
      >
        <div className="no-scrollbar flex-1 overflow-y-auto">
          {rows.map((item, index) => (
            <Fragment key={item.threadId}>
              {item.group !== rows[index - 1]?.group && (
                <div className="text-muted-foreground px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider">
                  {item.group === "working" ? "Working" : "Finished"}
                </div>
              )}
              <SwitcherRow item={item} selected={index === session.index} />
            </Fragment>
          ))}
        </div>

        <div className="text-muted-foreground border-border mt-1 shrink-0 border-t px-2.5 pb-1 pt-2 text-[11px]">
          Hold ⌘ · tap / to move · shift to go back
        </div>
      </div>
    </div>
  );
}

function SwitcherRow({
  item,
  selected,
}: {
  item: SwitcherItem;
  selected: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const tone = item.turnUnseen
    ? "bg-success"
    : (statusTone(item.status) ?? "bg-muted-foreground");

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      className={cn(
        "flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm",
        selected && "bg-accent",
      )}
    >
      <ChannelMark className="text-muted-foreground size-3.5" />
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {item.isCurrent && (
        <span className="text-muted-foreground shrink-0 text-[11px]">here</span>
      )}
      <span className="text-muted-foreground shrink-0 text-xs">
        {item.channelSlug}
      </span>
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          tone,
          // A pulse means work is happening, matching the thread list. Needs
          // input is deliberately still.
          (isLive(item.status) || isWaiting(item.status)) && "animate-pulse",
        )}
        title={item.turnUnseen ? "Turn completed" : statusLabel(item.status)}
      />
    </div>
  );
}
