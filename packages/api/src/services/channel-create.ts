import { randomUUID } from "node:crypto";

import { db, projects, type SelectProject } from "@roster/db";
import {
  createWorkspaceEnqueued,
  routingKey,
  SupersetError,
} from "@roster/superset";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { slugifyProject, uniqueProjectSlug } from "../utils/project-slug";
import { ensureChannelAgent } from "./agents";
import { requireOrgProject, type ChannelScope } from "./channels";
import { jwtForMember } from "./sessions/connection";

export async function createChannel(
  args: ChannelScope & { name: string; sourceChannelId: string },
): Promise<SelectProject> {
  const source = await requireOrgProject({
    organizationId: args.organizationId,
    memberId: args.memberId,
    role: args.role,
    projectId: args.sourceChannelId,
  });
  if (!source) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "That channel no longer exists to base the new one on.",
    });
  }

  const hostKey = routingKey(source.supersetOrgId, source.supersetHostId);
  const auth = await jwtForMember({ memberId: args.memberId, hostKey });
  if (auth.jwt === null) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: auth.problem });
  }

  const existing = await db.query.projects.findMany({
    where: eq(projects.organizationId, args.organizationId),
    columns: { slug: true },
  });
  const slug = uniqueProjectSlug(
    slugifyProject(args.name),
    new Set(existing.map((row) => row.slug)),
  );

  const [channel] = await db
    .insert(projects)
    .values({
      organizationId: args.organizationId,
      supersetProjectId: source.supersetProjectId,
      supersetHostId: source.supersetHostId,
      supersetOrgId: source.supersetOrgId,
      name: args.name,
      slug,
      repoOwner: source.repoOwner,
      repoName: source.repoName,
      repoUrl: source.repoUrl,
      repoPath: source.repoPath,
      addedByMemberId: args.memberId,
      visibility: "private",
    })
    .returning();
  if (!channel) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "The channel could not be saved.",
    });
  }

  await ensureChannelAgent({
    organizationId: args.organizationId,
    projectId: channel.id,
    slug,
  });

  const workspaceId = randomUUID();
  try {
    await createWorkspaceEnqueued({
      jwt: auth.jwt,
      routingKey: hostKey,
      projectId: source.supersetProjectId,
      workspaceId,
      name: slug,
    });
  } catch (cause) {
    await db.delete(projects).where(eq(projects.id, channel.id));
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message:
        cause instanceof SupersetError
          ? cause.message
          : "That machine did not answer, so the workspace was not created.",
    });
  }

  const [updated] = await db
    .update(projects)
    .set({ supersetWorkspaceId: workspaceId })
    .where(eq(projects.id, channel.id))
    .returning();

  return updated ?? channel;
}
