import { z } from "zod";

import { search } from "../services/search";
import { createTRPCRouter, memberProcedure } from "../trpc";

export const searchRouter = createTRPCRouter({
  all: memberProcedure
    .input(
      z.object({
        query: z.string().max(200),
        projectId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(25).optional(),
      }),
    )
    .query(async ({ ctx, input }) =>
      search({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        query: input.query,
        projectId: input.projectId,
        limit: input.limit,
      }),
    ),
});
