"use client";

import { useEffect } from "react";

import { useCommands } from "~/components/providers/command-provider";
import { threadTitle } from "~/utils/live-threads";

export interface RecordThreadVisitProps {
  threadId: string;
  channelSlug: string;
  rootText: string;
}

export function RecordThreadVisit({
  threadId,
  channelSlug,
  rootText,
}: RecordThreadVisitProps) {
  const { enterThread, leaveThread } = useCommands();
  const title = threadTitle(rootText);

  useEffect(() => {
    enterThread({ threadId, channelSlug, title });
    return () => leaveThread(threadId);
  }, [enterThread, leaveThread, threadId, channelSlug, title]);

  return null;
}
