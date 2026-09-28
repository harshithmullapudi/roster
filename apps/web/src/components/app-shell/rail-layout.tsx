"use client";

import { useGroupRef } from "@roster/ui";
import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";

import {
  parseRailLayout,
  railLayoutKey,
  railLayoutReady,
  shouldPersistRailLayout,
  type RailLayout as StoredRailLayout,
} from "~/utils/rail-layout";

import { RailPanels, type RailSizes } from "./rail-panels";

export interface RailLayoutOptions {
  storageId: string;
  sizes: RailSizes;
}

export interface RailLayoutProps {
  main: ReactNode;
  rail: ReactNode;
  options?: RailLayoutOptions;
}

export function RailLayout({ main, rail, options }: RailLayoutProps) {
  const storageId = options?.storageId ?? "roster.thread-rail";
  const groupRef = useGroupRef();
  const hasRail = rail !== null && rail !== undefined;

  const pendingLayout = useRef<StoredRailLayout | null>(null);

  useLayoutEffect(() => {
    if (!hasRail) {
      pendingLayout.current = null;
      return;
    }
    const stored = parseRailLayout(
      window.localStorage.getItem(railLayoutKey(storageId)),
    );
    if (!stored) return;
    const group = groupRef.current;
    if (group && railLayoutReady(group.getLayout())) {
      group.setLayout(stored);
    } else {
      pendingLayout.current = stored;
    }
  }, [storageId, hasRail, groupRef]);

  const persist = useCallback(
    (layout: Record<string, number>, meta: { isUserInteraction: boolean }) => {
      const pending = pendingLayout.current;
      if (pending && railLayoutReady(layout)) {
        pendingLayout.current = null;
        groupRef.current?.setLayout(pending);
        return;
      }
      if (!shouldPersistRailLayout(layout, meta.isUserInteraction)) return;
      try {
        window.localStorage.setItem(
          railLayoutKey(storageId),
          JSON.stringify(layout),
        );
      } catch {
        return;
      }
    },
    [storageId, groupRef],
  );

  return (
    <RailPanels
      main={main}
      rail={rail}
      sizes={options?.sizes}
      groupRef={groupRef}
      onLayoutChanged={persist}
    />
  );
}
