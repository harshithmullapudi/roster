import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  agentById,
  archiveAgent,
  createAgent,
  listAgents,
  setAgentBrief,
  updateAgent,
} from "../services/agents";
import type { ChannelScope } from "../services/channels";
import { createTRPCRouter, memberProcedure } from "../trpc";

async function ownAgent(scope: ChannelScope, agentId: string) {
  const agent = await agentById(agentId);
  if (!agent || agent.organizationId !== scope.organizationId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No such agent." });
  }
  return agent;
}

function scopeOf(ctx: {
  organizationId: string;
  member: { id: string; role: string };
}): ChannelScope {
  return {
    organizationId: ctx.organizationId,
    memberId: ctx.member.id,
    role: ctx.member.role,
  };
}

export const agentsRouter = createTRPCRouter({
  list: memberProcedure
    .input(z.object({ folderId: z.string().uuid().optional() }).optional())
    .query(({ ctx, input }) =>
      listAgents(scopeOf(ctx), { folderId: input?.folderId }),
    ),

  create: memberProcedure
    .input(
      z.object({
        folderId: z.string().uuid(),
        name: z.string().min(1).max(60),
        brief: z.string().max(4000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      createAgent({
        organizationId: ctx.organizationId,
        folderId: input.folderId,
        name: input.name,
        brief: input.brief ?? null,
      }),
    ),

  update: memberProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        name: z.string().min(1).max(60).optional(),
        brief: z.string().max(4000).nullable().optional(),
        folderId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ownAgent(scopeOf(ctx), input.agentId);
      return updateAgent({
        organizationId: ctx.organizationId,
        id: input.agentId,
        name: input.name,
        brief: input.brief,
        folderId: input.folderId,
      });
    }),

  setBrief: memberProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        brief: z.string().max(4000).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ownAgent(scopeOf(ctx), input.agentId);
      return setAgentBrief({ id: input.agentId, brief: input.brief });
    }),

  archive: memberProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ownAgent(scopeOf(ctx), input.agentId);
      await archiveAgent(input.agentId);
      return { archived: true };
    }),
});
