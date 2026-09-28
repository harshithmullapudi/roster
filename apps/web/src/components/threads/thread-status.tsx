"use client";

import { cn } from "@roster/ui";

import {
  isLive,
  isWaiting,
  needsInput,
  statusLabel,
  statusTone,
} from "~/utils/thread-rows";

export interface StatusPipProps {
  tone: string;
  label: string;
  pulse?: boolean;
  strong?: boolean;
}

export function StatusPip({ tone, label, pulse, strong }: StatusPipProps) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span
        className={cn("size-1.5 rounded-full", tone, pulse && "animate-pulse")}
      />
      <span
        className={cn(
          "text-xs",
          strong ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </span>
  );
}

export interface ThreadStatusProps {
  status: string;
  strong?: boolean;
}

export function ThreadStatus({ status, strong }: ThreadStatusProps) {
  // Needs input is the one status that asks something of the reader, so it
  // gets a chip loud enough to scan for instead of the quiet pip.
  if (needsInput(status)) {
    return (
      <span className="bg-warning/15 flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1">
        <span className="bg-warning size-1.5 rounded-full" />
        <span className="text-foreground text-sm font-medium">
          Needs input
        </span>
      </span>
    );
  }

  return (
    <StatusPip
      tone={statusTone(status) ?? "bg-muted-foreground"}
      label={statusLabel(status)}
      strong={strong}
      // A pulse means work is happening. Needs input is deliberately
      // still — it is the colour that should catch the eye, not motion.
      pulse={isLive(status) || isWaiting(status)}
    />
  );
}

export function TurnCompleted() {
  return <StatusPip tone="bg-success" label="Turn completed" />;
}
