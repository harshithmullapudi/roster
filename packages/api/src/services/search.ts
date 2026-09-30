import { db, members, messages, projects, tasks, users } from "@roster/db";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { agentDisplay, normalizeHandle } from "../lib/agent-identity";
import { DELEGATION_KIND } from "../lib/message-kind";
import {
  HEADLINE_OPTIONS,
  toSegments,
  toTsQuery,
  type SnippetSegment,
} from "../lib/search-query";
import { normalizeTaskStatus, type TaskStatus } from "../lib/task-status";
import {
  listChannels,
  requireOrgProject,
  type ChannelScope,
} from "./channels";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;

export interface MessageHit {
  id: string;
  projectId: string;
  channelSlug: string;
  threadId: string | null;
  author: string | null;
  snippet: SnippetSegment[];
  createdAt: Date;
}

export interface TaskHit {
  id: string;
  projectId: string | null;
  channelSlug: string | null;
  threadId: string | null;
  title: string;
  status: TaskStatus;
  snippet: SnippetSegment[];
}

export interface SearchResults {
  messages: MessageHit[];
  tasks: TaskHit[];
}

const EMPTY: SearchResults = { messages: [], tasks: [] };

interface Reach {
  projectIds: string[];
  backlog: boolean;
}

async function reachableChannels(
  scope: ChannelScope & { projectId?: string },
): Promise<Reach | null> {
  if (scope.projectId) {
    const project = await requireOrgProject({
      organizationId: scope.organizationId,
      memberId: scope.memberId,
      role: scope.role,
      projectId: scope.projectId,
    });
    return project ? { projectIds: [project.id], backlog: false } : null;
  }

  const groups = await listChannels(scope);
  const projectIds = [
    ...groups.starred,
    ...groups.public,
    ...groups.private,
  ].map((channel) => channel.id);

  return { projectIds, backlog: true };
}

function authorName(row: {
  authorName: string | null;
  authorEmail: string | null;
  authorType: string | null;
  authorAgentName: string | null;
}): string | null {
  if (row.authorType === "agent") {
    const handle = normalizeHandle(row.authorAgentName);
    return handle ? agentDisplay(handle) : null;
  }
  return row.authorName || row.authorEmail;
}

async function searchMessages(
  tsQuery: string,
  reach: Reach,
  limit: number,
): Promise<MessageHit[]> {
  if (reach.projectIds.length === 0) return [];

  const query = sql`to_tsquery('english', ${tsQuery})`;
  const vector = sql`to_tsvector('english', ${messages.text})`;

  const hits = db
    .select({
      id: messages.id,
      projectId: messages.projectId,
      threadId: messages.threadId,
      authorMemberId: messages.authorMemberId,
      createdAt: messages.createdAt,
      seq: messages.seq,
      text: messages.text,
      channelSlug: projects.slug,
      rank: sql<number>`ts_rank_cd(${vector}, ${query})`.as("rank"),
    })
    .from(messages)
    .innerJoin(projects, eq(projects.id, messages.projectId))
    .where(
      and(
        inArray(messages.projectId, reach.projectIds),
        isNull(messages.deletedAt),
        sql`${vector} @@ ${query}`,
        sql`${messages.kind} <> ${DELEGATION_KIND}`,
      ),
    )
    .orderBy(desc(sql`rank`), desc(messages.seq))
    .limit(limit)
    .as("hits");

  const rows = await db
    .select({
      id: hits.id,
      projectId: hits.projectId,
      channelSlug: hits.channelSlug,
      threadId: hits.threadId,
      createdAt: hits.createdAt,
      rank: hits.rank,
      seq: hits.seq,
      snippet: sql<string>`ts_headline('english', ${hits.text}, ${query}, ${HEADLINE_OPTIONS})`,
      authorName: users.name,
      authorEmail: users.email,
      authorType: members.type,
      authorAgentName: members.agentName,
    })
    .from(hits)
    .leftJoin(members, eq(members.id, hits.authorMemberId))
    .leftJoin(users, eq(users.id, members.userId))
    .orderBy(desc(hits.rank), desc(hits.seq));

  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    channelSlug: row.channelSlug,
    threadId: row.threadId,
    author: authorName(row),
    snippet: toSegments(row.snippet),
    createdAt: row.createdAt,
  }));
}

async function searchTasks(
  organizationId: string,
  tsQuery: string,
  reach: Reach,
  limit: number,
): Promise<TaskHit[]> {
  const scoped = inArray(tasks.projectId, reach.projectIds);
  const reachable = reach.backlog
    ? reach.projectIds.length > 0
      ? or(isNull(tasks.projectId), scoped)
      : isNull(tasks.projectId)
    : scoped;

  if (!reach.backlog && reach.projectIds.length === 0) return [];

  const query = sql`to_tsquery('english', ${tsQuery})`;
  const vector = sql`to_tsvector('english', ${tasks.title})`;

  const rows = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      channelSlug: projects.slug,
      threadId: tasks.threadId,
      title: tasks.title,
      status: tasks.status,
      createdAt: tasks.createdAt,
      snippet: sql<string>`ts_headline('english', ${tasks.title}, ${query}, ${HEADLINE_OPTIONS})`,
      rank: sql<number>`ts_rank_cd(${vector}, ${query})`.as("rank"),
    })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(tasks.organizationId, organizationId),
        reachable,
        sql`${vector} @@ ${query}`,
      ),
    )
    .orderBy(desc(sql`rank`), desc(tasks.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    channelSlug: row.channelSlug,
    threadId: row.threadId,
    title: row.title,
    status: normalizeTaskStatus(row.status),
    snippet: toSegments(row.snippet),
  }));
}

export async function search(
  scope: ChannelScope & {
    query: string;
    projectId?: string;
    limit?: number;
  },
): Promise<SearchResults> {
  const tsQuery = toTsQuery(scope.query);
  if (!tsQuery) return EMPTY;

  const reach = await reachableChannels(scope);
  if (!reach) return EMPTY;

  const limit = Math.min(Math.max(scope.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const [messageHits, taskHits] = await Promise.all([
    searchMessages(tsQuery, reach, limit),
    searchTasks(scope.organizationId, tsQuery, reach, limit),
  ]);

  return { messages: messageHits, tasks: taskHits };
}
