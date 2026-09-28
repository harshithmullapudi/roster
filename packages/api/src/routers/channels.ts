import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { CHANNEL_VISIBILITIES } from "../lib/channel-visibility";
import { listAgents } from "../services/agents";
import { createChannel } from "../services/channel-create";
import {
  dismissChannelPause,
  getChannelBySlug,
  listChannels,
  listMentionableMembers,
  requireOrgProject,
  setChannelWatch,
  toggleChannelStar,
  updateChannel,
} from "../services/channels";
import { pausedMessageCount, startPausedSession } from "../services/messages";
import {
  capabilityProcedure,
  createTRPCRouter,
  memberProcedure,
} from "../trpc";

export const channelsRouter = createTRPCRouter({
  create: capabilityProcedure("channel:create")
    .input(
      z.object({
        name: z
          .string()
          .trim()
          .min(1, "Give the channel a name.")
          .max(60, "Keep it under 60 characters."),
        sourceChannelId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const channel = await createChannel({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        name: input.name,
        sourceChannelId: input.sourceChannelId,
      });
      return {
        id: channel.id,
        slug: channel.slug,
        name: channel.name,
        visibility: channel.visibility,
      };
    }),

  list: memberProcedure.query(({ ctx }) =>
    listChannels({
      organizationId: ctx.organizationId,
      memberId: ctx.member.id,
      role: ctx.member.role,
    }),
  ),

  mentionable: memberProcedure.query(async ({ ctx }) => {
    const scope = {
      organizationId: ctx.organizationId,
      memberId: ctx.member.id,
      role: ctx.member.role,
    };

    const [agents, people] = await Promise.all([
      listAgents(scope),
      listMentionableMembers(scope),
    ]);

    return [
      ...agents.map((agent) => ({
        id: agent.projectId,
        kind: "agent" as const,
        slug: agent.channelSlug,
        name: agent.channelName,
        visibility: "public",
        handle: agent.handle,
        display: agent.handle,
      })),
      ...people.map((person) => ({
        id: person.id,
        kind: "member" as const,
        slug: person.handle,
        name: person.name,
        visibility: "public",
        handle: person.handle,
        display: person.name,
      })),
    ];
  }),

  get: memberProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const channel = await getChannelBySlug({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        slug: input.slug,
      });
      if (!channel) throw new TRPCError({ code: "NOT_FOUND" });
      return channel;
    }),

  toggleStar: memberProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const project = await requireOrgProject({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        projectId: input.projectId,
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      return toggleChannelStar({
        memberId: ctx.member.id,
        projectId: project.id,
      });
    }),

  setWatch: memberProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await requireOrgProject({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        projectId: input.projectId,
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const watch = await setChannelWatch({
        projectId: project.id,
        enabled: input.enabled,
      });
      if (!watch) throw new TRPCError({ code: "NOT_FOUND" });

      return {
        ...watch,
        pendingCount: await pausedMessageCount(project.id),
      };
    }),

  dismissPause: memberProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const project = await requireOrgProject({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        projectId: input.projectId,
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const watch = await dismissChannelPause(project.id);
      if (!watch) throw new TRPCError({ code: "NOT_FOUND" });

      return { ...watch, pendingCount: 0 };
    }),

  startFromPause: memberProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const project = await requireOrgProject({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        projectId: input.projectId,
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const started = await startPausedSession(project.id);
      return { started: started !== null };
    }),

  update: capabilityProcedure("channel:update")
    .input(
      z.object({
        projectId: z.string().uuid(),
        visibility: z.enum(CHANNEL_VISIBILITIES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, ...patch } = input;

      const channel = await updateChannel({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        projectId,
        patch,
      });
      if (!channel) throw new TRPCError({ code: "NOT_FOUND" });

      return {
        id: channel.id,
        slug: channel.slug,
        visibility: channel.visibility,
      };
    }),
});
