"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useChannelSeen } from "~/hooks/use-channel-attention";
import { useChannelRealtime } from "~/hooks/use-channel-realtime";
import { useCollapseCompleted } from "~/hooks/use-collapse-completed";
import type { MessageItem } from "~/types";
import { anchorRowIndex, buildChannelRows } from "~/utils/channel-rows";
import {
  removeThread,
  type ThreadItem,
  threadsKey,
} from "~/utils/thread-rows";
import {
  channelMessagesKey,
  markFailed,
  mergeMessage,
  mergeMessages,
  optimisticMessage,
  prependMessages,
  removeMessage,
  sortMessages,
} from "~/utils/message-cache";
import { trpc } from "~/utils/trpc";

import { WatchResumeOffer } from "~/components/channels/watch-resume-offer";

import { Composer, type ComposerSendPayload } from "./composer";
import { MessageList } from "./message-list";

export interface MessagePanelProps {
  projectId: string;
  channelName: string;
  basePath: string;
  memberId: string;
  authorName: string;
  authorEmail: string;
  initialMessages: MessageItem[];
  initialThreads: ThreadItem[];
  pausedCount: number;
}

const START_INDEX = 1_000_000;

const INITIAL_PAGE = 50;
const OLDER_PAGE = 100;

export function MessagePanel({
  projectId,
  channelName,
  basePath,
  memberId,
  authorName,
  authorEmail,
  initialMessages,
  initialThreads,
  pausedCount,
}: MessagePanelProps) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => channelMessagesKey(projectId), [projectId]);
  const router = useRouter();
  const openThreadId = useSearchParams().get("thread");

  const { data: messages } = useQuery({
    queryKey,
    queryFn: () => trpc.messages.list.query({ projectId, limit: INITIAL_PAGE }),
    initialData: initialMessages,
    structuralSharing: (previous, next) =>
      mergeMessages(
        (previous ?? []) as MessageItem[],
        next as MessageItem[],
      ) as typeof next,
  });

  const { data: threads } = useQuery({
    queryKey: threadsKey(projectId),
    queryFn: () => trpc.threads.list.query({ projectId }),
    initialData: initialThreads,
  });

  useChannelRealtime(projectId);
  useChannelSeen(projectId);

  const threadsByRootMessage = useMemo(
    () => new Map(threads.map((thread) => [thread.rootMessageId, thread])),
    [threads],
  );

  const { collapse } = useCollapseCompleted(projectId);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const toggleBand = useCallback((bandId: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(bandId)) next.add(bandId);
      return next;
    });
  }, []);

  const rows = useMemo(
    () =>
      buildChannelRows(messages, threadsByRootMessage, { collapse, expanded }),
    [messages, threadsByRootMessage, collapse, expanded],
  );

  const [anchorId, setAnchorId] = useState<string | undefined>(
    () => initialMessages[0]?.id,
  );

  const above = anchorRowIndex(rows, anchorId);
  const firstItemIndex = START_INDEX - (above ?? 0);

  useEffect(() => {
    if (above === null) setAnchorId(messages[0]?.id);
  }, [above, messages]);

  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(initialMessages.length >= INITIAL_PAGE);

  const loadOlder = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return;

    const current = queryClient.getQueryData<MessageItem[]>(queryKey) ?? [];
    const oldest = current.find((message) => !message.pending);
    if (!oldest) return;

    loadingRef.current = true;
    setLoadingOlder(true);
    try {
      const older = await trpc.messages.list.query({
        projectId,
        before: oldest.seq,
        limit: OLDER_PAGE,
      });
      if (older.length < OLDER_PAGE) hasMoreRef.current = false;

      queryClient.setQueryData<MessageItem[]>(queryKey, (previous) =>
        prependMessages(previous ?? [], older as MessageItem[]),
      );
    } catch {
      console.warn("[messages] could not load older messages");
    } finally {
      loadingRef.current = false;
      setLoadingOlder(false);
    }
  }, [projectId, queryClient, queryKey]);

  const stickToBottom = useRef<(() => void) | undefined>(undefined);

  async function send(payload: ComposerSendPayload) {
    stickToBottom.current?.();

    const clientId = crypto.randomUUID();
    const optimistic = optimisticMessage({
      projectId,
      clientId,
      body: payload.body,
      text: payload.text,
      authorName,
      authorEmail,
      attachments: payload.attachments,
    });

    queryClient.setQueryData<MessageItem[]>(queryKey, (previous) =>
      sortMessages([...(previous ?? []), optimistic]),
    );

    try {
      const saved = await trpc.messages.send.mutate({
        projectId,
        body: payload.body,
        text: payload.text,
        clientId,
        attachmentIds: payload.attachmentIds,
      });
      queryClient.setQueryData<MessageItem[]>(queryKey, (previous) =>
        mergeMessage(previous ?? [], saved),
      );
    } catch {
      queryClient.setQueryData<MessageItem[]>(queryKey, (previous) =>
        markFailed(previous ?? [], clientId),
      );
    }
  }

  const remove = useCallback(
    async (messageId: string) => {
      const known =
        queryClient.getQueryData<ThreadItem[]>(threadsKey(projectId)) ?? [];
      const thread = known.find((item) => item.rootMessageId === messageId);

      queryClient.setQueryData<MessageItem[]>(queryKey, (previous) =>
        removeMessage(previous ?? [], messageId),
      );
      if (thread) {
        queryClient.setQueryData<ThreadItem[]>(
          threadsKey(projectId),
          (previous) => removeThread(previous ?? [], thread.id),
        );
        if (openThreadId === thread.id) router.replace(basePath);
      }

      try {
        await trpc.messages.remove.mutate({ projectId, messageId });
      } catch {
        console.warn("[messages] delete failed");
        await queryClient.invalidateQueries({ queryKey });
        await queryClient.invalidateQueries({ queryKey: threadsKey(projectId) });
      }
    },
    [projectId, queryClient, queryKey, openThreadId, router, basePath],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <MessageList
          channelName={channelName}
          rows={rows}
          empty={messages.length === 0}
          threadsByRootMessage={threadsByRootMessage}
          openThreadId={openThreadId}
          basePath={basePath}
          memberId={memberId}
          firstItemIndex={firstItemIndex}
          loadingOlder={loadingOlder}
          onLoadOlder={loadOlder}
          onDelete={remove}
          onToggleBand={toggleBand}
          onSentRef={stickToBottom}
        />
      </div>
      <div className="pb-safe-2 shrink-0 px-2 sm:px-4 sm:pb-4">
        {pausedCount > 0 ? (
          <WatchResumeOffer projectId={projectId} count={pausedCount} />
        ) : null}
        <Composer
          placeholder={`Message #${channelName}`}
          projectId={projectId}
          onSend={send}
        />
      </div>
    </div>
  );
}
