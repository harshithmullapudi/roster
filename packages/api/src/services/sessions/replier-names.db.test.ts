import { describe, expect, it } from "vitest";

import "../../test/mock-superset";
import { type Fixture, hasDatabase, makeFixture } from "../../test/fixtures";

async function reply(
  fixture: Fixture,
  thread: { threadId: string; rootMessageId: string },
  args: {
    authorMemberId: string;
    kind: "user" | "agent";
    agentChannelId?: string;
    text: string;
  },
) {
  const { db, messages, projects } = await import("@roster/db");
  const { eq, sql } = await import("drizzle-orm");

  const [row] = await db
    .update(projects)
    .set({ lastSeq: sql`${projects.lastSeq} + 1` })
    .where(eq(projects.id, fixture.projectId))
    .returning({ lastSeq: projects.lastSeq });

  await db.insert(messages).values({
    organizationId: fixture.orgId,
    projectId: fixture.projectId,
    seq: row!.lastSeq,
    authorMemberId: args.authorMemberId,
    kind: args.kind,
    agentChannelId: args.agentChannelId ?? null,
    body: { type: "doc", content: [] },
    text: args.text,
    threadId: thread.threadId,
    parentMessageId: thread.rootMessageId,
  });
}

describe.skipIf(!hasDatabase())("replier names on a channel thread", () => {
  it("names repliers exactly as the thread panel does", async () => {
    const fixture = await makeFixture("replier");
    const made = await fixture.thread();
    const scoutId = await fixture.agent(fixture.projectId, "scout");

    await reply(fixture, made, {
      authorMemberId: scoutId,
      kind: "agent",
      agentChannelId: fixture.projectId,
      text: "on it",
    });
    await reply(fixture, made, {
      authorMemberId: fixture.memberId,
      kind: "user",
      text: "thanks",
    });

    const { listChannelThreads } = await import("./queries");
    const rows = await listChannelThreads({
      projectId: fixture.projectId,
      memberId: fixture.memberId,
    });
    const row = rows.find((thread) => thread.id === made.threadId);

    expect(row?.replierNames).toEqual(["replier", "scout"]);

    await fixture.cleanup();
  });
});
