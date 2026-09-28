"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import {
  channelAttentionKey,
  dropChannelAttention,
} from "~/utils/channel-attention";
import { trpc } from "~/utils/trpc";

const REFRESH_MS = 30_000;

export function useChannelAttention(): Set<string> {
  const { data } = useQuery({
    queryKey: channelAttentionKey(),
    queryFn: () => trpc.channels.attention.query(),
    refetchInterval: REFRESH_MS,
  });

  return useMemo(() => new Set(data ?? []), [data]);
}

/*
 * While a channel is open, the member is reading it: mark it seen on entry
 * and keep the mark fresh so messages arriving mid-visit don't leave the
 * channel bold after they walk away.
 */
export function useChannelSeen(projectId: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let disposed = false;

    async function markSeen() {
      try {
        await trpc.channels.markSeen.mutate({ projectId });
        if (disposed) return;
        queryClient.setQueryData<string[]>(channelAttentionKey(), (previous) =>
          dropChannelAttention(previous, projectId),
        );
      } catch {
        console.warn("[channels] mark seen failed");
      }
    }

    void markSeen();
    const timer = setInterval(() => void markSeen(), REFRESH_MS);

    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [projectId, queryClient]);
}
