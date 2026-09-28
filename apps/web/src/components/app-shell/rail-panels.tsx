"use client";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@roster/ui";
import type { ComponentProps, ReactNode } from "react";

type PanelGroupProps = ComponentProps<typeof ResizablePanelGroup>;

export interface RailSizes {
  main: string;
  rail: string;
}

const DEFAULT_SIZES: RailSizes = { main: "65", rail: "35" };

export interface RailPanelsProps {
  main: ReactNode;
  rail: ReactNode;
  sizes?: RailSizes;
  groupRef?: PanelGroupProps["groupRef"];
  onLayoutChanged?: PanelGroupProps["onLayoutChanged"];
}

export function RailPanels({
  main,
  rail,
  sizes = DEFAULT_SIZES,
  groupRef,
  onLayoutChanged,
}: RailPanelsProps) {
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      groupRef={groupRef}
      onLayoutChanged={onLayoutChanged}
      className="rail-group min-w-0 flex-1"
    >
      <ResizablePanel
        id="shell-main"
        defaultSize={sizes.main}
        minSize="35"
        className="flex min-w-0"
      >
        {main}
      </ResizablePanel>
      {rail ? (
        <>
          <ResizableHandle className="hover:bg-primary/40 transition-colors after:w-2" />
          <ResizablePanel
            id="shell-rail"
            defaultSize={sizes.rail}
            minSize="24"
            maxSize="60"
            className="flex min-w-0"
          >
            {rail}
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  );
}
