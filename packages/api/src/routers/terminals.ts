import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { requireOrgProject } from "../services/channels";
import {
  closeWorktreeSession,
  countOpenWorktrees,
  isUnknownWorktree,
  listChannelAgents,
  listWorktreeSessions,
  listWorktrees,
  sendToSession,
  spawnAgent,
  spawnShell,
  writeToSession,
} from "../services/terminals";
import { createTRPCRouter, memberProcedure } from "../trpc";

const channelInput = z.object({ projectId: z.string().uuid() });
const worktreeInput = channelInput.extend({ workspaceId: z.string().min(1) });

function rethrow(cause: unknown): never {
  if (isUnknownWorktree(cause)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No such worktree." });
  }
  throw cause;
}

export const terminalsRouter = createTRPCRouter({
  worktrees: memberProcedure
    .input(channelInput.extend({ includeClosed: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      const project = await requireOrgProject({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        projectId: input.projectId,
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      return listWorktrees(project.id, { includeClosed: input.includeClosed });
    }),

  openFolders: memberProcedure.query(({ ctx }) =>
    countOpenWorktrees({
      organizationId: ctx.organizationId,
      memberId: ctx.member.id,
      role: ctx.member.role,
    }),
  ),

  sessions: memberProcedure
    .input(worktreeInput)
    .query(async ({ ctx, input }) => {
      const project = await requireOrgProject({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        projectId: input.projectId,
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      return listWorktreeSessions({
        organizationId: ctx.organizationId,
        projectId: project.id,
        memberId: ctx.member.id,
        workspaceId: input.workspaceId,
      }).catch(rethrow);
    }),

  agents: memberProcedure.input(channelInput).query(async ({ ctx, input }) => {
    const project = await requireOrgProject({
      organizationId: ctx.organizationId,
      memberId: ctx.member.id,
      role: ctx.member.role,
      projectId: input.projectId,
    });
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });

    return listChannelAgents({
      organizationId: ctx.organizationId,
      projectId: project.id,
      memberId: ctx.member.id,
    });
  }),

  spawnAgent: memberProcedure
    .input(worktreeInput.extend({ presetId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const project = await requireOrgProject({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        projectId: input.projectId,
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      return spawnAgent({
        organizationId: ctx.organizationId,
        projectId: project.id,
        memberId: ctx.member.id,
        workspaceId: input.workspaceId,
        presetId: input.presetId,
      }).catch(rethrow);
    }),

  spawnShell: memberProcedure
    .input(worktreeInput)
    .mutation(async ({ ctx, input }) => {
      const project = await requireOrgProject({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        projectId: input.projectId,
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      return spawnShell({
        organizationId: ctx.organizationId,
        projectId: project.id,
        memberId: ctx.member.id,
        workspaceId: input.workspaceId,
      }).catch(rethrow);
    }),

  write: memberProcedure
    .input(
      worktreeInput.extend({
        terminalId: z.string().min(1),
        data: z.string().min(1),
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

      await writeToSession({
        organizationId: ctx.organizationId,
        projectId: project.id,
        memberId: ctx.member.id,
        workspaceId: input.workspaceId,
        terminalId: input.terminalId,
        data: input.data,
      }).catch(rethrow);

      return { written: true as const };
    }),

  send: memberProcedure
    .input(
      worktreeInput.extend({
        terminalId: z.string().min(1),
        text: z.string().min(1),
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

      await sendToSession({
        organizationId: ctx.organizationId,
        projectId: project.id,
        memberId: ctx.member.id,
        workspaceId: input.workspaceId,
        terminalId: input.terminalId,
        text: input.text,
      }).catch(rethrow);

      return { sent: true as const };
    }),

  close: memberProcedure
    .input(worktreeInput.extend({ terminalId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const project = await requireOrgProject({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        projectId: input.projectId,
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      await closeWorktreeSession({
        organizationId: ctx.organizationId,
        projectId: project.id,
        memberId: ctx.member.id,
        workspaceId: input.workspaceId,
        terminalId: input.terminalId,
      }).catch(rethrow);

      return { terminalId: input.terminalId };
    }),
});
