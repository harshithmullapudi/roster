import { listInboxThreads, threadDetail } from "@roster/api";

import { AppShell } from "~/components/app-shell/app-shell";
import { ThreadInbox } from "~/components/threads/thread-inbox";
import { ThreadSidebar } from "~/components/threads/thread-sidebar";
import { loadShell } from "~/lib/shell";

export default async function ThreadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ filter?: string; thread?: string }>;
}) {
  const { slug } = await params;
  const { filter, thread: openThreadId } = await searchParams;
  const { session, organization, member, shell } = await loadShell(slug);

  const threads = await listInboxThreads({
    organizationId: organization.id,
    memberId: member.id,
    role: member.role,
  });

  const openThread = openThreadId
    ? threads.find((thread) => thread.id === openThreadId)
    : undefined;
  const detail = openThread
    ? await threadDetail({
        projectId: openThread.projectId,
        threadId: openThread.id,
      })
    : null;

  const closeHref = filter
    ? `/${slug}/threads?filter=${encodeURIComponent(filter)}`
    : `/${slug}/threads`;

  return (
    <AppShell
      shell={shell}
      section="threads"
      title="Threads"
      flush
      railLayout={{
        storageId: "roster.threads-rail",
        sizes: { main: "50", rail: "50" },
      }}
      rail={
        openThread && detail ? (
          <ThreadSidebar
            projectId={openThread.projectId}
            threadId={openThread.id}
            channelSlug={openThread.channelSlug}
            memberId={member.id}
            authorName={session.user.name}
            authorEmail={session.user.email}
            detail={detail}
            closeHref={closeHref}
          />
        ) : null
      }
    >
      <ThreadInbox threads={threads} />
    </AppShell>
  );
}
