"use client";

import { Folder, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Virtuoso } from "react-virtuoso";

import { useTailFollow } from "~/hooks/use-tail-follow";
import type { MessageItem } from "~/types";
import { type ChannelRow, rowKey } from "~/utils/channel-rows";
import { startsNewGroup } from "~/utils/message-groups";
import type { ThreadItem } from "~/utils/thread-rows";

import { CompletedBand } from "./completed-band";
import { MessageRow } from "./message-row";

export interface MessageListProps {
  channelName: string;
  rows: ChannelRow<MessageItem>[];
  empty: boolean;
  threadsByRootMessage: Map<string, ThreadItem>;
  basePath: string;
  memberId: string;
  firstItemIndex: number;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onDelete: (messageId: string) => Promise<void>;
  onToggleBand: (bandId: string) => void;
  onSentRef?: React.MutableRefObject<(() => void) | undefined>;
}

function messageKey(message: MessageItem): string {
  return message.clientId ?? message.id;
}

export function MessageList({
  channelName,
  rows,
  empty,
  threadsByRootMessage,
  basePath,
  memberId,
  firstItemIndex,
  loadingOlder,
  onLoadOlder,
  onDelete,
  onToggleBand,
  onSentRef,
}: MessageListProps) {
  const row = useCallback(
    (virtuosoIndex: number, item: ChannelRow<MessageItem>) => {
      if (item.kind === "band") {
        return (
          <CompletedBand
            count={item.messageIds.length}
            lastAt={item.lastAt}
            expanded={item.expanded}
            onToggle={() => onToggleBand(item.id)}
          />
        );
      }

      const position = virtuosoIndex - firstItemIndex;
      const before = rows[position - 1];
      const previous = before?.kind === "message" ? before.message : undefined;
      const message = item.message;
      const thread = threadsByRootMessage.get(message.id);

      return (
        <MessageRow
          message={message}
          leading={startsNewGroup(
            message,
            previous,
            previous ? threadsByRootMessage.has(previous.id) : false,
          )}
          thread={thread}
          threadHref={thread ? `${basePath}?thread=${thread.id}` : undefined}
          memberId={memberId}
          onDelete={onDelete}
        />
      );
    },
    [
      firstItemIndex,
      rows,
      threadsByRootMessage,
      basePath,
      memberId,
      onDelete,
      onToggleBand,
    ],
  );

  const tail = useTailFollow({ onReachTop: onLoadOlder });
  const followedKey = useRef<string | undefined>(undefined);

  const newest = rows[rows.length - 1];
  const newestKey = newest ? rowKey(newest, messageKey) : undefined;

  useEffect(() => {
    if (!loadingOlder && tail.restingAtTop()) onLoadOlder();
  }, [loadingOlder, onLoadOlder, tail]);

  useEffect(() => {
    if (onSentRef) onSentRef.current = tail.stick;
  }, [onSentRef, tail.stick]);

  useEffect(() => {
    if (newestKey === undefined || newestKey === followedKey.current) return;
    followedKey.current = newestKey;
    if (tail.following()) tail.followTail();
  }, [newestKey, tail]);

  const components = useMemo(
    () => ({
      Header: () =>
        loadingOlder ? <OlderSpinner /> : <span className="block h-2" />,
      Footer: () => <span className="block h-3" />,
    }),
    [loadingOlder],
  );

  if (empty) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-10">
        <Folder className="text-muted-foreground size-5" />
        <p className="text-base font-medium">This is #{channelName}</p>
        <p className="text-muted-foreground text-sm">
          Send the first message to get things going.
        </p>
      </div>
    );
  }

  return (
    <Virtuoso
      className="min-h-0 flex-1"
      data={rows}
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={{ index: "LAST", align: "end" }}
      ref={tail.listRef}
      startReached={tail.reachedTop}
      atTopStateChange={tail.atTopChanged}
      atBottomStateChange={tail.atBottomChanged}
      scrollerRef={tail.attachScroller}
      totalListHeightChanged={tail.heightChanged}
      atBottomThreshold={80}
      increaseViewportBy={{ top: 600, bottom: 600 }}
      computeItemKey={(_index, item) => rowKey(item, messageKey)}
      itemContent={row}
      components={components}
    />
  );
}

function OlderSpinner() {
  return (
    <span className="flex items-center justify-center py-3">
      <Loader2 className="text-muted-foreground size-4 animate-spin" />
    </span>
  );
}
