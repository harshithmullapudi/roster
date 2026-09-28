"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Centrifuge } from "centrifuge";
import { useEffect } from "react";

import {
  prepareDesktopNotifications,
  showDesktopNotification,
} from "~/utils/desktop-notify";
import { channelAttentionKey } from "~/utils/channel-attention";
import { liveThreadsKey } from "~/utils/live-threads";
import {
  applyUnreadDelta,
  parsePublishedNotification,
  unreadCountKey,
} from "~/utils/notification-cache";
import { trpc } from "~/utils/trpc";

export function useUserRealtime(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let disposed = false;
    let centrifuge: Centrifuge | null = null;
    const counted = new Set<string>();

    async function refreshCount(reason: string) {
      try {
        const unread = await trpc.notifications.unreadCount.query();
        if (disposed) return;
        queryClient.setQueryData<number>(unreadCountKey(), unread);
        console.info(`[realtime] unread count refreshed (${reason})`);
      } catch {
        console.warn("[realtime] unread count refresh failed");
      }
    }

    async function start() {
      let connection;
      try {
        connection = await trpc.realtime.connectionToken.query();
      } catch {
        console.warn("[realtime] no connection token, staying on trpc only");
        return;
      }
      if (disposed || !connection.enabled) return;

      const instance = new Centrifuge(connection.url, {
        token: connection.token,
        getToken: async () => {
          const next = await trpc.realtime.connectionToken.query();
          if (!next.enabled) throw new Error("Realtime is disabled.");
          return next.token;
        },
      });
      centrifuge = instance;

      instance.on("error", (ctx) => {
        console.warn(`[realtime] connection error: ${ctx.error.message}`);
      });

      let subscription;
      try {
        const authorized = await trpc.realtime.userSubscriptionToken.query();
        if (disposed || !authorized.enabled) return;

        subscription = instance.newSubscription(authorized.channel, {
          token: authorized.token,
          getToken: async () => {
            const next = await trpc.realtime.userSubscriptionToken.query();
            if (!next.enabled) throw new Error("Realtime is disabled.");
            return next.token;
          },
        });
      } catch {
        console.warn("[realtime] inbox not authorized, staying on trpc only");
        return;
      }

      subscription.on("publication", (ctx) => {
        const item = parsePublishedNotification(ctx.data);
        if (!item || counted.has(item.id)) return;
        counted.add(item.id);

        queryClient.setQueryData<number>(unreadCountKey(), (previous) =>
          applyUnreadDelta(previous, 1),
        );
        void queryClient.invalidateQueries({ queryKey: liveThreadsKey() });
        void queryClient.invalidateQueries({ queryKey: channelAttentionKey() });

        void showDesktopNotification(item);
      });

      subscription.on("subscribed", (ctx) => {
        if (ctx.recovered) return;
        void refreshCount(
          ctx.wasRecovering ? "recovery failed" : "first subscribe",
        );
      });

      subscription.on("error", (ctx) => {
        console.warn(`[realtime] subscription error: ${ctx.error.message}`);
      });

      subscription.subscribe();
      instance.connect();
    }

    void prepareDesktopNotifications();
    void start();

    return () => {
      disposed = true;
      centrifuge?.disconnect();
      centrifuge = null;
    };
  }, [queryClient]);
}
