import { describe, expect, it } from "vitest";

import "../test/mock-superset";
import { hasDatabase, makeFixture } from "../test/fixtures";

async function agentReplies(threadId: string): Promise<number> {
  const { db, messages } = await import("@roster/db");
  const { and, eq } = await import("drizzle-orm");
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.threadId, threadId), eq(messages.kind, "agent")));
  return rows.length;
}

async function statusOf(delegationId: string): Promise<string | undefined> {
  const { db, delegations } = await import("@roster/db");
  const { eq } = await import("drizzle-orm");
  const [row] = await db
    .select({ status: delegations.status })
    .from(delegations)
    .where(eq(delegations.id, delegationId));
  return row?.status;
}

async function openDelegation(args: {
  orgId: string;
  parentThreadId: string;
  originMemberId: string;
  targetMemberId: string;
  childThreadId: string;
}): Promise<string> {
  const { db, delegations } = await import("@roster/db");
  const [row] = await db
    .insert(delegations)
    .values({
      organizationId: args.orgId,
      parentThreadId: args.parentThreadId,
      originMemberId: args.originMemberId,
      targetMemberId: args.targetMemberId,
      childThreadId: args.childThreadId,
      task: "look at the logs",
      status: "open",
    })
    .returning({ id: delegations.id });
  return row!.id;
}

describe.skipIf(!hasDatabase())("settling a delegation", () => {
  it("writes one reply when two settles race", async () => {
    const fixture = await makeFixture("settlerace");
    const parent = await fixture.thread();
    const child = await fixture.thread();
    const targetChannelId = await fixture.channel("target");

    const delegationId = await openDelegation({
      orgId: fixture.orgId,
      parentThreadId: parent.threadId,
      originMemberId: fixture.agentFor(),
      targetMemberId: fixture.agentFor(targetChannelId),
      childThreadId: child.threadId,
    });

    const { settleDelegationFor } = await import("./delegations");
    await Promise.all([
      settleDelegationFor({ threadId: child.threadId, reply: "found it" }),
      settleDelegationFor({ threadId: child.threadId, reply: "found it" }),
    ]);

    expect(await statusOf(delegationId)).toBe("answered");
    expect(await agentReplies(parent.threadId)).toBe(1);

    await fixture.cleanup();
  });

  it("posts one request message when the same ask is made twice at once", async () => {
    const fixture = await makeFixture("asktwice");
    const parent = await fixture.thread();
    await fixture.channel("target");

    const { delegate } = await import("./delegations");
    const ask = () =>
      delegate({
        organizationId: fixture.orgId,
        memberId: fixture.memberId,
        role: "owner",
        parentThreadId: parent.threadId,
        handle: "target",
        task: "look at the logs",
      });

    const results = await Promise.allSettled([ask(), ask()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const { db, delegations, messages } = await import("@roster/db");
    const { and, eq } = await import("drizzle-orm");

    const posted = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.projectId, fixture.projectId),
          eq(messages.kind, "delegation"),
        ),
      );
    expect(posted).toHaveLength(1);

    const rows = await db
      .select({ id: delegations.id })
      .from(delegations)
      .where(eq(delegations.parentThreadId, parent.threadId));
    expect(rows).toHaveLength(1);

    await fixture.cleanup();
  });

  it("still settles when the child was canceled first", async () => {
    const fixture = await makeFixture("settlecanceled");
    const parent = await fixture.thread();
    const child = await fixture.thread();
    const targetChannelId = await fixture.channel("target");

    const delegationId = await openDelegation({
      orgId: fixture.orgId,
      parentThreadId: parent.threadId,
      originMemberId: fixture.agentFor(),
      targetMemberId: fixture.agentFor(targetChannelId),
      childThreadId: child.threadId,
    });

    const { db, threadSessions } = await import("@roster/db");
    const { eq } = await import("drizzle-orm");
    await db
      .update(threadSessions)
      .set({ status: "canceled" })
      .where(eq(threadSessions.threadId, child.threadId));

    const { settleDelegationFor } = await import("./delegations");
    await settleDelegationFor({
      threadId: child.threadId,
      reply: "",
      failed: true,
    });

    expect(await statusOf(delegationId)).toBe("failed");

    await fixture.cleanup();
  });
});
