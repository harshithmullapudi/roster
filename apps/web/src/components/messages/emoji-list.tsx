"use client";

import { cn } from "@roster/ui";
import type { SuggestionProps } from "@tiptap/suggestion";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { type EmojiItem, parseEmojiQuery } from "~/utils/emojis";

export interface EmojiListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const EmojiList = forwardRef<
  EmojiListHandle,
  SuggestionProps<EmojiItem, EmojiItem>
>(function EmojiList({ items, command, query }, ref) {
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setSelected(0), [items]);

  useEffect(() => {
    listRef.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected, items]);

  function choose(index: number) {
    const item = items[index];
    if (item) command(item);
  }

  const complete = parseEmojiQuery(query)?.complete ?? false;
  const committed = useRef(false);

  useEffect(() => {
    const only = items.length === 1 ? items[0] : undefined;
    if (!complete || !only || committed.current) return;
    committed.current = true;
    command(only);
  }, [complete, items, command]);

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

  if (items.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="bg-background-3 border-border flex max-h-72 w-70 flex-col gap-0.5 overflow-y-auto rounded-lg border p-1 shadow-md"
    >
      {items.map((item, index) => (
        <button
          key={item.hexcode}
          type="button"
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
            index === selected ? "bg-grayAlpha-100" : "hover:bg-grayAlpha-50",
          )}
          onMouseEnter={() => setSelected(index)}
          onClick={() => choose(index)}
        >
          <span className="w-5 shrink-0 text-center text-base" aria-hidden>
            {item.unicode}
          </span>
          <span className="text-foreground font-medium">:{item.name}:</span>
          <span className="text-muted-foreground ml-auto truncate text-xs">
            {item.label}
          </span>
        </button>
      ))}
    </div>
  );
});
