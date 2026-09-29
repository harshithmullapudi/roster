import { db, messages, projects, threadSessions, threads } from "@roster/db";
import {
  createTerminal,
  type HostAgent,
  killTerminal,
  listHostAgents,
  listTerminals,
  runAgent,
  sendToAgent,
  type TerminalSession,
  terminalSocketUrl,
  writeTerminalInput,
} from "@roster/superset";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";

import { requireOrgProject, visibleToMember } from "./channels";
import { resolveOrgAccess } from "./org";
import { hostConnection } from "./sessions/connection";

export interface Worktree {
  workspaceId: string;
  hostKey: string;
  threadId: string;
  rootMessageId: string;
  label: string;
  status: string;
  startedAt: Date;
  closedAt: Date | null;
}

export async function listWorktrees(
  projectId: string,
  options?: { includeClosed?: boolean },
): Promise<Worktree[]> {
  const rows = await db
    .select({
      workspaceId: threadSessions.supersetWorkspaceId,
      hostKey: threadSessions.supersetHostKey,
      threadId: threadSessions.threadId,
      rootMessageId: threads.rootMessageId,
      label: messages.text,
      status: threadSessions.status,
      startedAt: threadSessions.startedAt,
      closedAt: threadSessions.workspaceReapedAt,
    })
    .from(threadSessions)
    .innerJoin(threads, eq(threadSessions.threadId, threads.id))
    .innerJoin(messages, eq(messages.id, threads.rootMessageId))
    .where(
      and(
        eq(threadSessions.projectId, projectId),
        options?.includeClosed
          ? undefined
          : isNull(threadSessions.workspaceReapedAt),
      ),
    )
    .orderBy(desc(threadSessions.startedAt));

  return rows.flatMap((row) =>
    row.workspaceId && row.hostKey
      ? [
          {
            workspaceId: row.workspaceId,
            hostKey: row.hostKey,
            threadId: row.threadId,
            rootMessageId: row.rootMessageId,
            label: row.label.trim(),
            status: row.status,
            startedAt: row.startedAt,
            closedAt: row.closedAt,
          },
        ]
      : [],
  );
}

export async function countOpenWorktrees(scope: {
  organizationId: string;
  memberId: string;
  role: string;
}): Promise<number> {
  const rows = await db
    .select({ workspaceId: threadSessions.supersetWorkspaceId })
    .from(threadSessions)
    .innerJoin(projects, eq(threadSessions.projectId, projects.id))
    .where(
      and(
        eq(projects.organizationId, scope.organizationId),
        visibleToMember(scope.memberId, scope.role),
        isNull(threadSessions.workspaceReapedAt),
        isNotNull(threadSessions.supersetWorkspaceId),
      ),
    );

  return new Set(rows.map((row) => row.workspaceId)).size;
}

async function ownedWorktree(args: {
  organizationId: string;
  projectId: string;
  workspaceId: string;
  memberId: string;
}) {
  const [row] = await db
    .select({
      workspaceId: threadSessions.supersetWorkspaceId,
      hostKey: threadSessions.supersetHostKey,
    })
    .from(threadSessions)
    .where(
      and(
        eq(threadSessions.projectId, args.projectId),
        eq(threadSessions.supersetWorkspaceId, args.workspaceId),
        isNull(threadSessions.workspaceReapedAt),
      ),
    )
    .limit(1);

  if (!row?.workspaceId) return null;

  const connection = await channelConnection(args);

  return {
    workspaceId: row.workspaceId,
    hostKey: row.hostKey ?? connection.hostKey,
    jwt: connection.jwt,
  };
}

async function channelConnection(args: {
  organizationId: string;
  projectId: string;
  memberId: string;
}) {
  const channel = await db.query.projects.findFirst({
    where: eq(projects.id, args.projectId),
    columns: { defaultAgentId: true },
  });
  if (!channel) throw new Error("That channel no longer exists.");

  return hostConnection({
    organizationId: args.organizationId,
    agentMemberId: channel.defaultAgentId,
    asMemberId: args.memberId,
  });
}

interface WorktreeRef {
  organizationId: string;
  projectId: string;
  workspaceId: string;
  memberId: string;
}

class UnknownWorktree extends Error {
  constructor() {
    super("That worktree is not in this channel.");
    this.name = "UnknownWorktree";
  }
}

async function requireWorktree(ref: WorktreeRef) {
  const worktree = await ownedWorktree(ref);
  if (!worktree) throw new UnknownWorktree();
  return worktree;
}

export function isUnknownWorktree(error: unknown): boolean {
  return error instanceof UnknownWorktree;
}

export async function listWorktreeSessions(
  ref: WorktreeRef,
): Promise<TerminalSession[]> {
  const worktree = await requireWorktree(ref);
  return listTerminals({
    jwt: worktree.jwt,
    routingKey: worktree.hostKey,
    workspaceId: worktree.workspaceId,
  });
}

export async function listChannelAgents(args: {
  organizationId: string;
  projectId: string;
  memberId: string;
}): Promise<HostAgent[]> {
  const connection = await channelConnection(args);
  return listHostAgents({
    jwt: connection.jwt,
    routingKey: connection.hostKey,
  });
}

export async function spawnAgent(
  ref: WorktreeRef & { presetId: string },
): Promise<{ terminalId: string }> {
  const worktree = await requireWorktree(ref);
  const run = await runAgent({
    jwt: worktree.jwt,
    routingKey: worktree.hostKey,
    workspaceId: worktree.workspaceId,
    prompt: "",
    agent: ref.presetId,
  });
  if (run.kind !== "terminal") {
    throw new Error(`${run.label} did not start a terminal session.`);
  }
  return { terminalId: run.sessionId };
}

export async function spawnShell(
  ref: WorktreeRef,
): Promise<{ terminalId: string }> {
  const worktree = await requireWorktree(ref);
  return createTerminal({
    jwt: worktree.jwt,
    routingKey: worktree.hostKey,
    workspaceId: worktree.workspaceId,
  });
}

export async function closeWorktreeSession(
  ref: WorktreeRef & { terminalId: string },
): Promise<void> {
  const worktree = await requireWorktree(ref);
  await killTerminal({
    jwt: worktree.jwt,
    routingKey: worktree.hostKey,
    workspaceId: worktree.workspaceId,
    terminalId: ref.terminalId,
  });
}

export async function writeToSession(
  ref: WorktreeRef & { terminalId: string; data: string },
): Promise<void> {
  const worktree = await requireWorktree(ref);
  await writeTerminalInput({
    jwt: worktree.jwt,
    routingKey: worktree.hostKey,
    workspaceId: worktree.workspaceId,
    terminalId: ref.terminalId,
    data: ref.data,
  });
}

export async function sendToSession(
  ref: WorktreeRef & { terminalId: string; text: string },
): Promise<void> {
  const worktree = await requireWorktree(ref);
  await sendToAgent({
    jwt: worktree.jwt,
    routingKey: worktree.hostKey,
    workspaceId: worktree.workspaceId,
    terminalId: ref.terminalId,
    text: ref.text,
  });
}

export async function terminalStreamUrl(
  ref: WorktreeRef & { terminalId: string; seq: string },
): Promise<string> {
  const worktree = await requireWorktree(ref);
  return terminalSocketUrl({
    routingKey: worktree.hostKey,
    terminalId: ref.terminalId,
    workspaceId: worktree.workspaceId,
    jwt: worktree.jwt,
    seq: ref.seq,
  });
}

export async function authorizeTerminalStream(args: {
  userId: string;
  slug: string;
  projectId: string;
  workspaceId: string;
  terminalId: string;
  seq: string;
}): Promise<string | null> {
  const access = await resolveOrgAccess({ userId: args.userId, slug: args.slug });
  if (!access) return null;

  const project = await requireOrgProject({
    organizationId: access.organization.id,
    memberId: access.member.id,
    role: access.member.role,
    projectId: args.projectId,
  });
  if (!project) return null;

  try {
    return await terminalStreamUrl({
      organizationId: access.organization.id,
      projectId: project.id,
      memberId: access.member.id,
      workspaceId: args.workspaceId,
      terminalId: args.terminalId,
      seq: args.seq,
    });
  } catch (cause) {
    if (isUnknownWorktree(cause)) return null;
    throw cause;
  }
}
