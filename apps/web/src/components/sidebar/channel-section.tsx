"use client";

import type { Channel } from "@roster/api";
import {
  cn,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@roster/ui";
import { ChevronDown, Plus } from "lucide-react";

import { ChannelRow } from "./channel-row";

export interface ChannelSectionProps {
  label: string;
  channels: Channel[];
  open: boolean;
  orgSlug: string;
  activeChannelSlug?: string;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleStar: (channel: Channel) => void;
  onChangeVisibility: (channel: Channel, visibility: string) => void;
  onCreate?: () => void;
}

export function ChannelSection({
  label,
  channels,
  open,
  orgSlug,
  activeChannelSlug,
  canManage,
  onOpenChange,
  onToggleStar,
  onChangeVisibility,
  onCreate,
}: ChannelSectionProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="mb-1">
      <div className="group/section flex h-7 w-full items-center">
        <CollapsibleTrigger asChild>
          <button className="text-muted-foreground hover:text-foreground flex h-7 min-w-0 flex-1 select-none items-center gap-1 px-2 text-xs font-medium">
            {label}
            <ChevronDown
              size={13}
              className={cn(
                "opacity-0 transition-[transform,opacity] duration-200 group-hover/section:opacity-100 max-md:opacity-100",
                !open && "-rotate-90 opacity-100",
              )}
            />
          </button>
        </CollapsibleTrigger>
        {onCreate ? (
          <button
            type="button"
            aria-label={`Create a ${label.toLowerCase()} channel`}
            onClick={onCreate}
            className="text-muted-foreground hover:text-foreground hover:bg-accent mr-1 flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover/section:opacity-100 max-md:opacity-100"
          >
            <Plus size={13} />
          </button>
        ) : null}
      </div>
      <CollapsibleContent>
        <div className="flex w-full min-w-0 flex-col gap-0.5">
          {channels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              href={`/${orgSlug}/${channel.slug}`}
              active={channel.slug === activeChannelSlug}
              canManage={canManage}
              onToggleStar={onToggleStar}
              onChangeVisibility={onChangeVisibility}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
