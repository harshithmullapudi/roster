"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  channelsNeedingAttention,
  inboxThreadsKey,
} from "~/utils/channel-attention";
import { liveThreadsKey } from "~/utils/live-threads";
import { trpc } from "~/utils/trpc";

const REFRESH_MS = 30_000;

export function useChannelAttention(): Set<string> {
  const { data: live } = useQuery({
    queryKey: liveThreadsKey(),
    queryFn: () => trpc.threads.live.query(),
    refetchInterval: REFRESH_MS,
  });

  const { data: inbox } = useQuery({
    queryKey: inboxThreadsKey(),
    queryFn: () => trpc.threads.inbox.query(),
    refetchInterval: REFRESH_MS,
  });

  return useMemo(
    () => channelsNeedingAttention(live ?? [], inbox ?? []),
    [live, inbox],
  );
}
