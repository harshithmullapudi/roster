"use client";

import { useGroupRef } from "@roster/ui";
import { useCallback, useLayoutEffect, type ReactNode } from "react";

import {
  parseRailLayout,
  railLayoutKey,
  shouldPersistRailLayout,
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

  useLayoutEffect(() => {
    if (!hasRail) return;
    const stored = parseRailLayout(
      window.localStorage.getItem(railLayoutKey(storageId)),
    );
    if (stored) groupRef.current?.setLayout(stored);
  }, [storageId, hasRail, groupRef]);

  const persist = useCallback(
    (layout: Record<string, number>, meta: { isUserInteraction: boolean }) => {
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
    [storageId],
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
