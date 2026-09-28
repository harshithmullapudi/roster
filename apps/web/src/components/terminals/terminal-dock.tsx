"use client";

import { Button } from "@roster/ui";
import { Maximize2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";

import { DockHierarchy, useDockHierarchy } from "./dock-hierarchy";
import { useDock } from "./dock-provider";
import { TerminalView } from "./terminal-view";

const MIN_HEIGHT = 160;

export function TerminalDock() {
  const { orgSlug, folder, mode, setMode, height, setHeight } = useDock();
  const router = useRouter();
  const state = useDockHierarchy();
  const {
    openWorktrees,
    closedWorktrees,
    activeWorktree,
    isClosed,
    workspaceId,
    activeTerminalId,
  } = state;

  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const onDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragRef.current = { startY: event.clientY, startHeight: height };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const next = drag.startHeight + (drag.startY - event.clientY);
    setHeight(Math.min(Math.max(next, MIN_HEIGHT), window.innerHeight - 120));
  };

  const onDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (mode === "closed") return null;

  return (
    <div
      className="bg-background-2 relative flex shrink-0 flex-col overflow-hidden border-t border-gray-300"
      style={{ height }}
    >
      <div
        role="separator"
        aria-label="Resize agent panel"
        onPointerDown={onDragStart}
        onPointerMove={onDrag}
        onPointerUp={onDragEnd}
        className="group absolute inset-x-0 top-0 z-10 flex h-1.5 cursor-row-resize items-center justify-center"
      >
        <span className="bg-muted-foreground/50 group-hover:bg-muted-foreground h-0.5 w-4 rounded-full transition-colors" />
      </div>

      <div className="flex items-center gap-1.5 p-1.5">
        <DockHierarchy state={state} />

        <span className="flex-1" />

        <Button
          variant="ghost"
          className="!h-6 !rounded-md px-1.5"
          aria-label="Open full screen"
          disabled={!folder || !activeWorktree || isClosed}
          onClick={() => {
            if (!folder || !activeWorktree || isClosed) return;
            setMode("closed");
            router.push(
              `/${orgSlug}/${folder.channelSlug}/thread/${activeWorktree.threadId}/session`,
            );
          }}
        >
          <Maximize2 size={14} />
        </Button>
        <Button
          variant="ghost"
          className="!h-6 !rounded-md px-1.5"
          aria-label="Close agent panel"
          onClick={() => setMode("closed")}
        >
          <X size={14} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 bg-[#0a0a0a]">
        {!folder ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground text-xs">
              Pick a folder to see its agents.
            </p>
          </div>
        ) : isClosed && activeWorktree ? (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <p className="text-muted-foreground text-xs">
              This workspace was cleaned up after the thread went quiet.
            </p>
            <Link
              href={`/${orgSlug}/${folder.channelSlug}?thread=${activeWorktree.threadId}`}
              className="text-primary text-xs hover:underline"
              onClick={() => setMode("closed")}
            >
              View thread →
            </Link>
          </div>
        ) : workspaceId && activeTerminalId ? (
          <TerminalView
            key={activeTerminalId}
            orgSlug={orgSlug}
            projectId={folder.projectId}
            workspaceId={workspaceId}
            terminalId={activeTerminalId}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground text-xs">
              {openWorktrees.length
                ? "No agents in this thread’s worktree — start one with +"
                : closedWorktrees.length
                  ? "No open workspaces — pick a closed one to find its thread."
                  : "No workspaces yet. One appears when an agent replies in a thread."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
