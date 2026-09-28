import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { TASK_STATUSES } from "../lib/task-status";
import { assignTask } from "../services/task-assignment";
import { listRuns } from "../services/task-recurrence";
import { listTasks, setTaskStatus, upcomingTasks } from "../services/tasks";
import { createTRPCRouter, memberProcedure } from "../trpc";

const statusSchema = z.enum(TASK_STATUSES);

export const tasksRouter = createTRPCRouter({
  list: memberProcedure
    .input(z.object({ projectId: z.string().uuid().optional() }).optional())
    .query(({ ctx, input }) =>
      listTasks({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        projectId: input?.projectId,
      }),
    ),

  upcoming: memberProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        withinMinutes: z.number().int().min(1).max(120).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      upcomingTasks({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        projectId: input.projectId,
        withinMinutes: input.withinMinutes,
      }),
    ),

  assign: memberProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        projectId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      assignTask({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        taskId: input.taskId,
        projectId: input.projectId,
      }),
    ),

  setStatus: memberProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        status: statusSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = await setTaskStatus({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        taskId: input.taskId,
        status: input.status,
      });
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });
      return task;
    }),

  runs: memberProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      listRuns({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        taskId: input.taskId,
        limit: input.limit,
      }),
    ),
});
