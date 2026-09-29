import {
  db,
  folders,
  members,
  projects,
  type SelectFolder,
  type SelectMember,
  threadSessions,
} from "@roster/db";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { normalizeHandle } from "../lib/agent-identity";
import type { ChannelScope } from "./channels";

export interface Agent {
  id: string;
  organizationId: string;
  handle: string;
  brief: string | null;
  folderId: string;
  folderName: string;
  repoName: string | null;
  main: boolean;
  ephemeral: boolean;
}

const IS_DEFAULT_SOMEWHERE = sql<boolean>`exists (
  select 1 from "roster"."projects" p
   where p."default_agent_id" = ${members.id})`;

const agentColumns = {
  id: members.id,
  organizationId: members.organizationId,
  handle: members.agentName,
  brief: members.brief,
  folderId: members.folderId,
  folderName: folders.name,
  repoName: folders.repoName,
  main: IS_DEFAULT_SOMEWHERE,
  createdAt: members.createdAt,
  ephemeral: members.ephemeral,
};

type AgentRow = {
  id: string;
  organizationId: string;
  handle: string | null;
  brief: string | null;
  folderId: string | null;
  folderName: string | null;
  repoName: string | null;
  main: boolean;
  createdAt: Date;
  ephemeral: boolean;
};

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    handle: row.handle ?? "agent",
    brief: row.brief,
    folderId: row.folderId ?? "",
    folderName: row.folderName ?? "",
    repoName: row.repoName,
    main: row.main,
    ephemeral: row.ephemeral,
  };
}

export async function listAgents(
  scope: ChannelScope,
  filter?: { folderId?: string },
): Promise<Agent[]> {
  const rows = await db
    .select(agentColumns)
    .from(members)
    .innerJoin(folders, eq(members.folderId, folders.id))
    .where(
      and(
        eq(members.organizationId, scope.organizationId),
        eq(members.type, "agent"),
        isNull(members.archivedAt),
        filter?.folderId ? eq(members.folderId, filter.folderId) : undefined,
      ),
    )
    .orderBy(asc(members.agentName), asc(members.createdAt));

  return rows.map((row) => toAgent(row));
}

export async function resolveAgent(args: {
  organizationId: string;
  handle: string;
}): Promise<Agent | null> {
  const wanted = normalizeHandle(args.handle);
  if (wanted.length === 0) return null;

  const [row] = await db
    .select(agentColumns)
    .from(members)
    .innerJoin(folders, eq(members.folderId, folders.id))
    .where(
      and(
        eq(members.organizationId, args.organizationId),
        eq(members.type, "agent"),
        isNull(members.archivedAt),
        eq(sql`lower(${members.agentName})`, wanted),
      ),
    )
    .limit(1);

  return row ? toAgent(row) : null;
}

export async function agentById(id: string): Promise<Agent | null> {
  const [row] = await db
    .select(agentColumns)
    .from(members)
    .innerJoin(folders, eq(members.folderId, folders.id))
    .where(and(eq(members.id, id), eq(members.type, "agent")))
    .limit(1);

  return row ? toAgent(row) : null;
}

export async function defaultAgentFor(projectId: string): Promise<Agent | null> {
  const [channel] = await db
    .select({ defaultAgentId: projects.defaultAgentId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!channel) return null;

  return agentById(channel.defaultAgentId);
}

const HANDLE_SHAPE = /^[a-z0-9][a-z0-9-]*$/;

export async function createAgent(args: {
  organizationId: string;
  folderId: string;
  name: string;
  brief?: string | null;
  ephemeral?: boolean;
}): Promise<Agent> {
  const folder = await db.query.folders.findFirst({
    where: and(
      eq(folders.id, args.folderId),
      eq(folders.organizationId, args.organizationId),
    ),
  });
  if (!folder) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "That folder is not one of this workspace's.",
    });
  }

  const handle = normalizeHandle(args.name);
  if (!HANDLE_SHAPE.test(handle)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "An agent name can only hold lowercase letters, numbers and dashes.",
    });
  }

  const existing = await resolveAgent({
    organizationId: args.organizationId,
    handle,
  });
  if (existing) {
    if (existing.folderId !== args.folderId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `"@${handle}" is taken in this workspace. Pick another name.`,
      });
    }
    return existing;
  }

  const [row] = await db
    .insert(members)
    .values({
      organizationId: args.organizationId,
      userId: null,
      role: "member",
      type: "agent",
      agentName: handle,
      folderId: args.folderId,
      brief: args.brief ?? null,
      ephemeral: Boolean(args.ephemeral),
    })
    .onConflictDoNothing({
      target: [members.organizationId, members.agentName],
    })
    .returning();

  if (!row) {
    const raced = await resolveAgent({
      organizationId: args.organizationId,
      handle,
    });
    if (raced) return raced;
    throw new TRPCError({
      code: "CONFLICT",
      message: `"@${handle}" is taken in this workspace. Pick another name.`,
    });
  }

  const agent = await agentById(row.id);
  if (!agent) throw new Error("That agent could not be read back.");

  return agent;
}

async function channelDefaultingTo(agentId: string) {
  return db.query.projects.findFirst({
    where: eq(projects.defaultAgentId, agentId),
  });
}

export async function archiveAgent(id: string): Promise<void> {
  const agent = await agentById(id);
  if (!agent) return;

  const channel = await channelDefaultingTo(agent.id);
  if (channel) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `That agent answers #${channel.slug} — give the channel another default agent first.`,
    });
  }

  await db
    .update(members)
    .set({
      archivedAt: new Date(),
      agentName: `${agent.handle}-archived-${id.replace(/-/g, "").slice(0, 6)}`,
    })
    .where(and(eq(members.id, id), eq(members.type, "agent")));
}

export async function setAgentBrief(args: {
  id: string;
  brief: string | null;
}): Promise<Agent | null> {
  await db
    .update(members)
    .set({ brief: args.brief })
    .where(and(eq(members.id, args.id), eq(members.type, "agent")));

  return agentById(args.id);
}

export async function updateAgent(args: {
  organizationId: string;
  id: string;
  name?: string;
  brief?: string | null;
  folderId?: string;
}): Promise<Agent> {
  const agent = await agentById(args.id);
  if (!agent) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No such agent." });
  }

  const patch: { agentName?: string; brief?: string | null; folderId?: string } =
    {};

  if (args.brief !== undefined) patch.brief = args.brief;

  if (args.folderId !== undefined && args.folderId !== agent.folderId) {
    const folder = await db.query.folders.findFirst({
      where: and(
        eq(folders.id, args.folderId),
        eq(folders.organizationId, args.organizationId),
      ),
    });
    if (!folder) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "That folder is not one of this workspace's.",
      });
    }
    patch.folderId = args.folderId;
  }

  if (args.name !== undefined) {
    const handle = normalizeHandle(args.name);

    if (!HANDLE_SHAPE.test(handle)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "An agent name can only hold lowercase letters, numbers and dashes.",
      });
    }

    if (handle !== agent.handle) {
      const taken = await resolveAgent({
        organizationId: args.organizationId,
        handle,
      });
      if (taken) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `"@${handle}" is taken in this workspace. Pick another name.`,
        });
      }
      patch.agentName = handle;
    }
  }

  if (Object.keys(patch).length > 0) {
    await db
      .update(members)
      .set(patch)
      .where(and(eq(members.id, args.id), eq(members.type, "agent")));
  }

  const updated = await agentById(args.id);
  if (!updated) throw new Error("That agent could not be read back.");

  return updated;
}

export async function archiveEphemeralAgentsFor(
  threadId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: members.id })
    .from(threadSessions)
    .innerJoin(members, eq(members.id, threadSessions.agentMemberId))
    .where(
      and(
        eq(threadSessions.threadId, threadId),
        eq(members.type, "agent"),
        eq(members.ephemeral, true),
        isNull(members.archivedAt),
      ),
    );

  const archived: string[] = [];
  for (const row of rows) {
    try {
      await archiveAgent(row.id);
      archived.push(row.id);
    } catch {
      continue;
    }
  }

  return archived;
}

export async function agentMemberRow(
  id: string,
): Promise<SelectMember | undefined> {
  return db.query.members.findFirst({ where: eq(members.id, id) });
}

export async function agentFolder(
  agentMemberId: string,
): Promise<SelectFolder | null> {
  const agent = await db.query.members.findFirst({
    where: eq(members.id, agentMemberId),
    columns: { folderId: true },
  });
  if (!agent?.folderId) return null;

  const folder = await db.query.folders.findFirst({
    where: eq(folders.id, agent.folderId),
  });
  return folder ?? null;
}

export async function ensureFolderAgent(args: {
  organizationId: string;
  folderId: string;
  handle: string;
}): Promise<Agent> {
  const base = normalizeHandle(args.handle) || "agent";

  const taken = await resolveAgent({
    organizationId: args.organizationId,
    handle: base,
  });
  if (taken && taken.folderId === args.folderId) return taken;

  const handle = taken
    ? `${base}-${args.folderId.replace(/-/g, "").slice(0, 4)}`
    : base;

  return createAgent({
    organizationId: args.organizationId,
    folderId: args.folderId,
    name: handle,
  });
}
