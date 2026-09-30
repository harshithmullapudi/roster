"use client";

import {
  Button,
  cn,
  InputGroup,
  InputGroupAddon,
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@roster/ui";
import { CircleCheck, MessageSquare, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useSearch } from "~/hooks/use-search";
import { messageHref, searchable, taskHref } from "~/utils/search";

import { Snippet } from "./snippet";

export interface ChannelSearchProps {
  projectId: string;
  orgSlug: string;
  channelSlug: string;
}

export function ChannelSearch({
  projectId,
  orgSlug,
  channelSlug,
}: ChannelSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const { results, pending } = useSearch({ query, projectId, enabled: open });
  const empty =
    searchable(query) &&
    !pending &&
    results.messages.length === 0 &&
    results.tasks.length === 0;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          isActive={open}
          className={cn(
            "text-muted-foreground ml-auto shrink-0 gap-1.5 !rounded-md px-2 text-sm",
            open && "!bg-accent !text-accent-foreground",
          )}
          aria-label={`Search ${channelSlug}`}
        >
          <Search size={14} />
          <span className="hidden sm:inline">Search</span>
        </Button>
      </PopoverTrigger>

      <PopoverPortal>
        <PopoverContent align="end" sideOffset={6} className="w-96 p-1">
          <InputGroup className="bg-input/30 border-input/30 h-8! rounded-lg! shadow-none! *:data-[slot=input-group-addon]:pl-2!">
            <InputGroupAddon>
              <Search size={14} className="text-muted-foreground" />
            </InputGroupAddon>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${channelSlug}...`}
              aria-label={`Search ${channelSlug}`}
              className="outline-hidden w-full bg-transparent px-2 text-sm"
              autoFocus
            />
          </InputGroup>

          <div className="max-h-80 overflow-y-auto pt-1">
            {!searchable(query) ? (
              <p className="text-muted-foreground px-2 py-3 text-xs">
                Type at least two characters.
              </p>
            ) : empty ? (
              <p className="text-muted-foreground px-2 py-3 text-sm">
                Nothing in this channel matches “{query.trim()}”.
              </p>
            ) : null}

            {results.messages.length > 0 && (
              <>
                <p className="text-muted-foreground px-2 pb-1 pt-1.5 text-xs">
                  Messages
                </p>
                {results.messages.map((hit) => (
                  <Link
                    key={hit.id}
                    href={messageHref(orgSlug, hit)}
                    onClick={() => setOpen(false)}
                    className="hover:bg-accent flex flex-col gap-0.5 rounded-md px-2 py-1.5"
                  >
                    <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                      <MessageSquare size={11} className="shrink-0" />
                      <span className="truncate">{hit.author ?? "Someone"}</span>
                    </span>
                    <Snippet
                      snippet={hit.snippet}
                      className="text-muted-foreground line-clamp-2 text-sm"
                    />
                  </Link>
                ))}
              </>
            )}

            {results.tasks.length > 0 && (
              <>
                <p className="text-muted-foreground px-2 pb-1 pt-1.5 text-xs">
                  Tasks
                </p>
                {results.tasks.map((hit) => (
                  <Link
                    key={hit.id}
                    href={taskHref(orgSlug, hit)}
                    onClick={() => setOpen(false)}
                    className="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                  >
                    <CircleCheck
                      size={12}
                      className="text-muted-foreground shrink-0"
                    />
                    <Snippet snippet={hit.snippet} className="min-w-0 truncate" />
                    <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                      {hit.status.replace("_", " ")}
                    </span>
                  </Link>
                ))}
              </>
            )}
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
