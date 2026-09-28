"use client";

import type { Channel } from "@roster/api";
import {
  Button,
  cn,
  ContextMenu,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuTrigger,
} from "@roster/ui";
import { MoreHorizontal, Star } from "lucide-react";
import Link from "next/link";

import { HashMark } from "~/components/logo/hash-mark";

import {
  ChannelMenu,
  CONTEXT_MENU_SURFACE,
  DROPDOWN_MENU_SURFACE,
} from "./channel-menu";

export interface ChannelRowProps {
  channel: Channel;
  href: string;
  active: boolean;
  attention: boolean;
  canManage: boolean;
  onToggleStar: (channel: Channel) => void;
  onChangeVisibility: (channel: Channel, visibility: string) => void;
}

export function ChannelRow({
  channel,
  href,
  active,
  attention,
  canManage,
  onToggleStar,
  onChangeVisibility,
}: ChannelRowProps) {
  const menuProps = {
    channel,
    href,
    canManage,
    onToggleStar,
    onChangeVisibility,
  };

  return (
    <div className="group/channel relative flex w-full min-w-0 items-center">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Button
            variant="ghost"
            isActive={active}
            full
            className={cn(
              "text-foreground min-w-0 justify-start gap-2 !rounded-md pl-2 pr-[calc(2*var(--btn-h-xs)+0.75rem)] text-sm select-none",
              active && "!bg-accent !text-accent-foreground",
            )}
            asChild
          >
            <Link href={href}>
              <HashMark
                className={cn(
                  "text-muted-foreground",
                  attention && "text-foreground",
                )}
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-left",
                  attention && "font-semibold",
                )}
              >
                {channel.slug}
              </span>
            </Link>
          </Button>
        </ContextMenuTrigger>
        <ChannelMenu surface={CONTEXT_MENU_SURFACE} {...menuProps} />
      </ContextMenu>

      <div className="absolute right-1 flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="xs"
          aria-label={channel.starred ? "Unstar channel" : "Star channel"}
          className={cn(
            "text-muted-foreground hover:text-foreground w-(--btn-h-xs) px-0 !rounded-md opacity-0 transition-opacity max-md:opacity-100 group-hover/channel:opacity-100 focus-visible:opacity-100",
            channel.starred && "text-foreground",
          )}
          onClick={() => onToggleStar(channel)}
        >
          <Star size={13} fill={channel.starred ? "currentColor" : "none"} />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Channel options for ${channel.slug}`}
              className="text-muted-foreground hover:text-foreground w-(--btn-h-xs) px-0 !rounded-md opacity-0 transition-opacity max-md:opacity-100 group-hover/channel:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal size={14} />
            </Button>
          </DropdownMenuTrigger>
          <ChannelMenu surface={DROPDOWN_MENU_SURFACE} {...menuProps} />
        </DropdownMenu>
      </div>
    </div>
  );
}
