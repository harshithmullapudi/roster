import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { TASK_STATUSES } from "../lib/task-status";
import {
  createAgent,
  defaultAgentFor,
  listAgents,
  resolveAgent,
  updateAgent,
} from "../services/agents";
import { reactionTarget, toggleReaction } from "../services/reactions";
import {
  listMentionableChannels,
  requireOrgProject,
} from "../services/channels";
import { delegate } from "../services/delegations";
import type { ChannelMessage } from "../services/messages";
import { listMessages, replyCountsByThread } from "../services/messages";
import { threadDetail, threadProjectId } from "../services/sessions";
import { assignTask } from "../services/task-assignment";
import { setTaskStatus, setTaskTitle } from "../services/tasks";
import { fileTask, type FileTaskRefusal } from "../services/task-filing";
import { RecurrenceError } from "../lib/recurrence";
import { cliProcedure, createTRPCRouter } from "../trpc";

function toCliMessage(message: ChannelMessage) {
  return {
    id: message.id,
    author:
      message.agentDisplay ||
      message.authorName ||
      message.authorEmail ||
      "unknown",
    kind: message.kind,
    text: message.text,
    createdAt: message.createdAt.toISOString(),
  };
}

const REFUSALS: Record<FileTaskRefusal["reason"], { code: "BAD_REQUEST" | "FORBIDDEN" | "INTERNAL_SERVER_ERROR"; message: string }> = {
  "needs-channel": {
    code: "BAD_REQUEST",
    message: "A repeating task needs a channel to post into. Pass --channel-id.",
  },
  "no-access": {
    code: "FORBIDDEN",
    message:
      "This key cannot put work in that channel. It is private to someone else, or does not exist.",
  },
  "not-created": {
    code: "INTERNAL_SERVER_ERROR",
    message: "Could not file that task.",
  },
  "not-recorded": {
    code: "INTERNAL_SERVER_ERROR",
    message: "Could not record when that task repeats.",
  },
};

function refusal(reason: FileTaskRefusal["reason"]): TRPCError {
  return new TRPCError(REFUSALS[reason]!);
}

async function reachableAgent(
  ctx: { organizationId: string; member: { id: string; role: string } },
  handle: string,
) {
  const agent = await resolveAgent({
    organizationId: ctx.organizationId,
    handle,
  });
  if (!agent) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No agent called "${handle}". Run \`roster agents\` to see who there is.`,
    });
  }

  return agent;
}

export const cliRouter = createTRPCRouter({
  whoami: cliProcedure.query(async ({ ctx }) => ({
    memberId: ctx.member.id,
    organizationId: ctx.organizationId,
    role: ctx.member.role,
    agentName: ctx.member.agentName,
  })),

  channels: cliProcedure.query(async ({ ctx }) => {
    const channels = await listMentionableChannels({
      organizationId: ctx.organizationId,
      memberId: ctx.member.id,
      role: ctx.member.role,
    });

    return channels.map((channel) => ({
      id: channel.id,
      slug: channel.slug,
      name: channel.name,
      visibility: channel.visibility,
      handle: channel.agentHandle,
    }));
  }),

  readMessages: cliProcedure
    .input(
      z.object({
        channelId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const project = await requireOrgProject({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        projectId: input.channelId,
      });

      if (!project) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "This key cannot read that channel. It is private to someone else, or does not exist.",
        });
      }

      const messages = await listMessages({
        projectId: project.id,
        limit: input.limit,
      });

      const counts = await replyCountsByThread(
        messages.flatMap((message) =>
          message.threadId ? [message.threadId] : [],
        ),
      );

      return {
        channel: { id: project.id, slug: project.slug, name: project.name },
        messages: messages.map((message) => ({
          ...toCliMessage(message),
          thread: message.threadId
            ? {
                id: message.threadId,
                replyCount: counts.get(message.threadId) ?? 0,
              }
            : null,
        })),
      };
    }),

  readThread: cliProcedure
    .input(
      z.object({
        threadId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const projectId = await threadProjectId(input.threadId);

      const project = projectId
        ? await requireOrgProject({
            organizationId: ctx.organizationId,
            memberId: ctx.member.id,
            role: ctx.member.role,
            projectId,
          })
        : null;

      if (!project) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "This key cannot read that thread. It is in a channel private to someone else, or does not exist.",
        });
      }

      const detail = await threadDetail({
        projectId: project.id,
        threadId: input.threadId,
        limit: input.limit,
      });

      if (!detail) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No thread with that id.",
        });
      }

      return {
        channel: { id: project.id, slug: project.slug, name: project.name },
        thread: {
          id: input.threadId,
          status: detail.thread.status,
          replyCount: detail.thread.replyCount,
        },
        messages: detail.messages.slice(-input.limit).map(toCliMessage),
      };
    }),

  agents: cliProcedure
    .input(z.object({ channelId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const scope = {
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
      };

      const channelAgent = input?.channelId
        ? await defaultAgentFor(input.channelId)
        : null;

      const found = await listAgents(
        scope,
        channelAgent ? { folderId: channelAgent.folderId } : undefined,
      );

      return found.map((agent) => ({
        handle: agent.handle,
        folderId: agent.folderId,
        folder: agent.folderName,
        channelSlug: agent.folderName,
        brief: agent.brief,
      }));
    }),

  createAgent: cliProcedure
    .input(
      z.object({
        channelId: z.string().uuid(),
        name: z.string().min(1).max(60),
        brief: z.string().max(4000).optional(),
        ephemeral: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await requireOrgProject({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        projectId: input.channelId,
      });
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That channel is not one you can see.",
        });
      }

      const sibling = await defaultAgentFor(project.id);
      if (!sibling) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That channel has no default agent to share a folder with.",
        });
      }

      const agent = await createAgent({
        organizationId: ctx.organizationId,
        folderId: sibling.folderId,
        name: input.name,
        brief: input.brief ?? null,
        ephemeral: input.ephemeral,
      });

      return {
        handle: agent.handle,
        folder: agent.folderName,
        channelSlug: agent.folderName,
        ephemeral: agent.ephemeral,
      };
    }),

  ask: cliProcedure
    .input(
      z.object({
        threadId: z.string().uuid(),
        handle: z.string().min(1),
        task: z.string().min(1),
        asHandle: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      delegate({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        parentThreadId: input.threadId,
        handle: input.handle,
        task: input.task,
        asHandle: input.asHandle,
      }),
    ),

  getAgent: cliProcedure
    .input(z.object({ handle: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const agent = await reachableAgent(ctx, input.handle);

      return {
        handle: agent.handle,
        folderId: agent.folderId,
        folder: agent.folderName,
        channelSlug: agent.folderName,
        brief: agent.brief,
        main: agent.main,
        ephemeral: agent.ephemeral,
      };
    }),

  updateAgent: cliProcedure
    .input(
      z.object({
        handle: z.string().min(1),
        name: z.string().min(1).max(60).optional(),
        brief: z.string().max(4000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const agent = await reachableAgent(ctx, input.handle);

      const updated = await updateAgent({
        organizationId: ctx.organizationId,
        id: agent.id,
        name: input.name,
        brief: input.brief,
      });

      return {
        handle: updated.handle,
        folder: updated.folderName,
        channelSlug: updated.folderName,
        brief: updated.brief,
        ephemeral: updated.ephemeral,
      };
    }),

  react: cliProcedure
    .input(
      z.object({
        messageId: z.string().uuid(),
        emoji: z.string().min(1).max(16),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const target = await reactionTarget(input.messageId);
      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "No such message. Message ids are printed by `roster read messages`.",
        });
      }

      const project = await requireOrgProject({
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
        projectId: target.projectId,
      });
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That message is in a channel you cannot reach.",
        });
      }

      const result = await toggleReaction({
        messageId: target.id,
        memberId: ctx.member.id,
        emoji: input.emoji,
      });

      return { added: result.added, emoji: input.emoji };
    }),

  createTask: cliProcedure
    .input(
      z.object({
        channelId: z.string().uuid().optional(),
        title: z.string().min(1).max(200),
        rrule: z.string().min(1).max(500).optional(),
        timezone: z.string().min(1).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let result;
      try {
        result = await fileTask({
          organizationId: ctx.organizationId,
          memberId: ctx.member.id,
          role: ctx.member.role,
          ...input,
        });
      } catch (cause) {
        if (cause instanceof RecurrenceError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: cause.message });
        }
        throw cause;
      }

      if ("task" in result) return result.task;

      throw refusal(result.refused.reason);
    }),

  updateTask: cliProcedure
    .input(
      z
        .object({
          taskId: z.string().uuid(),
          title: z.string().min(1).max(200).optional(),
          channelId: z.string().uuid().optional(),
        })
        .refine((input) => input.title !== undefined || input.channelId, {
          message: "Pass --title or --channel-id with what to change.",
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = {
        organizationId: ctx.organizationId,
        memberId: ctx.member.id,
        role: ctx.member.role,
      };

      let task = null;

      if (input.title !== undefined) {
        task = await setTaskTitle({ ...scope, taskId: input.taskId, title: input.title });
        if (!task) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This key cannot see a task with that id.",
          });
        }
      }

      if (input.channelId) {
        task = await assignTask({
          ...scope,
          taskId: input.taskId,
          projectId: input.channelId,
        });
      }

      return task;
    }),

  setTaskStatus: cliProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        status: z.enum(TASK_STATUSES),
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

      if (!task) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This key cannot see a task with that id.",
        });
      }

      return task;
    }),
});
