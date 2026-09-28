import { channelReads, db, projects } from "@roster/db";
import { and, eq, sql } from "drizzle-orm";

import { type ChannelScope, visibleToMember } from "./channels";

export async function markChannelSeen(args: {
  memberId: string;
  projectId: string;
}): Promise<void> {
  await db
    .insert(channelReads)
    .values({ memberId: args.memberId, projectId: args.projectId })
    .onConflictDoUpdate({
      target: [channelReads.memberId, channelReads.projectId],
      set: { lastSeenAt: new Date() },
    });
}

/*
 * A channel is unseen when someone else — a person or an agent — has posted
 * in it since this member last opened it. The member's own messages never
 * count, and neither do messages in threads the member has muted.
 */
export async function listUnseenChannels(
  scope: ChannelScope,
): Promise<string[]> {
  const hasUnseenMessage = sql`exists (
    select 1 from roster.messages m
    where m.project_id = ${projects.id}
      and m.deleted_at is null
      and (m.author_member_id is null or m.author_member_id <> ${scope.memberId}::uuid)
      and m.created_at > coalesce(${channelReads.lastSeenAt}, to_timestamp(0))
      and not exists (
        select 1 from roster.thread_subscriptions ts
        where ts.thread_id = m.thread_id
          and ts.member_id = ${scope.memberId}::uuid
          and ts.muted_at is not null
      )
  )`;

  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .leftJoin(
      channelReads,
      and(
        eq(channelReads.projectId, projects.id),
        eq(channelReads.memberId, scope.memberId),
      ),
    )
    .where(
      and(
        eq(projects.organizationId, scope.organizationId),
        visibleToMember(scope.memberId, scope.role),
        hasUnseenMessage,
      ),
    );

  return rows.map((row) => row.id);
}
