import { describe, expect, it } from "vitest";

import "../test/mock-superset";
import { type Fixture, hasDatabase, makeFixture } from "./../test/fixtures";

function scopeOf(fixture: Fixture) {
  return {
    organizationId: fixture.orgId,
    memberId: fixture.memberId,
    role: "owner",
  };
}

async function agentReply(fixture: Fixture, threadId: string): Promise<void> {
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
    authorMemberId: null,
    agentChannelId: fixture.projectId,
    kind: "agent",
    body: { type: "doc", content: [] },
    text: "done, take a look",
    threadId,
  });
}

describe.skipIf(!hasDatabase())("channel unread", () => {
  it("bolds a channel when an agent posts, and clears when seen", async () => {
    const fixture = await makeFixture("chanreadflow");
    const { listUnseenChannels, markChannelSeen } = await import(
      "./channel-reads"
    );
    const scope = scopeOf(fixture);

    const made = await fixture.thread();
    expect(await listUnseenChannels(scope)).not.toContain(fixture.projectId);

    await agentReply(fixture, made.threadId);
    expect(await listUnseenChannels(scope)).toContain(fixture.projectId);

    await markChannelSeen({
      memberId: fixture.memberId,
      projectId: fixture.projectId,
    });
    expect(await listUnseenChannels(scope)).not.toContain(fixture.projectId);

    await agentReply(fixture, made.threadId);
    expect(await listUnseenChannels(scope)).toContain(fixture.projectId);

    await fixture.cleanup();
  });

  it("never bolds a channel for the member's own messages", async () => {
    const fixture = await makeFixture("chanreadown");
    const { listUnseenChannels, markChannelSeen } = await import(
      "./channel-reads"
    );
    const scope = scopeOf(fixture);

    await markChannelSeen({
      memberId: fixture.memberId,
      projectId: fixture.projectId,
    });
    await fixture.thread({ text: "my own root message" });

    expect(await listUnseenChannels(scope)).not.toContain(fixture.projectId);

    await fixture.cleanup();
  });

  it("ignores messages in threads the member has muted", async () => {
    const fixture = await makeFixture("chanreadmute");
    const { listUnseenChannels, markChannelSeen } = await import(
      "./channel-reads"
    );
    const { db, threadSubscriptions } = await import("@roster/db");
    const scope = scopeOf(fixture);

    await markChannelSeen({
      memberId: fixture.memberId,
      projectId: fixture.projectId,
    });
    const made = await fixture.thread();
    await db.insert(threadSubscriptions).values({
      threadId: made.threadId,
      memberId: fixture.memberId,
      reason: "author",
      mutedAt: new Date(),
    });

    await agentReply(fixture, made.threadId);
    expect(await listUnseenChannels(scope)).not.toContain(fixture.projectId);

    await fixture.cleanup();
  });
});
