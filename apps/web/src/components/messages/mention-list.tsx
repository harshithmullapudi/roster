"use client";

import { cn } from "@roster/ui";
import type { SuggestionProps } from "@tiptap/suggestion";
import { Lock, User } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { ChannelMark } from "~/components/logo/channel-mark";
import {
  type MentionAttrs,
  mentionAttrs,
  type MentionItem,
} from "~/utils/mentions";

export interface MentionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const MentionList = forwardRef<
  MentionListHandle,
  SuggestionProps<MentionItem, MentionAttrs>
>(function MentionList({ items, command }, ref) {
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setSelected(0), [items]);

  useEffect(() => {
    listRef.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected, items]);

  function choose(index: number) {
    const item = items[index];
    if (item) command(mentionAttrs(item));
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (items.length === 0) return false;

      if (event.key === "ArrowUp") {
        setSelected((current) => (current + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelected((current) => (current + 1) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        choose(selected);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="bg-background-3 border-border text-muted-foreground w-70 rounded-lg border p-2 text-xs shadow-md">
        Nobody matches that.
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="bg-background-3 border-border flex max-h-72 w-70 flex-col gap-0.5 overflow-y-auto rounded-lg border p-1 shadow-md"
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
            index === selected ? "bg-grayAlpha-100" : "hover:bg-grayAlpha-50",
          )}
          onMouseEnter={() => setSelected(index)}
          onClick={() => choose(index)}
        >
          {item.kind === "member" ? (
            <User className="text-muted-foreground size-3.5 shrink-0" />
          ) : item.visibility === "private" ? (
            <Lock className="text-muted-foreground size-3.5 shrink-0" />
          ) : (
            <ChannelMark className="text-muted-foreground" />
          )}
          <span className="text-foreground font-medium">{item.handle}</span>
          <span className="text-muted-foreground ml-auto truncate text-xs">
            {item.kind === "member" ? item.name : item.display}
          </span>
        </button>
      ))}
    </div>
  );
});
