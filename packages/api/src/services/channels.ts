import { channelStars, db, folders, members, projects, users } from "@roster/db";
import { TRPCError } from "@trpc/server";
import { aliasedTable, and, asc, eq, isNotNull, ne, or, sql } from "drizzle-orm";

import { can } from "../lib/access";
import { agentDisplay, normalizeHandle } from "../lib/agent-identity";
import type { ChannelVisibility } from "../lib/channel-visibility";
import { slugifyProject, uniqueProjectSlug } from "../utils/project-slug";

const defaultAgents = aliasedTable(members, "default_agents");

export interface Channel {
  id: string;
  name: string;
  slug: string;
  visibility: string;
  starred: boolean;
  defaultAgentId: string;
  repoOwner: string | null;
  repoName: string | null;
  repoPath: string | null;
  agentName: string;
  agentHandle: string;
  agentDisplay: string;
}

export interface ChannelGroups {
  starred: Channel[];
  public: Channel[];
  private: Channel[];
}

export interface ChannelScope {
  organizationId: string;
  memberId: string;
  role: string;
}

export async function listChannels(scope: ChannelScope): Promise<ChannelGroups> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      visibility: projects.visibility,
      defaultAgentId: projects.defaultAgentId,
      repoOwner: folders.repoOwner,
      repoName: folders.repoName,
      repoPath: folders.repoPath,
      starred: isNotNull(channelStars.id),
      mainAgentHandle: defaultAgents.agentName,
    })
    .from(projects)
    .leftJoin(defaultAgents, eq(defaultAgents.id, projects.defaultAgentId))
    .leftJoin(folders, eq(folders.id, defaultAgents.folderId))
    .leftJoin(
      channelStars,
      and(
        eq(channelStars.projectId, projects.id),
        eq(channelStars.memberId, scope.memberId),
      ),
    )
    .where(
      and(
        eq(projects.organizationId, scope.organizationId),
        visibleToMember(scope.memberId, scope.role),
      ),
    )
    .orderBy(asc(projects.slug));

  const groups: ChannelGroups = { starred: [], public: [], private: [] };

  for (const row of rows) {
    const { mainAgentHandle, ...rest } = row;
    const channel: Channel = {
      ...rest,
      starred: Boolean(row.starred),
      ...toAgent(mainAgentHandle),
    };
    if (channel.starred) groups.starred.push(channel);
    else if (channel.visibility === "private") groups.private.push(channel);
    else groups.public.push(channel);
  }

  return groups;
}

function toAgent(
  handle: string | null,
): Pick<Channel, "agentName" | "agentHandle" | "agentDisplay"> {
  const normalized = normalizeHandle(handle);
  return {
    agentName: normalized,
    agentHandle: normalized,
    agentDisplay: agentDisplay(normalized),
  };
}

export async function listMentionableChannels(
  scope: ChannelScope,
): Promise<Channel[]> {
  const groups = await listChannels(scope);
  return [...groups.starred, ...groups.public, ...groups.private].sort((a, b) =>
    a.agentHandle.localeCompare(b.agentHandle),
  );
}

export interface MentionableMember {
  id: string;
  handle: string;
  name: string;
}

export async function listMentionableMembers(
  scope: ChannelScope,
): Promise<MentionableMember[]> {
  const rows = await db
    .select({
      id: members.id,
      agentName: members.agentName,
      name: users.name,
      email: users.email,
    })
    .from(members)
    .innerJoin(users, eq(members.userId, users.id))
    .where(
      and(
        eq(members.organizationId, scope.organizationId),
        eq(members.type, "human"),
        isNotNull(members.agentName),
        ne(members.id, scope.memberId),
      ),
    );

  return rows
    .flatMap((row) => {
      const handle = (row.agentName ?? "").trim().toLowerCase();
      if (handle.length === 0) return [];
      const name = row.name.trim();
      return [
        {
          id: row.id,
          handle,
          name: name.length > 0 ? name : row.email,
        },
      ];
    })
    .sort((a, b) => a.handle.localeCompare(b.handle));
}

export async function findMemberByHandle(args: {
  organizationId: string;
  handle: string;
}): Promise<MentionableMember | null> {
  const wanted = args.handle.trim().toLowerCase().replace(/^@/, "");
  if (wanted.length === 0) return null;

  const [row] = await db
    .select({
      id: members.id,
      agentName: members.agentName,
      name: users.name,
      email: users.email,
    })
    .from(members)
    .innerJoin(users, eq(members.userId, users.id))
    .where(
      and(
        eq(members.organizationId, args.organizationId),
        eq(members.type, "human"),
        eq(sql`lower(${members.agentName})`, wanted),
      ),
    )
    .limit(1);

  if (!row) return null;

  const name = row.name.trim();
  return {
    id: row.id,
    handle: (row.agentName ?? "").toLowerCase(),
    name: name.length > 0 ? name : row.email,
  };
}

export async function channelById(projectId: string) {
  return db.query.projects.findFirst({ where: eq(projects.id, projectId) });
}

export function visibleToMember(memberId: string, role: string) {
  if (can(role, "channel:update")) return undefined;

  return or(
    eq(projects.visibility, "public"),
    and(
      eq(projects.visibility, "private"),
      eq(projects.addedByMemberId, memberId),
    ),
  );
}

export async function getChannelBySlug(args: ChannelScope & { slug: string }) {
  const channel = await db.query.projects.findFirst({
    where: and(
      eq(projects.organizationId, args.organizationId),
      eq(projects.slug, args.slug),
      visibleToMember(args.memberId, args.role),
    ),
  });
  return channel ?? null;
}

export async function requireOrgProject(
  args: ChannelScope & { projectId: string },
) {
  const project = await db.query.projects.findFirst({
    where: and(
      eq(projects.id, args.projectId),
      eq(projects.organizationId, args.organizationId),
      visibleToMember(args.memberId, args.role),
    ),
  });
  return project ?? null;
}

export interface ChannelPatch {
  visibility?: ChannelVisibility;
  defaultAgentId?: string;
}

async function requireOrgAgent(organizationId: string, agentId: string) {
  const agent = await db.query.members.findFirst({
    where: and(
      eq(members.id, agentId),
      eq(members.organizationId, organizationId),
      eq(members.type, "agent"),
    ),
  });
  if (!agent || agent.archivedAt) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "That agent is not one of this workspace's.",
    });
  }
  return agent;
}

export async function updateChannel(
  args: ChannelScope & { projectId: string; patch: ChannelPatch },
) {
  const project = await requireOrgProject(args);
  if (!project) return null;

  if (args.patch.defaultAgentId !== undefined) {
    await requireOrgAgent(args.organizationId, args.patch.defaultAgentId);
  }

  const patch = Object.fromEntries(
    Object.entries(args.patch).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(patch).length === 0) return project;

  const [updated] = await db
    .update(projects)
    .set(patch)
    .where(eq(projects.id, project.id))
    .returning();

  return updated ?? null;
}

export async function createChannel(
  args: ChannelScope & {
    name: string;
    defaultAgentId: string;
    visibility?: ChannelVisibility;
  },
) {
  const name = args.name.trim();
  if (name.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A channel needs a name.",
    });
  }

  await requireOrgAgent(args.organizationId, args.defaultAgentId);

  const existing = await db.query.projects.findMany({
    where: eq(projects.organizationId, args.organizationId),
    columns: { slug: true },
  });
  const slug = uniqueProjectSlug(
    slugifyProject(name),
    new Set(existing.map((row) => row.slug)),
  );

  const [row] = await db
    .insert(projects)
    .values({
      organizationId: args.organizationId,
      name,
      slug,
      defaultAgentId: args.defaultAgentId,
      addedByMemberId: args.memberId,
      visibility: args.visibility ?? "public",
    })
    .onConflictDoNothing()
    .returning();

  if (!row) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "A channel with that name already exists.",
    });
  }

  return row;
}

export interface ChannelWatch {
  projectId: string;
  watchEnabled: boolean;
  watchPausedAt: Date | null;
}

export async function setChannelWatch(args: {
  projectId: string;
  enabled: boolean;
}): Promise<ChannelWatch | null> {
  const [row] = await db
    .update(projects)
    .set(
      args.enabled
        ? { watchEnabled: true }
        : { watchEnabled: false, watchPausedAt: new Date() },
    )
    .where(eq(projects.id, args.projectId))
    .returning();

  if (!row) return null;
  return {
    projectId: row.id,
    watchEnabled: row.watchEnabled,
    watchPausedAt: row.watchPausedAt,
  };
}

export async function dismissChannelPause(
  projectId: string,
): Promise<ChannelWatch | null> {
  const [row] = await db
    .update(projects)
    .set({ watchPausedAt: null })
    .where(eq(projects.id, projectId))
    .returning();

  if (!row) return null;
  return {
    projectId: row.id,
    watchEnabled: row.watchEnabled,
    watchPausedAt: row.watchPausedAt,
  };
}

export async function toggleChannelStar(args: {
  memberId: string;
  projectId: string;
}) {
  const existing = await db.query.channelStars.findFirst({
    where: and(
      eq(channelStars.memberId, args.memberId),
      eq(channelStars.projectId, args.projectId),
    ),
  });

  if (existing) {
    await db.delete(channelStars).where(eq(channelStars.id, existing.id));
    return { projectId: args.projectId, starred: false };
  }

  await db
    .insert(channelStars)
    .values({ memberId: args.memberId, projectId: args.projectId })
    .onConflictDoNothing({
      target: [channelStars.memberId, channelStars.projectId],
    });

  return { projectId: args.projectId, starred: true };
}

export async function allocateSeq(projectId: string): Promise<number> {
  const [row] = await db
    .update(projects)
    .set({ lastSeq: sql`${projects.lastSeq} + 1` })
    .where(eq(projects.id, projectId))
    .returning({ lastSeq: projects.lastSeq });

  if (!row) throw new Error("Channel not found.");
  return Number(row.lastSeq);
}
