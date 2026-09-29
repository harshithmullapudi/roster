import { createHash } from "node:crypto";

import {
  db,
  delegations,
  messages,
  type SelectDelegation,
  threads,
} from "@roster/db";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import { DELEGATION_KIND } from "../lib/message-kind";
import { type Agent, agentById, listAgents, resolveAgent } from "./agents";
import { allocateSeq, findMemberByHandle } from "./channels";
import type { ChannelScope } from "./channels";
import { emitMessageById } from "./message-events";
import { notifyDelegationReceived } from "./notifications";
import {
  askingSession,
  ensureStarted,
  joinThread,
  markWaiting,
  steer,
} from "./sessions";
import { markdownToTiptap, textToTiptap } from "../utils/tiptap";

export const MAX_DEPTH = 3;

export interface DelegationRequest extends ChannelScope {
  parentThreadId: string;
  handle: string;
  task: string;
}

export interface DelegationResult {
  id: string;
  targetHandle: string;
  childThreadId: string | null;
  sameWorktree: boolean;
  depth: number;
}

async function rejectPersonHandle(args: ChannelScope & { handle: string }) {
  const person = await findMemberByHandle({
    organizationId: args.organizationId,
    handle: args.handle,
  });
  if (!person) return;

  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `"@${person.handle}" is ${person.name}, a person — not an agent. Run \`roster agents\` to see who you can ask.`,
  });
}

export async function delegate(
  args: DelegationRequest,
): Promise<DelegationResult> {
  await ensureStarted();

  const parent = await db.query.threads.findFirst({
    where: eq(threads.id, args.parentThreadId),
  });
  if (!parent || parent.organizationId !== args.organizationId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "That thread is not one of this team's.",
    });
  }

  const open = await db.query.delegations.findFirst({
    where: and(
      eq(delegations.parentThreadId, parent.id),
      eq(delegations.status, "open"),
    ),
  });
  if (open) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This thread is already waiting on an answer. Wait for it before asking again.",
    });
  }

  const target = await resolveAgent({
    organizationId: args.organizationId,
    handle: args.handle,
  });
  if (!target) {
    await rejectPersonHandle(args);
    const known = await listAgents(args);
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        known.length > 0
          ? `No agent called "${args.handle}". Run \`roster agents\` to see who you can ask.`
          : `No agent called "${args.handle}".`,
    });
  }

  const asking = await askingSession(parent.id);
  const asker = asking ? await agentById(asking.agentMemberId) : null;
  if (!asker) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This thread has no agent in it to ask on your behalf.",
    });
  }

  if (target.id === asker.id) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That is you — just do the work.",
    });
  }

  const depth = (await ancestorDepth(parent.id)) + 1;
  if (depth > MAX_DEPTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Requests can only be passed along ${MAX_DEPTH} times. Answer with what you have.`,
    });
  }

  const chain = await ancestorAgents(parent.id);
  if (chain.includes(target.id)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "That agent is already waiting further up this chain — asking it back would deadlock.",
    });
  }

  const task = args.task.trim();
  if (task.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Say what you want done.",
    });
  }

  const sameWorktree = target.folderId === asker.folderId;

  await postRequest({
    organizationId: args.organizationId,
    channelId: parent.projectId,
    askerId: asker.id,
    askerHandle: asker.handle,
    targetHandle: target.handle,
    task,
    threadId: parent.id,
    parentMessageId: parent.rootMessageId,
    dedupeKey: `delegation-request:${parent.id}:${createHash("sha256")
      .update(`${target.id}:${task}`)
      .digest("base64url")
      .slice(0, 22)}`,
  });

  const [row] = await db
    .insert(delegations)
    .values({
      organizationId: args.organizationId,
      parentThreadId: parent.id,
      originMemberId: asker.id,
      targetMemberId: target.id,
      childThreadId: null,
      task,
      depth,
    })
    .returning();

  if (!row) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This thread is already waiting on an answer.",
    });
  }

  await notifyDelegationReceived({
    childThreadId: parent.id,
    originChannelId: parent.projectId,
    delegationId: row.id,
    task,
  });

  await markWaiting({ threadId: parent.id, waitingOn: target.handle });

  const delegation = {
    askedBy: asker.handle,
    originChannelId: parent.projectId,
  };

  const joined = await joinThread({
    threadId: parent.id,
    agentMemberId: target.id,
    projectId: parent.projectId,
    text: task,
    delegation,
  });

  if (!joined) {
    await db
      .update(delegations)
      .set({ status: "failed", answeredAt: new Date() })
      .where(eq(delegations.id, row.id));

    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "That agent has no folder to work in.",
    });
  }

  return {
    id: row.id,
    targetHandle: target.handle,
    childThreadId: null,
    sameWorktree,
    depth,
  };
}

async function postRequest(args: {
  organizationId: string;
  channelId: string;
  askerId: string;
  askerHandle: string;
  targetHandle: string;
  task: string;
  threadId: string | null;
  parentMessageId: string | null;
  dedupeKey: string;
}): Promise<string> {
  const text = `@${args.askerHandle} asked @${args.targetHandle}: ${args.task}`;
  const seq = await allocateSeq(args.channelId);

  const [row] = await db
    .insert(messages)
    .values({
      organizationId: args.organizationId,
      projectId: args.channelId,
      seq,
      authorMemberId: args.askerId,
      kind: DELEGATION_KIND,
      agentChannelId: args.channelId,
      body: textToTiptap(text),
      text,
      threadId: args.threadId,
      parentMessageId: args.parentMessageId,
      clientId: args.dedupeKey,
    })
    .onConflictDoNothing({ target: [messages.projectId, messages.clientId] })
    .returning();

  if (row) return row.id;

  const [existing] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.projectId, args.channelId),
        eq(messages.clientId, args.dedupeKey),
      ),
    )
    .limit(1);

  if (!existing) throw new Error("Could not post the request.");

  return existing.id;
}

async function ancestorDepth(threadId: string): Promise<number> {
  let depth = 0;
  let current: string | null = threadId;

  for (let hop = 0; hop < MAX_DEPTH + 1 && current; hop += 1) {
    const row: SelectDelegation | undefined =
      await db.query.delegations.findFirst({
        where: eq(delegations.childThreadId, current),
      });
    if (!row) break;
    depth = Math.max(depth, row.depth);
    current = row.parentThreadId;
  }

  return depth;
}

async function ancestorAgents(threadId: string): Promise<string[]> {
  const chain: string[] = [];
  let current: string | null = threadId;

  for (let hop = 0; hop < MAX_DEPTH + 1 && current; hop += 1) {
    const row: SelectDelegation | undefined =
      await db.query.delegations.findFirst({
        where: eq(delegations.childThreadId, current),
      });
    if (!row) break;
    chain.push(row.originMemberId, row.targetMemberId);
    current = row.parentThreadId;
  }

  return chain;
}

export async function settleDelegationFor(args: {
  threadId: string;
  agentMemberId?: string;
  reply: string;
  failed?: boolean;
}): Promise<void> {
  const pending = await openDelegationFor(args);
  if (!pending) return;

  const [row] = await db
    .update(delegations)
    .set({
      status: args.failed ? "failed" : "answered",
      answeredAt: new Date(),
    })
    .where(
      and(eq(delegations.id, pending.id), eq(delegations.status, "open")),
    )
    .returning();
  if (!row) return;

  const answering = await agentById(row.targetMemberId);
  const handle = answering?.handle ?? "the other agent";

  const reply = args.reply.trim();
  const spoken = args.failed
    ? `I asked @${handle} but that session ended without an answer.`
    : reply;

  const parent = await db.query.threads.findFirst({
    where: eq(threads.id, row.parentThreadId),
  });
  if (!parent) return;

  const asker = await agentById(row.originMemberId);

  const text = spoken.length > 0 ? spoken : `@${handle} finished without a reply.`;

  if (!(await alreadySaid({ threadId: parent.id, memberId: row.targetMemberId, text }))) {
    await writeReplyIntoParent({
      delegationId: row.id,
      thread: parent,
      text,
      authorMemberId: row.targetMemberId,
      agentChannelId: parent.projectId,
    });
  }

  await steer({
    threadId: row.parentThreadId,
    agentMemberId: asker?.id,
    text: args.failed
      ? `@${handle} could not complete that. Decide what to do next.`
      : `@${handle} replied:\n\n${reply}`,
  });
}

async function openDelegationFor(args: {
  threadId: string;
  agentMemberId?: string;
}): Promise<SelectDelegation | null> {
  const asChild = await db.query.delegations.findFirst({
    where: and(
      eq(delegations.childThreadId, args.threadId),
      eq(delegations.status, "open"),
    ),
  });
  if (asChild) return asChild;

  if (!args.agentMemberId) return null;

  const inThread = await db.query.delegations.findFirst({
    where: and(
      eq(delegations.parentThreadId, args.threadId),
      eq(delegations.targetMemberId, args.agentMemberId),
      eq(delegations.status, "open"),
    ),
  });

  return inThread ?? null;
}

async function alreadySaid(args: {
  threadId: string;
  memberId: string;
  text: string;
}): Promise<boolean> {
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.threadId, args.threadId),
        eq(messages.authorMemberId, args.memberId),
        eq(messages.text, args.text),
      ),
    )
    .limit(1);

  return row !== undefined;
}

async function writeReplyIntoParent(args: {
  delegationId: string;
  thread: {
    id: string;
    organizationId: string;
    projectId: string;
    rootMessageId: string;
  };
  text: string;
  authorMemberId: string;
  agentChannelId: string;
}): Promise<void> {
  const seq = await allocateSeq(args.thread.projectId);

  const [row] = await db
    .insert(messages)
    .values({
      organizationId: args.thread.organizationId,
      projectId: args.thread.projectId,
      seq,
      authorMemberId: args.authorMemberId,
      kind: "agent",
      agentChannelId: args.agentChannelId,
      body: markdownToTiptap(args.text),
      text: args.text,
      threadId: args.thread.id,
      parentMessageId: args.thread.rootMessageId,
      clientId: `delegation-reply:${args.delegationId}`,
    })
    .onConflictDoNothing({ target: [messages.projectId, messages.clientId] })
    .returning();

  if (!row) return;

  await emitMessageById(row.id, "agent_replied");
}

export async function delegationForChild(
  childThreadId: string,
): Promise<SelectDelegation | null> {
  const row = await db.query.delegations.findFirst({
    where: eq(delegations.childThreadId, childThreadId),
  });
  return row ?? null;
}

export type { Agent };
