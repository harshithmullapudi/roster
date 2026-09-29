import { listAgents } from "./agents";
import {
  db,
  members,
  messages,
  type NotificationType,
  notifications,
  projects,
  threadSubscriptions,
  type ThreadSubscriptionReason,
  threads,
  users,
} from "@roster/db";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { agentDisplay } from "../lib/agent-identity";
import { mentionedHandles } from "../lib/message-mentions";
import {
  planNotifications,
  type PlannedNotification,
  previewOf,
  type ThreadSubscriber,
} from "../lib/notification-type";
import {
  type ChannelScope,
  listMentionableMembers,
  visibleToMember,
} from "./channels";
import { publish, userChannelName } from "./centrifugo";
import type { ChannelMessage } from "./message-columns";
import { threadLeadStatus } from "./sessions/queries";

const NOBODY = "00000000-0000-0000-0000-000000000000";

interface ThreadContext {
  id: string;
  organizationId: string;
  projectId: string;
  channelSlug: string;
}

async function threadContext(threadId: string): Promise<ThreadContext | null> {
  const [row] = await db
    .select({
      id: threads.id,
      organizationId: threads.organizationId,
      projectId: threads.projectId,
      channelSlug: projects.slug,
    })
    .from(threads)
    .innerJoin(projects, eq(threads.projectId, projects.id))
    .where(eq(threads.id, threadId))
    .limit(1);

  return row ?? null;
}

export async function ensureThreadSubscription(args: {
  threadId: string;
  memberId: string;
  reason: ThreadSubscriptionReason;
}): Promise<void> {
  await db
    .insert(threadSubscriptions)
    .values({
      threadId: args.threadId,
      memberId: args.memberId,
      reason: args.reason,
    })
    .onConflictDoNothing({
      target: [threadSubscriptions.threadId, threadSubscriptions.memberId],
    });
}

export async function subscribeThreadAuthor(args: {
  threadId: string;
  memberId: string | null | undefined;
}): Promise<void> {
  if (!args.memberId) return;
  await ensureThreadSubscription({
    threadId: args.threadId,
    memberId: args.memberId,
    reason: "author",
  });
}

async function threadSubscribers(
  threadId: string,
): Promise<ThreadSubscriber[]> {
  return db
    .select({
      memberId: threadSubscriptions.memberId,
      mutedAt: threadSubscriptions.mutedAt,
    })
    .from(threadSubscriptions)
    .where(eq(threadSubscriptions.threadId, threadId));
}

async function memberRole(memberId: string | null): Promise<string> {
  if (!memberId) return "member";
  const row = await db.query.members.findFirst({
    where: eq(members.id, memberId),
    columns: { role: true },
  });
  return row?.role ?? "member";
}

async function mentionedMemberIds(args: {
  organizationId: string;
  authorMemberId: string | null;
  body: unknown;
  text: string;
}): Promise<string[]> {
  const scope: ChannelScope = {
    organizationId: args.organizationId,
    memberId: args.authorMemberId ?? NOBODY,
    role: await memberRole(args.authorMemberId),
  };

  const [agents, people] = await Promise.all([
    listAgents(scope),
    listMentionableMembers(scope),
  ]);

  const mentioned = mentionedHandles({
    body: args.body,
    text: args.text,
    agents: agents.map((agent) => agent.handle),
    members: people.map((person) => person.handle),
  });
  if (mentioned.members.length === 0) return [];

  const byHandle = new Map(people.map((person) => [person.handle, person.id]));

  return mentioned.members.flatMap((handle) => {
    const id = byHandle.get(handle);
    return id ? [id] : [];
  });
}

function actorDisplayOf(message: ChannelMessage): string | null {
  if (message.authorMemberId) {
    const name = message.authorName?.trim();
    if (name && name.length > 0) return name;
    return message.authorEmail;
  }
  return message.agentDisplay;
}

interface Delivery {
  organizationId: string;
  projectId: string;
  channelSlug: string;
  threadId: string;
  messageId: string | null;
  dedupeKey: string | null;
  actorMemberId: string | null;
  actorChannelId: string | null;
  actorDisplay: string | null;
  preview: string;
}

async function deliver(
  delivery: Delivery,
  planned: PlannedNotification[],
): Promise<void> {
  if (planned.length === 0) return;

  const values = planned.map((entry) => ({
    organizationId: delivery.organizationId,
    memberId: entry.memberId,
    threadId: delivery.threadId,
    messageId: delivery.messageId,
    dedupeKey: delivery.dedupeKey,
    type: entry.type,
    actorMemberId: delivery.actorMemberId,
    actorChannelId: delivery.actorChannelId,
  }));

  const returning = {
    id: notifications.id,
    memberId: notifications.memberId,
    type: notifications.type,
    createdAt: notifications.createdAt,
  };

  const created =
    delivery.messageId === null
      ? await db
          .insert(notifications)
          .values(values)
          .onConflictDoNothing({
            target: [notifications.memberId, notifications.dedupeKey],
            where: sql`dedupe_key is not null`,
          })
          .returning(returning)
      : await db
          .insert(notifications)
          .values(values)
          .onConflictDoNothing({
            target: [notifications.memberId, notifications.messageId],
            where: sql`message_id is not null`,
          })
          .returning(returning);

  if (created.length === 0) return;

  const recipients = await db
    .select({ id: members.id, userId: members.userId })
    .from(members)
    .where(
      inArray(
        members.id,
        created.map((row) => row.memberId),
      ),
    );
  const userIds = new Map(recipients.map((row) => [row.id, row.userId]));

  await Promise.all(
    created.flatMap((row) => {
      const userId = userIds.get(row.memberId);
      if (!userId) return [];

      return [
        publish(userChannelName(userId), {
          type: "notification" as const,
          notification: {
            id: row.id,
            type: row.type,
            threadId: delivery.threadId,
            projectId: delivery.projectId,
            channelSlug: delivery.channelSlug,
            messageId: delivery.messageId,
            preview: delivery.preview,
            actorDisplay: delivery.actorDisplay,
            createdAt: row.createdAt.toISOString(),
          },
        }),
      ];
    }),
  );
}

export async function notifyForMessage(
  message: ChannelMessage,
  outcome?: NotificationType,
): Promise<void> {
  if (!message.threadId) return;

  const thread = await threadContext(message.threadId);
  if (!thread) return;

  const mentioned = await mentionedMemberIds({
    organizationId: thread.organizationId,
    authorMemberId: message.authorMemberId,
    body: message.body,
    text: message.text,
  });

  for (const memberId of mentioned) {
    await ensureThreadSubscription({
      threadId: thread.id,
      memberId,
      reason: "mentioned",
    });
  }

  const leadStatus =
    message.kind === "agent" ? await threadLeadStatus(thread.id) : null;

  const planned = planNotifications({
    event: {
      kind: message.kind,
      parentMessageId: message.parentMessageId,
      causedByMemberId: message.authorMemberId,
      mentionedMemberIds: mentioned,
      leadStatus,
      outcome,
    },
    subscribers: await threadSubscribers(thread.id),
  });

  await deliver(
    {
      organizationId: thread.organizationId,
      projectId: thread.projectId,
      channelSlug: thread.channelSlug,
      threadId: thread.id,
      messageId: message.id,
      dedupeKey: null,
      actorMemberId: message.authorMemberId,
      actorChannelId: message.authorMemberId ? null : message.agentChannelId,
      actorDisplay: actorDisplayOf(message),
      preview: previewOf(message.text),
    },
    planned,
  );
}

export async function notifyThreadFailed(args: {
  threadId: string;
  sessionId: string;
  reason: string | null;
}): Promise<void> {
  const thread = await threadContext(args.threadId);
  if (!thread) return;

  const subscribers = await threadSubscribers(thread.id);
  const planned = subscribers
    .filter((subscriber) => subscriber.mutedAt === null)
    .map((subscriber) => ({
      memberId: subscriber.memberId,
      type: "agent_failed" as const,
    }));

  await deliver(
    {
      organizationId: thread.organizationId,
      projectId: thread.projectId,
      channelSlug: thread.channelSlug,
      threadId: thread.id,
      messageId: null,
      dedupeKey: `failed:${args.sessionId}`,
      actorMemberId: null,
      actorChannelId: thread.projectId,
      actorDisplay: null,
      preview: previewOf(args.reason ?? "That session ended without an answer."),
    },
    planned,
  );
}

export async function notifyDelegationReceived(args: {
  childThreadId: string;
  originChannelId: string;
  delegationId: string;
  task: string;
}): Promise<void> {
  const thread = await threadContext(args.childThreadId);
  if (!thread) return;

  const [asker] = await db
    .select({ slug: projects.slug, agentName: members.agentName })
    .from(projects)
    .leftJoin(members, eq(members.id, projects.defaultAgentId))
    .where(eq(projects.id, args.originChannelId))
    .limit(1);

  const [owner] = await db
    .select({ memberId: projects.addedByMemberId })
    .from(projects)
    .where(eq(projects.id, thread.projectId))
    .limit(1);

  if (!owner) return;

  if (owner.memberId) {
    await ensureThreadSubscription({
      threadId: thread.id,
      memberId: owner.memberId,
      reason: "author",
    });
  }

  await deliver(
    {
      organizationId: thread.organizationId,
      projectId: thread.projectId,
      channelSlug: thread.channelSlug,
      threadId: thread.id,
      messageId: null,
      dedupeKey: `delegation:${args.delegationId}`,
      actorMemberId: null,
      actorChannelId: args.originChannelId,
      actorDisplay: asker ? agentDisplay(asker.agentName) : null,
      preview: previewOf(args.task),
    },
    [{ memberId: owner.memberId, type: "delegation_received" }],
  );
}

const actorMember = alias(members, "actor_member");
const actorUser = alias(users, "actor_user");
const actorChannel = alias(projects, "actor_channel");
const actorChannelOwner = alias(members, "actor_channel_owner");
const rootMessage = alias(messages, "root_message");
const subjectMessage = alias(messages, "subject_message");

export interface NotificationItem {
  id: string;
  type: NotificationType;
  threadId: string;
  projectId: string;
  channelSlug: string;
  channelName: string;
  messageId: string | null;
  rootText: string;
  preview: string;
  actorDisplay: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationPage {
  items: NotificationItem[];
  nextCursor: string | null;
}

function encodeCursor(item: NotificationItem): string {
  return `${item.createdAt.toISOString()}|${item.id}`;
}

function cursorCondition(cursor: string | undefined) {
  if (!cursor) return undefined;

  const divider = cursor.lastIndexOf("|");
  if (divider === -1) return undefined;

  const at = new Date(cursor.slice(0, divider));
  const id = cursor.slice(divider + 1);
  if (Number.isNaN(at.getTime()) || id.length === 0) return undefined;

  return sql`(${notifications.createdAt}, ${notifications.id}) < (${at}, ${id}::uuid)`;
}

const notificationColumns = {
  id: notifications.id,
  type: notifications.type,
  threadId: notifications.threadId,
  projectId: threads.projectId,
  channelSlug: projects.slug,
  channelName: projects.name,
  messageId: notifications.messageId,
  rootText: rootMessage.text,
  subjectText: subjectMessage.text,
  actorName: actorUser.name,
  actorEmail: actorUser.email,
  actorChannelSlug: actorChannel.slug,
  actorChannelAgentName: actorChannelOwner.agentName,
  readAt: notifications.readAt,
  createdAt: notifications.createdAt,
};

function visibleNotifications() {
  return db
    .select(notificationColumns)
    .from(notifications)
    .innerJoin(threads, eq(notifications.threadId, threads.id))
    .innerJoin(projects, eq(threads.projectId, projects.id))
    .leftJoin(rootMessage, eq(threads.rootMessageId, rootMessage.id))
    .leftJoin(subjectMessage, eq(notifications.messageId, subjectMessage.id))
    .leftJoin(actorMember, eq(notifications.actorMemberId, actorMember.id))
    .leftJoin(actorUser, eq(actorMember.userId, actorUser.id))
    .leftJoin(actorChannel, eq(notifications.actorChannelId, actorChannel.id))
    .leftJoin(
      actorChannelOwner,
      eq(actorChannel.addedByMemberId, actorChannelOwner.id),
    );
}

function ownedBy(scope: ChannelScope) {
  return and(
    eq(notifications.memberId, scope.memberId),
    eq(notifications.organizationId, scope.organizationId),
    visibleToMember(scope.memberId, scope.role),
  );
}

function toItem(row: {
  id: string;
  type: NotificationType;
  threadId: string;
  projectId: string;
  channelSlug: string;
  channelName: string;
  messageId: string | null;
  rootText: string | null;
  subjectText: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorChannelSlug: string | null;
  actorChannelAgentName: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationItem {
  const name = row.actorName?.trim();
  const actorDisplay =
    name && name.length > 0
      ? name
      : (row.actorEmail ??
        (row.actorChannelAgentName
          ? agentDisplay(row.actorChannelAgentName)
          : null));

  return {
    id: row.id,
    type: row.type,
    threadId: row.threadId,
    projectId: row.projectId,
    channelSlug: row.channelSlug,
    channelName: row.channelName,
    messageId: row.messageId,
    rootText: row.rootText ?? "",
    preview: previewOf(row.subjectText ?? row.rootText ?? ""),
    actorDisplay,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

export async function unreadNotificationCount(
  scope: ChannelScope,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(notifications)
    .innerJoin(threads, eq(notifications.threadId, threads.id))
    .innerJoin(projects, eq(threads.projectId, projects.id))
    .where(and(ownedBy(scope), isNull(notifications.readAt)));

  return Number(row?.total ?? 0);
}

export async function markAllNotificationsRead(
  scope: ChannelScope,
): Promise<number> {
  const readAt = new Date();

  const rows = await db
    .update(notifications)
    .set({ readAt })
    .where(
      and(
        eq(notifications.memberId, scope.memberId),
        eq(notifications.organizationId, scope.organizationId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });

  await db
    .update(threadSubscriptions)
    .set({ lastReadAt: readAt })
    .where(eq(threadSubscriptions.memberId, scope.memberId));

  return rows.length;
}

export interface ThreadSubscriptionState {
  threadId: string;
  subscribed: boolean;
  reason: ThreadSubscriptionReason | null;
  muted: boolean;
  lastReadAt: Date | null;
}

const NOT_SUBSCRIBED = (threadId: string): ThreadSubscriptionState => ({
  threadId,
  subscribed: false,
  reason: null,
  muted: false,
  lastReadAt: null,
});

export async function visibleThread(
  args: ChannelScope & { threadId: string },
): Promise<ThreadContext | null> {
  const [row] = await db
    .select({
      id: threads.id,
      organizationId: threads.organizationId,
      projectId: threads.projectId,
      channelSlug: projects.slug,
    })
    .from(threads)
    .innerJoin(projects, eq(threads.projectId, projects.id))
    .where(
      and(
        eq(threads.id, args.threadId),
        eq(threads.organizationId, args.organizationId),
        visibleToMember(args.memberId, args.role),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function markThreadRead(
  args: ChannelScope & { threadId: string },
): Promise<ThreadSubscriptionState> {
  const now = new Date();

  await db
    .update(threadSubscriptions)
    .set({ lastReadAt: now })
    .where(
      and(
        eq(threadSubscriptions.threadId, args.threadId),
        eq(threadSubscriptions.memberId, args.memberId),
      ),
    );

  await db
    .update(notifications)
    .set({ readAt: now })
    .where(
      and(
        eq(notifications.threadId, args.threadId),
        eq(notifications.memberId, args.memberId),
        isNull(notifications.readAt),
      ),
    );

  return subscriptionState(args);
}

async function subscriptionState(
  args: ChannelScope & { threadId: string },
): Promise<ThreadSubscriptionState> {
  const row = await db.query.threadSubscriptions.findFirst({
    where: and(
      eq(threadSubscriptions.threadId, args.threadId),
      eq(threadSubscriptions.memberId, args.memberId),
    ),
  });

  if (!row) return NOT_SUBSCRIBED(args.threadId);

  return {
    threadId: args.threadId,
    subscribed: true,
    reason: row.reason,
    muted: row.mutedAt !== null,
    lastReadAt: row.lastReadAt,
  };
}

export async function setThreadSubscription(
  args: ChannelScope & { threadId: string; muted?: boolean },
): Promise<ThreadSubscriptionState> {
  await ensureThreadSubscription({
    threadId: args.threadId,
    memberId: args.memberId,
    reason: "manual",
  });

  if (args.muted !== undefined) {
    await db
      .update(threadSubscriptions)
      .set({ mutedAt: args.muted ? new Date() : null })
      .where(
        and(
          eq(threadSubscriptions.threadId, args.threadId),
          eq(threadSubscriptions.memberId, args.memberId),
        ),
      );
  }

  return subscriptionState(args);
}

export async function unfollowThread(
  args: ChannelScope & { threadId: string },
): Promise<ThreadSubscriptionState> {
  await db
    .delete(threadSubscriptions)
    .where(
      and(
        eq(threadSubscriptions.threadId, args.threadId),
        eq(threadSubscriptions.memberId, args.memberId),
      ),
    );

  return NOT_SUBSCRIBED(args.threadId);
}
