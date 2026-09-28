"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  cn,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@roster/ui";
import { Maximize2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { errorMessage, trpc } from "~/utils/trpc";

import { useDock } from "./dock-provider";
import { NewSessionPopover } from "./new-session-popover";
import { SessionTabs } from "./session-tabs";
import { TerminalView } from "./terminal-view";

const MIN_HEIGHT = 160;

/*
 * A channel can accumulate closed folders forever, so the picker keeps only
 * the freshest few — enough to find the thread you were just in, not an
 * archive.
 */
const CLOSED_LIMIT = 10;

function worktreeLabel(label: string): string {
  const firstLine = label.split("\n")[0]?.trim() ?? "";
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine || "Untitled";
}

export function TerminalDock() {
  const { channel, mode, setMode, selection, select, height, setHeight } = useDock();
  const router = useRouter();
  const queryClient = useQueryClient();
  const projectId = channel?.projectId ?? null;

  const { data: worktrees } = useQuery({
    queryKey: ["terminals", "worktrees", projectId, "all"],
    queryFn: () =>
      trpc.terminals.worktrees.query({
        projectId: projectId as string,
        includeClosed: true,
      }),
    enabled: Boolean(projectId) && mode !== "closed",
    refetchInterval: 15_000,
  });

  const { openWorktrees, closedWorktrees } = useMemo(() => {
    const all = worktrees ?? [];
    return {
      openWorktrees: all.filter((worktree) => !worktree.closedAt),
      closedWorktrees: all
        .filter((worktree) => worktree.closedAt)
        .slice(0, CLOSED_LIMIT),
    };
  }, [worktrees]);

  const activeWorktree = useMemo(() => {
    const chosen = [...openWorktrees, ...closedWorktrees].find(
      (worktree) => worktree.workspaceId === selection?.workspaceId,
    );
    return chosen ?? openWorktrees[0] ?? null;
  }, [openWorktrees, closedWorktrees, selection]);

  const isClosed = Boolean(activeWorktree?.closedAt);
  const workspaceId = activeWorktree?.workspaceId ?? null;

  const { data: sessions } = useQuery({
    queryKey: ["terminals", "sessions", projectId, workspaceId],
    queryFn: () =>
      trpc.terminals.sessions.query({
        projectId: projectId as string,
        workspaceId: workspaceId as string,
      }),
    enabled: Boolean(projectId && workspaceId) && !isClosed && mode !== "closed",
    refetchInterval: 10_000,
  });

  const live = useMemo(
    () => (isClosed ? [] : (sessions ?? []).filter((session) => !session.exited)),
    [sessions, isClosed],
  );

  const activeTerminalId = useMemo(() => {
    if (!live.length) return null;
    const chosen = live.find(
      (session) => session.terminalId === selection?.terminalId,
    );
    return (chosen ?? live[0])?.terminalId ?? null;
  }, [live, selection]);

  useEffect(() => {
    if (!workspaceId) return;
    if (
      selection?.workspaceId === workspaceId &&
      selection.terminalId === activeTerminalId
    ) {
      return;
    }
    select({ workspaceId, terminalId: activeTerminalId });
  }, [workspaceId, activeTerminalId, selection, select]);

  const refreshSessions = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["terminals", "sessions", projectId, workspaceId],
    });
  }, [queryClient, projectId, workspaceId]);

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

  if (mode === "closed" || !channel || !projectId) return null;

  const closeSession = async (terminalId: string) => {
    if (!workspaceId) return;
    try {
      await trpc.terminals.close.mutate({ projectId, workspaceId, terminalId });
    } catch (cause) {
      console.warn(errorMessage(cause, "Could not close that session."));
    }
    refreshSessions();
  };

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
        <Select
          value={workspaceId ?? undefined}
          onValueChange={(next) => select({ workspaceId: next, terminalId: null })}
        >
          <SelectTrigger
            showIcon
            className="!h-6 !min-h-6 w-44 shrink-0 px-2 text-xs"
          >
            <SelectValue placeholder="No threads yet" />
          </SelectTrigger>
          <SelectContent className="max-w-72">
            {closedWorktrees.length > 0 ? (
              <SelectGroup>
                <SelectLabel className="text-muted-foreground text-xs font-medium">
                  Open
                </SelectLabel>
                {openWorktrees.map((worktree) => (
                  <SelectItem
                    key={worktree.workspaceId}
                    value={worktree.workspaceId}
                  >
                    <span className="block truncate">
                      {worktreeLabel(worktree.label)}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : (
              openWorktrees.map((worktree) => (
                <SelectItem
                  key={worktree.workspaceId}
                  value={worktree.workspaceId}
                >
                  <span className="block truncate">
                    {worktreeLabel(worktree.label)}
                  </span>
                </SelectItem>
              ))
            )}

            {closedWorktrees.length > 0 ? (
              <>
                {openWorktrees.length > 0 ? <SelectSeparator /> : null}
                <SelectGroup>
                  <SelectLabel className="text-muted-foreground text-xs font-medium">
                    Closed
                  </SelectLabel>
                  {closedWorktrees.map((worktree) => (
                    <SelectItem
                      key={worktree.workspaceId}
                      value={worktree.workspaceId}
                      className="text-muted-foreground"
                    >
                      <span className="block truncate">
                        {worktreeLabel(worktree.label)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            ) : null}
          </SelectContent>
        </Select>

        {isClosed ? null : (
          <SessionTabs
            sessions={live}
            activeTerminalId={activeTerminalId}
            onSelect={(terminalId) =>
              workspaceId && select({ workspaceId, terminalId })
            }
            onClose={(terminalId) => void closeSession(terminalId)}
          />
        )}

        {workspaceId && !isClosed ? (
          <NewSessionPopover
            projectId={projectId}
            workspaceId={workspaceId}
            onStarted={(terminalId) => {
              select({ workspaceId, terminalId });
              refreshSessions();
            }}
          />
        ) : null}

        <Button
          variant="ghost"
          className="!h-6 !rounded-md px-1.5"
          aria-label="Open full screen"
          disabled={!activeWorktree || isClosed}
          onClick={() => {
            if (!activeWorktree || isClosed) return;
            setMode("closed");
            router.push(
              `/${channel.orgSlug}/${channel.channelSlug}/thread/${activeWorktree.threadId}/session`,
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
        {isClosed && activeWorktree ? (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <p className="text-muted-foreground text-xs">
              This folder was cleaned up after the thread went quiet.
            </p>
            <Link
              href={`/${channel.orgSlug}/${channel.channelSlug}?thread=${activeWorktree.threadId}`}
              className="text-primary text-xs hover:underline"
              onClick={() => setMode("closed")}
            >
              View thread →
            </Link>
          </div>
        ) : workspaceId && activeTerminalId ? (
          <TerminalView
            key={activeTerminalId}
            orgSlug={channel.orgSlug}
            projectId={projectId}
            workspaceId={workspaceId}
            terminalId={activeTerminalId}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground text-xs">
              {openWorktrees.length
                ? "No agents in this thread’s worktree — start one with +"
                : closedWorktrees.length
                  ? "No open folders — pick a closed one to find its thread."
                  : "No worktrees yet. One appears when an agent replies in a thread."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
