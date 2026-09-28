"use client";

import { AvatarText, cn } from "@roster/ui";
import { memo } from "react";

import { ThreadAffordance } from "~/components/threads/thread-affordance";
import type { MessageItem } from "~/types";
import { speakerName } from "~/utils/message-groups";
import { relativeTime } from "~/utils/relative-time";
import type { ThreadItem } from "~/utils/thread-rows";

import { MessageActions } from "./message-actions";
import { MessageAttachments } from "./message-attachments";
import { MessageBody } from "./message-body";
import { MessageReactions } from "./message-reactions";

export interface MessageRowProps {
  message: MessageItem;
  leading: boolean;
  thread?: ThreadItem;
  threadHref?: string;
  threadOpen?: boolean;
  memberId?: string;
  onDelete?: (messageId: string) => Promise<void>;
}

export const MessageRow = memo(function MessageRow({
  message,
  leading,
  thread,
  threadHref,
  threadOpen = false,
  memberId,
  onDelete,
}: MessageRowProps) {
  const name = speakerName(message);

  const live = !message.pending && !message.failed;

  const deletable =
    onDelete !== undefined &&
    memberId !== undefined &&
    message.kind === "user" &&
    message.authorMemberId === memberId &&
    live;

  const completable = thread !== undefined && memberId !== undefined && live;

  return (
    <div
      className={cn(
        "group/message relative flex w-full gap-2.5 px-3 sm:gap-3 sm:px-5",
        threadOpen
          ? "bg-primary/5 hover:bg-primary/10"
          : "hover:bg-grayAlpha-50",
        leading ? "pt-3 pb-0.5" : "py-0.5",
        message.pending && "opacity-60",
      )}
    >
      {deletable || completable ? (
        <MessageActions
          hasSession={Boolean(thread)}
          thread={completable ? thread : undefined}
          onDelete={
            deletable && onDelete ? () => onDelete(message.id) : undefined
          }
        />
      ) : null}

      <div className="flex w-7 shrink-0 justify-center pt-0.5">
        {leading ? (
          <AvatarText text={name} className="h-7 w-7 rounded-md text-xs" />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col pr-8">
        {leading ? (
          <div className="flex items-baseline gap-2">
            <span className="text-foreground text-base font-medium">
              {name}
            </span>
            <span
              className="text-muted-foreground text-xs"
              suppressHydrationWarning
            >
              {message.pending ? "sending…" : relativeTime(message.createdAt)}
            </span>
          </div>
        ) : null}
        <div className="min-w-0">
          <MessageBody body={message.body} text={message.text} />
          <MessageAttachments attachments={message.attachments} />
        </div>
        {memberId && !message.pending && !message.failed ? (
          <MessageReactions
            messageId={message.id}
            projectId={message.projectId}
            reactions={message.reactions}
            memberId={memberId}
          />
        ) : null}
        {thread && threadHref ? (
          <ThreadAffordance thread={thread} href={threadHref} />
        ) : null}
        {message.failed ? (
          <span className="text-destructive text-xs">Failed to send.</span>
        ) : null}
      </div>
    </div>
  );
});
