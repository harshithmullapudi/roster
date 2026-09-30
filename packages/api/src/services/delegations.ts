import { createHash } from "node:crypto";

import {
  db,
  delegations,
  members,
  messages,
  type SelectDelegation,
  threads,
  threadSessions,
} from "@roster/db";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull, ne } from "drizzle-orm";

import { normalizeHandle } from "../lib/agent-identity";
import { type Answer, answersFor } from "../lib/delegation-answers";
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
  /** The agent doing the asking, as its `<roster>` block names it. */
  asHandle?: string;
}

export interface DelegationResult {
  id: string;
  targetHandle: string;
  childThreadId: string | null;
  sameWorktree: boolean;
  depth: number;
  /** Every agent this thread is now waiting on, this one included. */
  pending: string[];
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

  const asker = await askerFor({
    organizationId: args.organizationId,
    parentThreadId: parent.id,
    asHandle: args.asHandle,
  });
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

  const alreadyAsked = await db.query.delegations.findFirst({
    where: and(
      eq(delegations.parentThreadId, parent.id),
      eq(delegations.targetMemberId, target.id),
      eq(delegations.status, "open"),
    ),
    columns: { id: true },
  });
  if (alreadyAsked) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `You have already asked @${target.handle} — wait for that answer before asking again.`,
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
      message: `You have already asked @${target.handle}.`,
    });
  }

  await notifyDelegationReceived({
    childThreadId: parent.id,
    originChannelId: parent.projectId,
    delegationId: row.id,
    task,
  });

  const pending = await openTargets(parent.id, asker.id);
  await markWaiting({ threadId: parent.id, waitingOn: pending });

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
    const now = new Date();
    await db
      .update(delegations)
      .set({ status: "failed", answeredAt: now, reportedAt: now })
      .where(eq(delegations.id, row.id));

    const left = await openTargets(parent.id, asker.id);
    if (left.length > 0) await markWaiting({ threadId: parent.id, waitingOn: left });

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
    pending,
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

  const reply = args.reply.trim();

  const [row] = await db
    .update(delegations)
    .set({
      status: args.failed ? "failed" : "answered",
      answeredAt: new Date(),
      reply,
    })
    .where(
      and(eq(delegations.id, pending.id), eq(delegations.status, "open")),
    )
    .returning();
  if (!row) return;

  const answering = await agentById(row.targetMemberId);
  const handle = answering?.handle ?? "the other agent";

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

  // An agent can be waiting on several others at once, and a thread can hold
  // more than one such wait — a delegate may have passed work on again. Each
  // asker is left parked until its own last answer is in, then resumed with
  // all of them together.
  const stillOpen = await openTargets(parent.id, row.originMemberId);
  if (stillOpen.length > 0) {
    await markWaiting({ threadId: parent.id, waitingOn: stillOpen });
    return;
  }

  const gathered = await takeUnreported(parent.id, row.originMemberId);
  if (gathered.length === 0) return;

  await steer({
    threadId: row.parentThreadId,
    agentMemberId: asker?.id,
    text: answersFor(gathered),
  });
}

/**
 * Several agents can be at work in one thread, so the liveliest session is no
 * longer a safe guess at who is asking — an agent says so with `--as`, which
 * its `<roster>` block hands it. The guess stays for anyone who leaves it out.
 */
async function askerFor(args: {
  organizationId: string;
  parentThreadId: string;
  asHandle?: string;
}): Promise<Agent | null> {
  if (args.asHandle) {
    const claimed = await resolveAgent({
      organizationId: args.organizationId,
      handle: args.asHandle,
    });

    if (claimed) {
      const inThread = await db.query.threadSessions.findFirst({
        where: and(
          eq(threadSessions.threadId, args.parentThreadId),
          eq(threadSessions.agentMemberId, claimed.id),
        ),
        columns: { id: true },
      });
      if (inThread) return claimed;
    }
  }

  const asking = await askingSession(args.parentThreadId);
  return asking ? agentById(asking.agentMemberId) : null;
}

async function openTargets(
  parentThreadId: string,
  askerId: string,
): Promise<string[]> {
  const rows = await db
    .select({ handle: members.agentName })
    .from(delegations)
    .innerJoin(members, eq(delegations.targetMemberId, members.id))
    .where(
      and(
        eq(delegations.parentThreadId, parentThreadId),
        eq(delegations.originMemberId, askerId),
        eq(delegations.status, "open"),
      ),
    )
    .orderBy(asc(delegations.createdAt));

  return rows.map((row) => normalizeHandle(row.handle));
}

/**
 * Answers go back to the asker once — whoever settles last carries them all.
 */
async function takeUnreported(
  parentThreadId: string,
  askerId: string,
): Promise<Answer[]> {
  const rows = await db
    .update(delegations)
    .set({ reportedAt: new Date() })
    .where(
      and(
        eq(delegations.parentThreadId, parentThreadId),
        eq(delegations.originMemberId, askerId),
        ne(delegations.status, "open"),
        isNull(delegations.reportedAt),
      ),
    )
    .returning({
      targetMemberId: delegations.targetMemberId,
      status: delegations.status,
      reply: delegations.reply,
      createdAt: delegations.createdAt,
    });

  const settled = rows.sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  return Promise.all(
    settled.map(async (answer) => ({
      handle:
        (await agentById(answer.targetMemberId))?.handle ?? "the other agent",
      reply: answer.reply ?? "",
      failed: answer.status !== "answered",
    })),
  );
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
