"use client";

import type { ThreadDetail } from "@roster/api";
import { cn } from "@roster/ui";

import { useNow } from "~/hooks/use-now";
import { elapsedLabel } from "~/utils/relative-time";
import { canRetry, isActive, needsInput } from "~/utils/thread-rows";

import { ThreadCancel } from "./thread-cancel";
import { ThreadRetry } from "./thread-retry";
import { ThreadStatus } from "./thread-status";
import { WaitingOnCards } from "./waiting-on";

export interface ThreadLiveBarProps {
  projectId: string;
  threadId: string;
  thread: ThreadDetail["thread"];
}

const SHELL =
  "border-border flex shrink-0 flex-col gap-1 border-t px-3 py-2 sm:px-5";

export function ThreadLiveBar({
  projectId,
  threadId,
  thread,
}: ThreadLiveBarProps) {
  const live = isActive(thread.status);
  const asking = needsInput(thread.status);
  const retryable = canRetry(thread.status, thread.error);
  const now = useNow(live);

  if (!live) {
    if (!thread.error && !retryable) return null;

    return (
      <div className={SHELL}>
        {thread.error ? (
          <span className="text-destructive text-sm">{thread.error}</span>
        ) : null}
        {retryable ? (
          <ThreadRetry projectId={projectId} threadId={threadId} />
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn(SHELL, asking && "bg-warning/10")}>
      <span className="flex items-center gap-2">
        <ThreadStatus status={thread.status} strong />
        <span
          className="text-muted-foreground text-xs"
          suppressHydrationWarning
        >
          {elapsedLabel(new Date(thread.startedAt), now)}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <ThreadCancel projectId={projectId} threadId={threadId} />
          {retryable ? (
            <ThreadRetry projectId={projectId} threadId={threadId} />
          ) : null}
        </span>
      </span>
      {thread.error ? (
        <span className="text-destructive text-sm">{thread.error}</span>
      ) : thread.waitingOn.length > 0 ? (
        <WaitingOnCards waiting={thread.waitingOn} />
      ) : asking ? (
        <span className="text-sm">
          <span className="font-medium">The agent is waiting on you.</span>{" "}
          <span className="text-muted-foreground">
            Reply below — your answer goes straight into its session.
          </span>
        </span>
      ) : thread.lastProgress ? (
        <span className="text-muted-foreground text-sm">
          {thread.lastProgress}
        </span>
      ) : null}
    </div>
  );
}
