"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@roster/ui";
import { ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";

import { ChannelMark } from "~/components/logo/channel-mark";
import { errorMessage, trpc } from "~/utils/trpc";

import { useDock, type DockFolder } from "./dock-provider";
import { NewSessionPopover } from "./new-session-popover";

/*
 * A channel can accumulate closed folders forever, so the picker keeps only
 * the freshest few — enough to find the thread you were just in, not an
 * archive.
 */
const CLOSED_LIMIT = 10;

export function worktreeLabel(label: string): string {
  const firstLine = label.split("\n")[0]?.trim() ?? "";
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine || "Untitled";
}

export function sessionLabel(session: {
  terminalId: string;
  title: string | null;
  customTitle: string | null;
}): string {
  return session.customTitle ?? session.title ?? session.terminalId.slice(0, 8);
}

export const HIERARCHY_TRIGGER_CLASS =
  "!h-6 !min-h-6 w-auto max-w-44 shrink-0 gap-1 px-2 text-xs";

export interface DockHierarchyState {
  folder: DockFolder | null;
  folders: DockFolder[];
  starredProjectIds: Set<string>;
  pickFolder: (projectId: string) => void;

  openWorktrees: Worktree[];
  closedWorktrees: Worktree[];
  activeWorktree: Worktree | null;
  isClosed: boolean;
  workspaceId: string | null;
  selectWorkspace: (workspaceId: string) => void;

  live: LiveSession[];
  activeTerminalId: string | null;
  selectSession: (terminalId: string) => void;
  closeSession: (terminalId: string) => void;
  onSessionStarted: (terminalId: string) => void;
}

type Worktree = Awaited<
  ReturnType<typeof trpc.terminals.worktrees.query>
>[number];

type LiveSession = Awaited<
  ReturnType<typeof trpc.terminals.sessions.query>
>[number];

export function useDockHierarchy(): DockHierarchyState {
  const { folder, pickFolder, selection, select } = useDock();
  const queryClient = useQueryClient();
  const projectId = folder?.projectId ?? null;

  const { data: channelGroups } = useQuery({
    queryKey: ["channels", "list"],
    queryFn: () => trpc.channels.list.query(),
    refetchInterval: 60_000,
  });

  const { folders, starredProjectIds } = useMemo(() => {
    const groups = channelGroups ?? { starred: [], public: [], private: [] };
    const all = [...groups.starred, ...groups.public, ...groups.private];
    return {
      folders: all.map((channel) => ({
        channelSlug: channel.slug,
        projectId: channel.id,
      })),
      starredProjectIds: new Set(groups.starred.map((channel) => channel.id)),
    };
  }, [channelGroups]);

  const { data: worktrees } = useQuery({
    queryKey: ["terminals", "worktrees", projectId, "all"],
    queryFn: () =>
      trpc.terminals.worktrees.query({
        projectId: projectId as string,
        includeClosed: true,
      }),
    enabled: Boolean(projectId),
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
    enabled: Boolean(projectId && workspaceId) && !isClosed,
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

  const pickFolderById = useCallback(
    (nextProjectId: string) => {
      const next = folders.find((entry) => entry.projectId === nextProjectId);
      if (next) pickFolder(next);
    },
    [folders, pickFolder],
  );

  const selectWorkspace = useCallback(
    (nextWorkspaceId: string) =>
      select({ workspaceId: nextWorkspaceId, terminalId: null }),
    [select],
  );

  const selectSession = useCallback(
    (terminalId: string) => {
      if (workspaceId) select({ workspaceId, terminalId });
    },
    [select, workspaceId],
  );

  const closeSession = useCallback(
    (terminalId: string) => {
      if (!projectId || !workspaceId) return;
      void trpc.terminals.close
        .mutate({ projectId, workspaceId, terminalId })
        .catch((cause) => {
          console.warn(errorMessage(cause, "Could not close that session."));
        })
        .finally(refreshSessions);
    },
    [projectId, workspaceId, refreshSessions],
  );

  const onSessionStarted = useCallback(
    (terminalId: string) => {
      if (workspaceId) select({ workspaceId, terminalId });
      refreshSessions();
    },
    [select, workspaceId, refreshSessions],
  );

  return {
    folder,
    folders,
    starredProjectIds,
    pickFolder: pickFolderById,
    openWorktrees,
    closedWorktrees,
    activeWorktree,
    isClosed,
    workspaceId,
    selectWorkspace,
    live,
    activeTerminalId,
    selectSession,
    closeSession,
    onSessionStarted,
  };
}

export function HierarchySeparator() {
  return <ChevronRight size={12} className="text-muted-foreground/60 shrink-0" />;
}

export function SessionLevel({
  live,
  activeTerminalId,
  onSelect,
  onClose,
  projectId,
  workspaceId,
  onStarted,
}: {
  live: LiveSession[];
  activeTerminalId: string | null;
  onSelect: (terminalId: string) => void;
  onClose: (terminalId: string) => void;
  projectId: string;
  workspaceId: string;
  onStarted: (terminalId: string) => void;
}) {
  return (
    <>
      <Select
        value={activeTerminalId ?? undefined}
        onValueChange={onSelect}
        disabled={!live.length}
      >
        <SelectTrigger showIcon className={HIERARCHY_TRIGGER_CLASS}>
          <SelectValue placeholder="No sessions" />
        </SelectTrigger>
        <SelectContent className="max-w-72">
          {live.map((session) => (
            <SelectItem key={session.terminalId} value={session.terminalId}>
              <span className="block truncate">{sessionLabel(session)}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {activeTerminalId ? (
        <Button
          variant="ghost"
          className="!h-6 !rounded-md px-1"
          aria-label="Close session"
          onClick={() => onClose(activeTerminalId)}
        >
          <X size={12} />
        </Button>
      ) : null}

      <NewSessionPopover
        projectId={projectId}
        workspaceId={workspaceId}
        onStarted={onStarted}
      />
    </>
  );
}

/*
 * The folder → workspace → session breadcrumb that heads the open dock.
 */
export function DockHierarchy({
  state,
  onEngage,
}: {
  state: DockHierarchyState;
  onEngage?: () => void;
}) {
  const {
    folder,
    folders,
    starredProjectIds,
    pickFolder,
    openWorktrees,
    closedWorktrees,
    isClosed,
    workspaceId,
    selectWorkspace,
    live,
    activeTerminalId,
    selectSession,
    closeSession,
    onSessionStarted,
  } = state;

  const starred = folders.filter((entry) =>
    starredProjectIds.has(entry.projectId),
  );
  const rest = folders.filter(
    (entry) => !starredProjectIds.has(entry.projectId),
  );

  const folderItem = (entry: DockFolder) => (
    <SelectItem
      key={entry.projectId}
      value={entry.projectId}
      className="[&>span:first-child]:hidden"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <ChannelMark className="text-muted-foreground shrink-0" />
        <span className="truncate">{entry.channelSlug}</span>
      </span>
    </SelectItem>
  );

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Select
        value={folder?.projectId}
        onValueChange={(next) => {
          pickFolder(next);
          onEngage?.();
        }}
      >
        <SelectTrigger showIcon className={HIERARCHY_TRIGGER_CLASS}>
          <SelectValue placeholder="Folder" />
        </SelectTrigger>
        <SelectContent className="max-w-72">
          {starred.length > 0 ? (
            <>
              <SelectGroup>
                <SelectLabel className="text-muted-foreground text-xs font-medium">
                  Starred
                </SelectLabel>
                {starred.map(folderItem)}
              </SelectGroup>
              {rest.length > 0 ? <SelectSeparator /> : null}
            </>
          ) : null}
          {rest.map(folderItem)}
        </SelectContent>
      </Select>

      {folder ? (
        <>
          <HierarchySeparator />
          <Select
            value={workspaceId ?? undefined}
            onValueChange={(next) => {
              selectWorkspace(next);
              onEngage?.();
            }}
          >
            <SelectTrigger showIcon className={HIERARCHY_TRIGGER_CLASS}>
              <SelectValue placeholder="No workspaces yet" />
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
        </>
      ) : null}

      {folder && workspaceId && !isClosed ? (
        <>
          <HierarchySeparator />
          <SessionLevel
            live={live}
            activeTerminalId={activeTerminalId}
            onSelect={(terminalId) => {
              selectSession(terminalId);
              onEngage?.();
            }}
            onClose={closeSession}
            projectId={folder.projectId}
            workspaceId={workspaceId}
            onStarted={(terminalId) => {
              onSessionStarted(terminalId);
              onEngage?.();
            }}
          />
        </>
      ) : null}
    </div>
  );
}
