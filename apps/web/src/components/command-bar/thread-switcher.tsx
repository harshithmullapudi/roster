"use client";

import type { ChannelGroups } from "@roster/api";
import { cn } from "@roster/ui";
import { useQuery } from "@tanstack/react-query";
import { Folder } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { flattenChannels } from "~/components/tasks/channel-picker";
import { ThreadStatus, TurnCompleted } from "~/components/threads/thread-status";
import { liveThreadsKey, toSessionItems } from "~/utils/live-threads";
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="listbox"
        aria-label="Switch thread"
        className="bg-popover text-popover-foreground shadow-1 flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-xl p-1"
      >
        <div className="no-scrollbar flex-1 overflow-y-auto">
          {rows.map((item, index) => (
            <SwitcherRow
              key={item.threadId}
              item={item}
              selected={index === session.index}
            />
          ))}
        </div>
        <div className="text-muted-foreground border-border mt-1 border-t px-2 py-1.5 text-xs">
          Hold ⌘ and tap / to cycle · shift to go back · release to switch
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

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      className={cn(
        "flex min-h-8 items-center gap-2 rounded-lg px-2 py-1.5 text-sm",
        selected && "bg-accent text-accent-foreground",
      )}
    >
      <Folder size={14} className="text-muted-foreground shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      <span className="text-muted-foreground shrink-0 text-xs">
        {item.channelSlug}
      </span>
      {item.turnUnseen ? (
        <TurnCompleted />
      ) : (
        <ThreadStatus status={item.status} />
      )}
    </div>
  );
}
