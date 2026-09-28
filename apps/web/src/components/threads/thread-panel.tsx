"use client";

import type { ThreadDetail } from "@roster/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";

import {
  Composer,
  type ComposerSendPayload,
} from "~/components/messages/composer";
import { MessageRow } from "~/components/messages/message-row";
import { useTailFollow } from "~/hooks/use-tail-follow";
import { useThreadRealtime } from "~/hooks/use-thread-realtime";
import type { MessageItem } from "~/types";
import { liveThreadsKey } from "~/utils/live-threads";
import { optimisticMessage } from "~/utils/message-cache";
import { startsNewGroup } from "~/utils/message-groups";
import { unreadCountKey } from "~/utils/notification-cache";
import {
  addReply,
  detailMessages,
  failReply,
  mergeDetail,
  mergeReply,
  prependReplies,
  splitThread,
} from "~/utils/thread-detail";
import {
  markThreadSeen,
  needsInput,
  type ThreadItem,
  threadDetailKey,
  threadsKey,
} from "~/utils/thread-rows";
import { trpc } from "~/utils/trpc";

import { ReplyDivider } from "./reply-divider";
import { ThreadLiveBar } from "./thread-live-bar";

export interface ThreadPanelProps {
  projectId: string;
  threadId: string;
  memberId: string;
  authorName: string;
  authorEmail: string;
  initialDetail: ThreadDetail;
}

export function ThreadPanel({
  projectId,
  threadId,
  memberId,
  authorName,
  authorEmail,
  initialDetail,
}: ThreadPanelProps) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => threadDetailKey(threadId), [threadId]);

  const { data: detail } = useQuery({
    queryKey,
    queryFn: () =>
      trpc.threads.get.query({ projectId, threadId, limit: INITIAL_PAGE }),
    initialData: initialDetail,
    structuralSharing: (previous, next) =>
      previous
        ? (mergeDetail(
            previous as ThreadDetail,
            next as ThreadDetail,
          ) as typeof next)
        : next,
  });

  useThreadRealtime(threadId, projectId);

  const status = detail.thread.status;

  useEffect(() => {
    let dropped = false;

    void trpc.notifications.markThreadRead
      .mutate({ threadId })
      .then((subscription) => {
        const seenAt = subscription.lastReadAt;
        if (dropped || !seenAt) return;

        queryClient.setQueryData<ThreadItem[]>(
          threadsKey(projectId),
          (previous) =>
            previous ? markThreadSeen(previous, threadId, seenAt) : previous,
        );
        void queryClient.invalidateQueries({ queryKey: unreadCountKey() });
        void queryClient.invalidateQueries({ queryKey: liveThreadsKey() });
      })
      .catch(() => undefined);

    return () => {
      dropped = true;
    };
  }, [projectId, threadId, status, queryClient]);

  const asking = needsInput(detail.thread.status);
  const { root, replies } = splitThread(detail);

  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(
    detailMessages(initialDetail).filter(
      (message) => message.id !== initialDetail.thread.rootMessageId,
    ).length >= INITIAL_PAGE,
  );

  const loadOlder = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return;

    const current = queryClient.getQueryData<ThreadDetail>(queryKey);
    if (!current) return;
    const oldest = detailMessages(current).find(
      (message) =>
        !message.pending && message.id !== current.thread.rootMessageId,
    );
    if (!oldest) {
      hasMoreRef.current = false;
      return;
    }

    loadingRef.current = true;
    setLoadingOlder(true);
    try {
      const older = await trpc.threads.get.query({
        projectId,
        threadId,
        before: oldest.seq,
        limit: OLDER_PAGE,
      });
      if (older.messages.length < OLDER_PAGE) hasMoreRef.current = false;

      let added = 0;
      queryClient.setQueryData<ThreadDetail>(queryKey, (previous) => {
        if (!previous) return previous;
        const next = prependReplies(previous, older.messages as MessageItem[]);
        added = next.messages.length - previous.messages.length;
        return next;
      });
      if (added > 0) setFirstItemIndex((index) => index - added);
    } catch {
      console.warn("[thread] could not load older replies");
    } finally {
      loadingRef.current = false;
      setLoadingOlder(false);
    }
  }, [projectId, threadId, queryClient, queryKey]);

  const reachTop = useCallback(() => void loadOlder(), [loadOlder]);
  const tail = useTailFollow({ onReachTop: reachTop });

  async function send(payload: ComposerSendPayload) {
    tail.stick();

    const clientId = crypto.randomUUID();
    const optimistic: MessageItem = {
      ...optimisticMessage({
        projectId,
        clientId,
        body: payload.body,
        text: payload.text,
        authorName,
        authorEmail,
        attachments: payload.attachments,
      }),
      threadId,
      parentMessageId: detail.thread.rootMessageId,
    };

    queryClient.setQueryData<ThreadDetail>(queryKey, (previous) =>
      previous ? addReply(previous, optimistic) : previous,
    );

    try {
      const saved = await trpc.messages.send.mutate({
        projectId,
        body: payload.body,
        text: payload.text,
        clientId,
        threadId,
        attachmentIds: payload.attachmentIds,
      });
      queryClient.setQueryData<ThreadDetail>(queryKey, (previous) =>
        previous ? mergeReply(previous, saved as MessageItem) : previous,
      );
    } catch {
      queryClient.setQueryData<ThreadDetail>(queryKey, (previous) =>
        previous ? failReply(previous, clientId) : previous,
      );
    }
  }

  const reply = useCallback(
    (index: number, message: MessageItem) => {
      const position = index - firstItemIndex;
      return (
        <MessageRow
          message={message}
          memberId={memberId}
          leading={startsNewGroup(message, replies[position - 1])}
        />
      );
    },
    [firstItemIndex, replies, memberId],
  );

  const header = useMemo(
    () =>
      function Header() {
        return (
          <>
            {root ? (
              <MessageRow message={root} memberId={memberId} leading />
            ) : null}
            {loadingOlder ? (
              <span className="flex items-center justify-center py-3">
                <Loader2 className="text-muted-foreground size-4 animate-spin" />
              </span>
            ) : (
              <ReplyDivider count={detail.thread.replyCount} />
            )}
          </>
        );
      },
    [root, memberId, loadingOlder, detail.thread.replyCount],
  );

  const components = useMemo(() => ({ Header: header }), [header]);

  const followedKey = useRef<string | undefined>(undefined);

  const newestReply = replies[replies.length - 1];
  const newestKey = newestReply
    ? (newestReply.clientId ?? newestReply.id)
    : undefined;

  useEffect(() => {
    if (!loadingOlder && tail.restingAtTop()) void loadOlder();
  }, [loadingOlder, loadOlder, tail]);

  useEffect(() => {
    if (newestKey === undefined || newestKey === followedKey.current) return;
    followedKey.current = newestKey;
    if (tail.following()) tail.followTail();
  }, [newestKey, tail]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Virtuoso
        className="min-h-0 flex-1"
        ref={tail.listRef}
        scrollerRef={tail.attachScroller}
        data={replies}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={{ index: "LAST", align: "end" }}
        startReached={tail.reachedTop}
        atTopStateChange={tail.atTopChanged}
        atBottomStateChange={tail.atBottomChanged}
        totalListHeightChanged={tail.heightChanged}
        atBottomThreshold={80}
        increaseViewportBy={{ top: 600, bottom: 600 }}
        computeItemKey={(_index, message) => message.clientId ?? message.id}
        itemContent={reply}
        components={components}
      />

      <ThreadLiveBar
        projectId={projectId}
        threadId={threadId}
        thread={detail.thread}
      />

      <div className="pb-safe-2 shrink-0 px-2 pt-2 sm:px-3 sm:pb-3">
        <Composer
          placeholder={asking ? "Answer…" : "Reply…"}
          projectId={projectId}
          threadId={threadId}
          onSend={send}
        />
      </div>
    </div>
  );
}

const INITIAL_PAGE = 50;
const OLDER_PAGE = 25;

const START_INDEX = 1_000_000;
