"use client";

import type { Channel } from "@roster/api";
import {
  cn,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@roster/ui";
import { ChevronDown } from "lucide-react";

import { ChannelRow } from "./channel-row";

export interface ChannelSectionProps {
  label: string;
  channels: Channel[];
  open: boolean;
  orgSlug: string;
  activeChannelSlug?: string;
  attention: Set<string>;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleStar: (channel: Channel) => void;
  onChangeVisibility: (channel: Channel, visibility: string) => void;
}

export function ChannelSection({
  label,
  channels,
  open,
  orgSlug,
  activeChannelSlug,
  attention,
  canManage,
  onOpenChange,
  onToggleStar,
  onChangeVisibility,
}: ChannelSectionProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="mb-1">
      <CollapsibleTrigger asChild>
        <button className="text-muted-foreground hover:text-foreground group/section flex h-7 w-full select-none items-center gap-1 px-2 text-xs font-medium">
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
      <CollapsibleContent>
        <div className="flex w-full min-w-0 flex-col gap-0.5">
          {channels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              href={`/${orgSlug}/${channel.slug}`}
              active={channel.slug === activeChannelSlug}
              attention={attention.has(channel.id)}
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
