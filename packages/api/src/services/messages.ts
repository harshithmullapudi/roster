import { listAgents } from "./agents";
import {
  db,
  delegations,
  members,
  messages,
  projects,
  threads,
  users,
} from "@roster/db";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { type DeleteRefusal, deleteRefusal } from "../lib/message-delete";
import { DELEGATION_KIND } from "../lib/message-kind";
import { mentionedHandles } from "../lib/message-mentions";
import { sessionErrorDetail } from "../utils/session-error";
import { contiguousRun, type RunMessage } from "../utils/message-run";
import {

  type ChannelMessage,
  messageColumns,
  toChannelMessage,
  withAttachment,
  withAttachments,
} from "./message-columns";
import { bindAttachments, textWithAttachments } from "./attachments";
import {
  allocateSeq,
  listMentionableMembers,
} from "./channels";
import { channelName, publish, threadChannelName } from "./centrifugo";
import { emitMessage, messageById } from "./message-events";
import {
  cancelThread,
  createThread,
  ensureStarted,
  joinableThread,
  reapThread,
  startSession,
  steer,
  threadTarget,
} from "./sessions";
import { linkTaskThread } from "./tasks";

const JOIN_WINDOW_MS = 10_000;
const RUN_LOOKBACK = 20;

export type { ChannelMessage } from "./message-columns";

export async function listMessages(args: {
  projectId: string;
  before?: number;
  limit?: number;
}): Promise<ChannelMessage[]> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);

  const conditions = [
    eq(messages.projectId, args.projectId),
    isNull(messages.deletedAt),
    isNull(messages.parentMessageId),
    ne(messages.kind, DELEGATION_KIND),
  ];
  if (args.before !== undefined) conditions.push(lt(messages.seq, args.before));

  const rows = await db
    .select(messageColumns)
    .from(messages)
    .leftJoin(members, eq(messages.authorMemberId, members.id))
    .leftJoin(users, eq(members.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(messages.seq))
    .limit(limit);

  return withAttachments(rows.reverse().map(toChannelMessage));
}

export async function replyCountsByThread(
  threadIds: string[],
): Promise<Map<string, number>> {
  if (threadIds.length === 0) return new Map();

  const rows = await db
    .select({
      threadId: messages.threadId,
      replies: sql<number>`count(*)::int`,
    })
    .from(messages)
    .where(
      and(
        inArray(messages.threadId, threadIds),
        isNotNull(messages.parentMessageId),
        isNull(messages.deletedAt),
      ),
    )
    .groupBy(messages.threadId);

  return new Map(
    rows.flatMap((row) =>
      row.threadId ? [[row.threadId, Number(row.replies)] as const] : [],
    ),
  );
}

async function findByClientId(args: {
  projectId: string;
  clientId: string;
}): Promise<ChannelMessage | null> {
  const [row] = await db
    .select(messageColumns)
    .from(messages)
    .leftJoin(members, eq(messages.authorMemberId, members.id))
    .leftJoin(users, eq(members.userId, users.id))
    .where(
      and(
        eq(messages.projectId, args.projectId),
        eq(messages.clientId, args.clientId),
      ),
    )
    .orderBy(asc(messages.seq))
    .limit(1);

  return row ? withAttachment(toChannelMessage(row)) : null;
}

export { messageById, publishMessage } from "./message-events";

export interface MessageDeletion {
  messageId: string;
  projectId: string;
  threadId: string | null;
}

export type DeleteResult =
  | { refusal: DeleteRefusal }
  | { deleted: MessageDeletion };

async function publishDeletion(deletion: MessageDeletion): Promise<void> {
  const payload = {
    type: "message-deleted" as const,
    messageId: deletion.messageId,
    threadId: deletion.threadId,
    projectId: deletion.projectId,
  };

  const targets = [publish(channelName(deletion.projectId), payload)];
  if (deletion.threadId) {
    targets.push(publish(threadChannelName(deletion.threadId), payload));
  }

  await Promise.all(targets);
}

async function openDelegationChildren(parentThreadId: string): Promise<string[]> {
  const rows = await db
    .select({ childThreadId: delegations.childThreadId })
    .from(delegations)
    .where(
      and(
        eq(delegations.parentThreadId, parentThreadId),
        eq(delegations.status, "open"),
      ),
    );

  return rows
    .map((row) => row.childThreadId)
    .filter((id): id is string => id !== null);
}

export async function deleteMessage(args: {
  projectId: string;
  messageId: string;
  memberId: string;
}): Promise<DeleteResult> {
  const row = await db.query.messages.findFirst({
    where: and(
      eq(messages.id, args.messageId),
      eq(messages.projectId, args.projectId),
    ),
    columns: { kind: true, authorMemberId: true, deletedAt: true },
  });

  const refusal = deleteRefusal(row ?? null, args.memberId);
  if (refusal) return { refusal };

  const thread = await db.query.threads.findFirst({
    where: eq(threads.rootMessageId, args.messageId),
    columns: { id: true },
  });

  if (thread) {
    const children = await openDelegationChildren(thread.id);
    for (const threadId of [thread.id, ...children]) {
      await stopAndReap(threadId);
    }
  }

  await db
    .update(messages)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(messages.projectId, args.projectId),
        isNull(messages.deletedAt),
        thread
          ? or(
              eq(messages.id, args.messageId),
              eq(messages.threadId, thread.id),
            )
          : eq(messages.id, args.messageId),
      ),
    );

  if (thread) {
    await db.delete(threads).where(eq(threads.id, thread.id));
  }

  const deletion: MessageDeletion = {
    messageId: args.messageId,
    projectId: args.projectId,
    threadId: thread?.id ?? null,
  };
  await publishDeletion(deletion);

  return { deleted: deletion };
}

async function stopAndReap(threadId: string): Promise<void> {
  try {
    await cancelThread({ threadId });
  } catch (cause) {
    console.warn(
      `[messages] cancel before delete failed for ${threadId}: ${sessionErrorDetail(cause)}`,
    );
  }

  try {
    await reapThread({ threadId });
  } catch (cause) {
    console.warn(
      `[messages] reap before delete failed for ${threadId}: ${sessionErrorDetail(cause)}`,
    );
  }
}

export async function sendMessage(args: {
  organizationId: string;
  projectId: string;
  authorMemberId: string;
  role: string;
  body: unknown;
  text: string;
  clientId: string;
  threadId?: string;
  attachmentIds?: string[];
  standalone?: boolean;
  silent?: boolean;
}): Promise<ChannelMessage> {
  const existing = await findByClientId({
    projectId: args.projectId,
    clientId: args.clientId,
  });
  if (existing) return existing;

  const explicit = args.threadId ? await threadTarget(args.threadId) : null;
  if (args.threadId && (!explicit || explicit.projectId !== args.projectId)) {
    throw new Error("That thread is not part of this channel.");
  }

  const addressed = (await channelIsWatching(args.projectId))
    ? true
    : await mentionsAnyAgent(args);

  const target =
    explicit ??
    (addressed && !args.standalone
      ? await joinableThread({
          projectId: args.projectId,
          authorMemberId: args.authorMemberId,
          since: new Date(Date.now() - JOIN_WINDOW_MS),
        })
      : null);

  const seq = await allocateSeq(args.projectId);

  const inserted = await db
    .insert(messages)
    .values({
      organizationId: args.organizationId,
      projectId: args.projectId,
      seq,
      authorMemberId: args.authorMemberId,
      kind: "user",
      body: args.body,
      text: args.text,
      clientId: args.clientId,
      threadId: target ? target.id : null,
      parentMessageId: target ? target.rootMessageId : null,
    })
    .onConflictDoNothing({
      target: [messages.projectId, messages.clientId],
    })
    .returning({ id: messages.id });

  if (inserted[0] && args.attachmentIds?.length) {
    await bindAttachments({
      attachmentIds: args.attachmentIds,
      messageId: inserted[0].id,
      projectId: args.projectId,
      uploaderMemberId: args.authorMemberId,
    });
  }

  const row = inserted[0]
    ? await messageById(inserted[0].id)
    : await findByClientId({
        projectId: args.projectId,
        clientId: args.clientId,
      });

  if (!row) throw new Error("Message could not be stored.");

  await emitMessage(row);

  if (row.kind !== "user") return row;

  if (target) {
    void steer({ threadId: target.id, text: agentText(row) }).catch(() => {});
  } else if (row.parentMessageId === null && addressed && !args.silent) {
    void driveSession(row).catch(() => {});
  }

  return row;
}

export function agentText(message: ChannelMessage): string {
  return textWithAttachments(message.text, message.attachments);
}

async function channelIsWatching(projectId: string): Promise<boolean> {
  const row = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { watchEnabled: true },
  });
  return row?.watchEnabled ?? false;
}

async function mentionsAnyAgent(args: {
  organizationId: string;
  authorMemberId: string;
  role: string;
  body: unknown;
  text: string;
}): Promise<boolean> {
  const scope = {
    organizationId: args.organizationId,
    memberId: args.authorMemberId,
    role: args.role,
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

  return mentioned.agents.length > 0;
}

async function contextFor(message: ChannelMessage): Promise<string[]> {
  const earlier = await db
    .select({
      id: messages.id,
      authorMemberId: messages.authorMemberId,
      createdAt: messages.createdAt,
      threadId: messages.threadId,
      text: messages.text,
    })
    .from(messages)
    .where(
      and(
        eq(messages.projectId, message.projectId),
        eq(messages.kind, "user"),
        isNull(messages.parentMessageId),
        isNull(messages.deletedAt),
        lt(messages.seq, message.seq),
      ),
    )
    .orderBy(desc(messages.seq))
    .limit(RUN_LOOKBACK);

  const newest: RunMessage = {
    id: message.id,
    authorMemberId: message.authorMemberId,
    createdAt: message.createdAt,
    threadId: null,
    text: message.text,
  };

  const run = contiguousRun({ newest, earlier });
  return run.slice(0, -1).map((entry) => entry.text);
}

async function driveSession(message: ChannelMessage): Promise<void> {
  await ensureStarted();

  const [project] = await db
    .select({ organizationId: messages.organizationId })
    .from(messages)
    .where(eq(messages.id, message.id))
    .limit(1);
  if (!project) return;

  const context = await contextFor(message);

  const thread = await createThread({
    organizationId: project.organizationId,
    projectId: message.projectId,
    rootMessageId: message.id,
    runAsMemberId: message.authorMemberId,
  });
  if (!thread) return;

  await linkTaskFor(message, thread.id);

  await startSession({ threadId: thread.id, text: agentText(message), context });
}

const TASK_CLIENT_ID = /^task:([0-9a-f-]{36})(?::\d+)?$/i;

async function linkTaskFor(
  message: ChannelMessage,
  threadId: string,
): Promise<void> {
  const taskId = TASK_CLIENT_ID.exec(message.clientId ?? "")?.[1];
  if (!taskId) return;

  await linkTaskThread({
    taskId,
    projectId: message.projectId,
    threadId,
  }).catch((cause: Error) => {
    console.warn(
      `[messages] could not link task ${taskId} to thread ${threadId}: ${cause.message}`,
    );
    return null;
  });
}

export async function pausedMessageCount(projectId: string): Promise<number> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { watchPausedAt: true },
  });
  if (!project?.watchPausedAt) return 0;

  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.projectId, projectId),
        eq(messages.kind, "user"),
        isNull(messages.parentMessageId),
        isNull(messages.threadId),
        isNull(messages.deletedAt),
        gte(messages.createdAt, project.watchPausedAt),
      ),
    );

  return rows.length;
}

export async function startPausedSession(
  projectId: string,
): Promise<ChannelMessage | null> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { watchPausedAt: true },
  });

  const since = project?.watchPausedAt ?? null;
  await db
    .update(projects)
    .set({ watchEnabled: true, watchPausedAt: null })
    .where(eq(projects.id, projectId));

  if (!since) return null;

  const [newest] = await db
    .select(messageColumns)
    .from(messages)
    .leftJoin(members, eq(messages.authorMemberId, members.id))
    .leftJoin(users, eq(members.userId, users.id))
    .where(
      and(
        eq(messages.projectId, projectId),
        eq(messages.kind, "user"),
        isNull(messages.parentMessageId),
        isNull(messages.threadId),
        isNull(messages.deletedAt),
        gte(messages.createdAt, since),
      ),
    )
    .orderBy(desc(messages.seq))
    .limit(1);

  if (!newest) return null;

  const row = await withAttachment(toChannelMessage(newest));
  void driveSession(row).catch(() => {});
  return row;
}

export async function threadIdForMessage(
  messageId: string,
): Promise<string | null> {
  const row = await db.query.threads.findFirst({
    where: eq(threads.rootMessageId, messageId),
    columns: { id: true },
  });
  return row?.id ?? null;
}
