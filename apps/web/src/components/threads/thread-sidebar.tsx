import type { ThreadDetail } from "@roster/api";
import { Button } from "@roster/ui";
import { ChevronLeft, X } from "lucide-react";
import Link from "next/link";

import { OpenSessionButton } from "~/components/terminals/open-session-button";

import { CloseOnEscape } from "./close-on-escape";
import { ThreadMenu } from "./thread-menu";
import { ThreadPanel } from "./thread-panel";
import { ThreadReferences } from "./thread-references";

export interface ThreadSidebarProps {
  projectId: string;
  threadId: string;
  memberId: string;
  authorName: string;
  authorEmail: string;
  detail: ThreadDetail;
  closeHref: string;
}

export function ThreadSidebar({
  projectId,
  threadId,
  memberId,
  authorName,
  authorEmail,
  detail,
  closeHref,
}: ThreadSidebarProps) {
  return (
    <aside className="border-border flex h-full w-full min-w-0 flex-1 flex-col sm:border-l">
      <CloseOnEscape href={closeHref} />
      <header className="pt-safe relative flex shrink-0 flex-col border-b border-gray-300">
        <div className="h-(--header-height) flex items-center gap-1.5 px-2 sm:px-3">
          <Button
            variant="ghost"
            className="-ml-1 !rounded-md px-1.5 sm:hidden"
            aria-label="Back to channel"
            asChild
          >
            <Link href={closeHref}>
              <ChevronLeft size={18} />
            </Link>
          </Button>
          <h2 className="min-w-0 flex-1 truncate text-base">Thread</h2>
          <OpenSessionButton projectId={projectId} threadId={threadId} />
          <ThreadReferences projectId={projectId} threadId={threadId} />
          <ThreadMenu
            projectId={projectId}
            threadId={threadId}
            status={detail.thread.status}
            completedAt={detail.thread.completedAt}
          />
          <Button
            variant="ghost"
            className="!rounded-md px-1.5 max-sm:hidden"
            aria-label="Close thread"
            asChild
          >
            <Link href={closeHref}>
              <X size={16} />
            </Link>
          </Button>
        </div>
      </header>
      <ThreadPanel
        projectId={projectId}
        threadId={threadId}
        memberId={memberId}
        authorName={authorName}
        authorEmail={authorEmail}
        initialDetail={detail}
      />
    </aside>
  );
}
