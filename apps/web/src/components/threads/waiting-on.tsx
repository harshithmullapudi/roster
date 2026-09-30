"use client";

import type { WaitingOn } from "@roster/api";
import Link from "next/link";
import { useParams } from "next/navigation";

import { ThreadStatus } from "./thread-status";

export interface WaitingOnCardProps {
  waiting: WaitingOn;
}

export function WaitingOnCards({ waiting }: { waiting: WaitingOn[] }) {
  if (waiting.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {waiting.map((one) => (
        <WaitingOnCard key={`${one.handle}:${one.task}`} waiting={one} />
      ))}
    </div>
  );
}

export function WaitingOnCard({ waiting }: WaitingOnCardProps) {
  const params = useParams<{ slug: string }>();
  const href =
    params?.slug && waiting.threadId
      ? `/${params.slug}/${waiting.channelSlug}/thread/${waiting.threadId}`
      : null;

  const body = (
    <>
      <span className="flex items-center gap-2">
        <span className="text-xs font-medium">@{waiting.handle}</span>
        <ThreadStatus status={waiting.status} />
      </span>
      <span className="text-muted-foreground line-clamp-2 text-xs">
        {waiting.lastProgress ?? waiting.task}
      </span>
    </>
  );

  if (!href) {
    return (
      <span className="border-border flex flex-col gap-0.5 rounded-md border border-dashed px-2 py-1.5">
        {body}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className="border-border hover:bg-accent/50 flex flex-col gap-0.5 rounded-md border border-dashed px-2 py-1.5"
    >
      {body}
    </Link>
  );
}
