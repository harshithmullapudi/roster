import { db, members, projects, tasks, users } from "@roster/db";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
} from "drizzle-orm";

import { normalizeTaskStatus, type TaskStatus } from "../lib/task-status";

import {
  listChannels,
  requireOrgProject,
  type ChannelScope,
} from "./channels";

export interface TaskCreator {
  memberId: string;
  name: string;
}

export interface Task {
  id: string;
  projectId: string | null;
  threadId: string | null;
  title: string;
  status: TaskStatus;
  createdAt: Date;
  completedAt: Date | null;
  channelSlug: string | null;
  channelName: string | null;
  createdBy: TaskCreator | null;
  rrule: string | null;
  timezone: string;
  nextRunAt: Date | null;
  recurrenceDisabledReason: string | null;
}

const taskColumns = {
  id: tasks.id,
  projectId: tasks.projectId,
  threadId: tasks.threadId,
  title: tasks.title,
  status: tasks.status,
  createdAt: tasks.createdAt,
  completedAt: tasks.completedAt,
  channelSlug: projects.slug,
  channelName: projects.name,
  createdByMemberId: tasks.createdByMemberId,
  createdByName: users.name,
  createdByEmail: users.email,
  rrule: tasks.rrule,
  timezone: tasks.timezone,
  nextRunAt: tasks.nextRunAt,
  recurrenceDisabledReason: tasks.recurrenceDisabledReason,
};

function selectTasks() {
  return db
    .select(taskColumns)
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(members, eq(tasks.createdByMemberId, members.id))
    .leftJoin(users, eq(members.userId, users.id));
}

function toTask(row: {
  id: string;
  projectId: string | null;
  threadId: string | null;
  title: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  channelSlug: string | null;
  channelName: string | null;
  createdByMemberId: string | null;
  createdByName: string | null;
  createdByEmail: string | null;
  rrule: string | null;
  timezone: string;
  nextRunAt: Date | null;
  recurrenceDisabledReason: string | null;
}): Task {
  const {
    createdByMemberId,
    createdByName,
    createdByEmail,
    ...rest
  } = row;

  const name = createdByName || createdByEmail;

  return {
    ...rest,
    status: normalizeTaskStatus(row.status),
    createdBy:
      createdByMemberId && name ? { memberId: createdByMemberId, name } : null,
  };
}

export async function listTasks(
  scope: ChannelScope & { projectId?: string },
): Promise<Task[]> {
  if (scope.projectId) {
    const project = await requireOrgProject({
      organizationId: scope.organizationId,
      memberId: scope.memberId,
      role: scope.role,
      projectId: scope.projectId,
    });
    if (!project) return [];

    const rows = await selectTasks()
      .where(eq(tasks.projectId, project.id))
      .orderBy(desc(tasks.createdAt));

    return rows.map(toTask);
  }

  const groups = await listChannels(scope);
  const visibleIds = [
    ...groups.starred,
    ...groups.public,
    ...groups.private,
  ].map((channel) => channel.id);

  const reachable =
    visibleIds.length > 0
      ? or(isNull(tasks.projectId), inArray(tasks.projectId, visibleIds))
      : isNull(tasks.projectId);

  const rows = await selectTasks()
    .where(and(eq(tasks.organizationId, scope.organizationId), reachable))
    .orderBy(desc(tasks.createdAt));

  return rows.map(toTask);
}

export const UPCOMING_WINDOW_MINUTES = 30;

export async function upcomingTasks(
  scope: ChannelScope & { projectId: string; withinMinutes?: number },
): Promise<Task[]> {
  const project = await requireOrgProject({
    organizationId: scope.organizationId,
    memberId: scope.memberId,
    role: scope.role,
    projectId: scope.projectId,
  });
  if (!project) return [];

  const now = new Date();
  const until = new Date(
    now.getTime() + (scope.withinMinutes ?? UPCOMING_WINDOW_MINUTES) * 60_000,
  );

  const rows = await selectTasks()
    .where(
      and(
        eq(tasks.projectId, project.id),
        isNotNull(tasks.rrule),
        gte(tasks.nextRunAt, now),
        lte(tasks.nextRunAt, until),
      ),
    )
    .orderBy(asc(tasks.nextRunAt));

  return rows.map(toTask);
}

export async function createTask(args: {
  organizationId: string;
  memberId: string;
  title: string;
  status: TaskStatus;
}): Promise<Task | null> {
  const [inserted] = await db
    .insert(tasks)
    .values({
      organizationId: args.organizationId,
      title: args.title,
      status: args.status,
      createdByMemberId: args.memberId,
      completedAt: args.status === "done" ? new Date() : null,
    })
    .returning({ id: tasks.id });

  if (!inserted) return null;
  return findById(inserted.id);
}

export async function setTaskStatus(
  args: ChannelScope & { taskId: string; status: TaskStatus },
): Promise<Task | null> {
  const task = await reachableTask(args);
  if (!task) return null;

  await db
    .update(tasks)
    .set({
      status: args.status,
      updatedAt: new Date(),
      completedAt: args.status === "done" ? new Date() : null,
    })
    .where(eq(tasks.id, task.id));

  return findById(task.id);
}

export async function reachableTask(
  args: ChannelScope & { taskId: string },
): Promise<Task | null> {
  const [row] = await selectTasks()
    .where(
      and(
        eq(tasks.id, args.taskId),
        eq(tasks.organizationId, args.organizationId),
      ),
    )
    .limit(1);

  if (!row) return null;
  const task = toTask(row);

  if (task.projectId) {
    const project = await requireOrgProject({
      organizationId: args.organizationId,
      memberId: args.memberId,
      role: args.role,
      projectId: task.projectId,
    });
    if (!project) return null;
  }

  return task;
}

export async function setTaskProject(args: {
  taskId: string;
  projectId: string;
}): Promise<Task | null> {
  await db
    .update(tasks)
    .set({ projectId: args.projectId, updatedAt: new Date() })
    .where(eq(tasks.id, args.taskId));

  return findById(args.taskId);
}

export async function linkTaskThread(args: {
  taskId: string;
  projectId: string;
  threadId: string;
}): Promise<Task | null> {
  await db
    .update(tasks)
    .set({
      projectId: args.projectId,
      threadId: args.threadId,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, args.taskId));

  return findById(args.taskId);
}

export async function taskForThread(threadId: string): Promise<Task | null> {
  const [row] = await selectTasks()
    .where(eq(tasks.threadId, threadId))
    .limit(1);

  return row ? toTask(row) : null;
}

export async function findById(id: string): Promise<Task | null> {
  const [row] = await selectTasks().where(eq(tasks.id, id)).limit(1);

  return row ? toTask(row) : null;
}
