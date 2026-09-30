import { describe, expect, it } from "vitest";

import "../test/mock-superset";
import { hasDatabase, makeFixture } from "../test/fixtures";

async function say(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  projectId: string,
  text: string,
): Promise<string> {
  const { db, messages, projects } = await import("@roster/db");
  const { eq, sql } = await import("drizzle-orm");

  const [bumped] = await db
    .update(projects)
    .set({ lastSeq: sql`${projects.lastSeq} + 1` })
    .where(eq(projects.id, projectId))
    .returning({ lastSeq: projects.lastSeq });

  const [row] = await db
    .insert(messages)
    .values({
      organizationId: fixture.orgId,
      projectId,
      seq: bumped!.lastSeq,
      authorMemberId: fixture.memberId,
      kind: "user",
      body: { type: "doc", content: [] },
      text,
    })
    .returning({ id: messages.id });

  return row!.id;
}

async function addTask(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  projectId: string | null,
  title: string,
): Promise<string> {
  const { db, tasks } = await import("@roster/db");
  const [row] = await db
    .insert(tasks)
    .values({
      organizationId: fixture.orgId,
      projectId,
      title,
      createdByMemberId: fixture.memberId,
    })
    .returning({ id: tasks.id });
  return row!.id;
}

function scope(fixture: Awaited<ReturnType<typeof makeFixture>>) {
  return {
    organizationId: fixture.orgId,
    memberId: fixture.memberId,
    role: "owner",
  };
}

describe.skipIf(!hasDatabase())("search", () => {
  it("finds a message from the word being typed", async () => {
    const fixture = await makeFixture("searchprefix");
    const { search } = await import("./search");

    const wanted = await say(
      fixture,
      fixture.projectId,
      "we moved the deployment to Tuesday",
    );
    await say(fixture, fixture.projectId, "lunch is at noon");

    const found = await search({ ...scope(fixture), query: "deplo" });

    expect(found.messages.map((hit) => hit.id)).toEqual([wanted]);

    await fixture.cleanup();
  });

  it("marks the hit with sentinels and never with markup", async () => {
    const fixture = await makeFixture("searchmark");
    const { search } = await import("./search");

    await say(
      fixture,
      fixture.projectId,
      "the <script>alert(1)</script> deployment ran on Tuesday",
    );

    const found = await search({ ...scope(fixture), query: "deployment" });
    const [hit] = found.messages;

    expect(hit?.snippet).toContainEqual({ text: "deployment", hit: true });
    expect(hit?.snippet.map((segment) => segment.text).join("")).not.toContain(
      "<",
    );

    await fixture.cleanup();
  });

  it("keeps words either side of the hit", async () => {
    const fixture = await makeFixture("searchcontext");
    const { search } = await import("./search");

    await say(
      fixture,
      fixture.projectId,
      "we agreed the deployment waits until the release notes are written",
    );

    const found = await search({ ...scope(fixture), query: "deplo" });

    const snippet = found.messages[0]?.snippet ?? [];
    expect(snippet.map((segment) => segment.text).join("")).toContain(
      "release notes",
    );
    expect(snippet).toContainEqual({ text: "deployment", hit: true });

    await fixture.cleanup();
  });

  it("requires every term", async () => {
    const fixture = await makeFixture("searchand");
    const { search } = await import("./search");

    await say(fixture, fixture.projectId, "staging deployment is green");
    await say(fixture, fixture.projectId, "production is red");

    const found = await search({
      ...scope(fixture),
      query: "production deployment",
    });

    expect(found.messages).toHaveLength(0);

    await fixture.cleanup();
  });

  it("keeps a channel search inside that channel", async () => {
    const fixture = await makeFixture("searchscope");
    const { search } = await import("./search");

    const other = await fixture.channel("searchscope-other");
    const here = await say(fixture, fixture.projectId, "deployment here");
    await say(fixture, other, "deployment over there");

    const scoped = await search({
      ...scope(fixture),
      query: "deployment",
      projectId: fixture.projectId,
    });
    expect(scoped.messages.map((hit) => hit.id)).toEqual([here]);

    const orgWide = await search({ ...scope(fixture), query: "deployment" });
    expect(orgWide.messages).toHaveLength(2);

    await fixture.cleanup();
  });

  it("leaves out a private channel somebody else owns", async () => {
    const fixture = await makeFixture("searchprivate");
    const { db, members, projects } = await import("@roster/db");
    const { eq } = await import("drizzle-orm");
    const { search } = await import("./search");

    const [stranger] = await db
      .insert(members)
      .values({
        organizationId: fixture.orgId,
        userId: null,
        role: "member",
        type: "agent",
        agentName: "searchprivate-stranger",
      })
      .returning({ id: members.id });

    const secret = await fixture.channel("searchprivate-secret");
    await db
      .update(projects)
      .set({ visibility: "private", addedByMemberId: stranger!.id })
      .where(eq(projects.id, secret));
    await say(fixture, secret, "deployment secrets");

    const mine = await say(fixture, fixture.projectId, "deployment notes");

    const found = await search({
      ...scope(fixture),
      role: "member",
      query: "deployment",
    });
    expect(found.messages.map((hit) => hit.id)).toEqual([mine]);

    await fixture.cleanup();
  });

  it("skips a deleted message", async () => {
    const fixture = await makeFixture("searchdeleted");
    const { db, messages } = await import("@roster/db");
    const { eq } = await import("drizzle-orm");
    const { search } = await import("./search");

    const id = await say(fixture, fixture.projectId, "deployment happened");
    await db
      .update(messages)
      .set({ deletedAt: new Date() })
      .where(eq(messages.id, id));

    const found = await search({ ...scope(fixture), query: "deployment" });
    expect(found.messages).toHaveLength(0);

    await fixture.cleanup();
  });

  it("carries the thread a message belongs to", async () => {
    const fixture = await makeFixture("searchthread");
    const { search } = await import("./search");

    const made = await fixture.thread({ text: "restart the deployment" });

    const found = await search({ ...scope(fixture), query: "deployment" });
    expect(found.messages[0]?.threadId).toBe(made.threadId);

    await fixture.cleanup();
  });

  it("finds tasks by title, backlog included", async () => {
    const fixture = await makeFixture("searchtasks");
    const { search } = await import("./search");

    const inChannel = await addTask(
      fixture,
      fixture.projectId,
      "Fix the deployment script",
    );
    const backlog = await addTask(fixture, null, "Deployment runbook");
    await addTask(fixture, fixture.projectId, "Buy milk");

    const found = await search({ ...scope(fixture), query: "deployment" });
    expect(found.tasks.map((hit) => hit.id).sort()).toEqual(
      [inChannel, backlog].sort(),
    );

    const scoped = await search({
      ...scope(fixture),
      query: "deployment",
      projectId: fixture.projectId,
    });
    expect(scoped.tasks.map((hit) => hit.id)).toEqual([inChannel]);

    const { db, tasks } = await import("@roster/db");
    const { eq } = await import("drizzle-orm");
    await db.delete(tasks).where(eq(tasks.organizationId, fixture.orgId));

    await fixture.cleanup();
  });

  it("returns nothing for a query with no searchable word", async () => {
    const fixture = await makeFixture("searchblank");
    const { search } = await import("./search");

    await say(fixture, fixture.projectId, "deployment");

    expect(await search({ ...scope(fixture), query: "   " })).toEqual({
      messages: [],
      tasks: [],
    });
    expect(await search({ ...scope(fixture), query: "-deployment" })).toEqual({
      messages: [],
      tasks: [],
    });

    await fixture.cleanup();
  });
});
