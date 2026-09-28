"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@roster/ui";
import { Minimize2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { ChannelMark } from "~/components/logo/channel-mark";
import { errorMessage, trpc } from "~/utils/trpc";

import {
  HIERARCHY_TRIGGER_CLASS,
  HierarchySeparator,
  SessionLevel,
} from "./dock-hierarchy";
import { TerminalView } from "./terminal-view";

export interface SessionScreenThread {
  threadId: string;
  label: string;
}

export interface SessionScreenProps {
  orgSlug: string;
  channelSlug: string;
  projectId: string;
  workspaceId: string;
  threadId: string;
  threads: SessionScreenThread[];
  backHref: string;
}

export function SessionScreen({
  orgSlug,
  channelSlug,
  projectId,
  workspaceId,
  threadId,
  threads,
  backHref,
}: SessionScreenProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);

  const { data: sessions } = useQuery({
    queryKey: ["terminals", "sessions", projectId, workspaceId],
    queryFn: () => trpc.terminals.sessions.query({ projectId, workspaceId }),
    refetchInterval: 10_000,
  });

  const live = useMemo(
    () => (sessions ?? []).filter((session) => !session.exited),
    [sessions],
  );

  const activeTerminalId = useMemo(() => {
    if (!live.length) return null;
    const chosen = live.find((session) => session.terminalId === picked);
    return (chosen ?? live[0])?.terminalId ?? null;
  }, [live, picked]);

  const refreshSessions = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["terminals", "sessions", projectId, workspaceId],
    });
  }, [queryClient, projectId, workspaceId]);

  const closeSession = async (terminalId: string) => {
    try {
      await trpc.terminals.close.mutate({ projectId, workspaceId, terminalId });
    } catch (cause) {
      console.warn(errorMessage(cause, "Could not close that session."));
    }
    refreshSessions();
  };

  return (
    <div className="bg-background-2 flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 p-1.5">
        <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 px-2 text-xs">
          <ChannelMark className="shrink-0" />
          <span>{channelSlug}</span>
        </span>

        <HierarchySeparator />

        <Select
          value={threadId}
          onValueChange={(next) =>
            router.push(`/${orgSlug}/${channelSlug}/thread/${next}/session`)
          }
        >
          <SelectTrigger showIcon className={HIERARCHY_TRIGGER_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-w-72">
            {threads.map((thread) => (
              <SelectItem key={thread.threadId} value={thread.threadId}>
                <span className="block truncate">{thread.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <HierarchySeparator />

        <SessionLevel
          live={live}
          activeTerminalId={activeTerminalId}
          onSelect={setPicked}
          onClose={(terminalId) => void closeSession(terminalId)}
          projectId={projectId}
          workspaceId={workspaceId}
          onStarted={(terminalId) => {
            setPicked(terminalId);
            refreshSessions();
          }}
        />

        <span className="flex-1" />

        <Button
          variant="ghost"
          className="!h-6 !rounded-md px-1.5"
          aria-label="Back to channel"
          asChild
        >
          <Link href={backHref}>
            <Minimize2 size={14} />
          </Link>
        </Button>
      </div>

      <div className="min-h-0 flex-1 bg-[#0a0a0a]">
        {activeTerminalId ? (
          <TerminalView
            key={activeTerminalId}
            orgSlug={orgSlug}
            projectId={projectId}
            workspaceId={workspaceId}
            terminalId={activeTerminalId}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground text-xs">
              No agents in this worktree — start one with +
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
