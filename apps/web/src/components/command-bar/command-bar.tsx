"use client";

import type { ChannelGroups } from "@roster/api";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@roster/ui";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, Folder, Plus, Star, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { flattenChannels } from "~/components/tasks/channel-picker";
import { ThreadStatus, TurnCompleted } from "~/components/threads/thread-status";
import { liveThreadsKey, toSessionItems } from "~/utils/live-threads";
import { trpc } from "~/utils/trpc";

export interface CommandBarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgSlug: string;
  channels: ChannelGroups;
}

export function CommandBar({
  open,
  onOpenChange,
  orgSlug,
  channels,
}: CommandBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const starred = new Set(channels.starred.map((channel) => channel.id));
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

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery("");
      }}
      title="Command bar"
      description="Jump to a channel or start something new."
    >
      <CommandInput
        placeholder="Search sessions, channels and actions..."
        value={query}
        onValueChange={setQuery}
        autoFocus
      />
      <CommandList className="max-h-80">
        <CommandEmpty className="text-muted-foreground py-6 text-sm">
          Nothing matches “{query}”.
        </CommandEmpty>

        {sessions.length > 0 && (
          <>
            <CommandGroup heading="Active sessions">
              {sessions.map((session) => (
                <CommandItem
                  key={session.id}
                  value={`session ${session.title} ${session.channelSlug} ${session.status}`}
                  onSelect={() => go(session.href)}
                >
                  <Folder size={14} className="text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {session.title}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {session.channelSlug}
                  </span>
                  {session.turnUnseen ? (
                    <TurnCompleted />
                  ) : (
                    <ThreadStatus status={session.status} />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandSeparator />
          </>
        )}

        {allChannels.length > 0 && (
          <CommandGroup heading="Channels">
            {allChannels.map((channel) => (
              <CommandItem
                key={channel.id}
                value={`channel ${channel.slug} ${channel.name}`}
                onSelect={() => go(`/${orgSlug}/${channel.slug}`)}
              >
                <Folder size={14} className="text-muted-foreground" />
                <span className="flex-1 truncate">{channel.slug}</span>
                {starred.has(channel.id) && (
                  <Star size={13} className="text-muted-foreground shrink-0" />
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        <CommandGroup heading="Navigate">
          <CommandItem
            value="go to tasks"
            onSelect={() => go(`/${orgSlug}/tasks`)}
          >
            <CircleCheck size={14} className="text-muted-foreground" />
            <span>Tasks</span>
          </CommandItem>
          <CommandItem
            value="go to members"
            onSelect={() => go(`/${orgSlug}/settings/members`)}
          >
            <Users size={14} className="text-muted-foreground" />
            <span>Members</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
