import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ThreadDetail } from "./queries";

const hasDatabase = Boolean(process.env.DATABASE_URL);

const REPLIES = 120;

describe.skipIf(!hasDatabase)("paging back through a long thread", () => {
  let threadDetail: typeof import("./queries").threadDetail;
  let cleanup: () => Promise<void>;

  const ids = {
    org: "",
    user: "",
    member: "",
    project: "",
    thread: "",
    root: "",
  };

  beforeAll(async () => {
    const { randomUUID } = await import("node:crypto");
    const {
      db,
      folders,
      members,
      messages,
      organizations,
      projects,
      threads,
      users,
    } = await import("@roster/db");
    const { eq } = await import("drizzle-orm");
    ({ threadDetail } = await import("./queries"));

    ids.org = randomUUID();
    ids.user = randomUUID();
    ids.member = randomUUID();
    ids.project = randomUUID();
    ids.thread = randomUUID();
    ids.root = randomUUID();

    await db.insert(users).values({
      id: ids.user,
      name: "Paging",
      email: `${ids.user}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(organizations).values({
      id: ids.org,
      name: "Paging",
      slug: `paging-${ids.org.slice(0, 8)}`,
      createdAt: new Date(),
    });
    await db.insert(members).values({
      id: ids.member,
      organizationId: ids.org,
      userId: ids.user,
      role: "owner",
      createdAt: new Date(),
    });
    const folderId = randomUUID();
    await db.insert(folders).values({
      id: folderId,
      organizationId: ids.org,
      supersetProjectId: "superset-project",
      supersetHostId: "host-1",
      supersetOrgId: ids.org,
      name: "paging",
      ownerMemberId: ids.member,
    });
    const [agent] = await db
      .insert(members)
      .values({
        organizationId: ids.org,
        userId: null,
        role: "member",
        type: "agent",
        agentName: "paging",
        folderId,
        createdAt: new Date(),
      })
      .returning({ id: members.id });
    await db.insert(projects).values({
      id: ids.project,
      organizationId: ids.org,
      name: "paging",
      slug: "paging",
      defaultAgentId: agent!.id,
      addedByMemberId: ids.member,
    });

    const body = (text: string) => ({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });

    await db.insert(messages).values({
      id: ids.root,
      organizationId: ids.org,
      projectId: ids.project,
      seq: 1,
      authorMemberId: ids.member,
      kind: "user",
      body: body("root"),
      text: "root",
      threadId: ids.thread,
    });
    await db.insert(threads).values({
      id: ids.thread,
      organizationId: ids.org,
      projectId: ids.project,
      rootMessageId: ids.root,
    });
    await db.insert(messages).values(
      Array.from({ length: REPLIES }, (_, index) => ({
        organizationId: ids.org,
        projectId: ids.project,
        seq: index + 2,
        authorMemberId: ids.member,
        kind: "user" as const,
        body: body(`reply ${index + 1}`),
        text: `reply ${index + 1}`,
        threadId: ids.thread,
        parentMessageId: ids.root,
      })),
    );

    cleanup = async () => {
      await db.delete(messages).where(eq(messages.organizationId, ids.org));
      await db.delete(threads).where(eq(threads.id, ids.thread));
      await db.delete(projects).where(eq(projects.id, ids.project));
      await db
        .update(members)
        .set({ folderId: null })
        .where(eq(members.organizationId, ids.org));
      await db.delete(folders).where(eq(folders.organizationId, ids.org));
      await db.delete(members).where(eq(members.organizationId, ids.org));
      await db.delete(organizations).where(eq(organizations.id, ids.org));
      await db.delete(users).where(eq(users.id, ids.user));
    };
  });

  afterAll(async () => {
    await cleanup?.();
  });

  function texts(detail: ThreadDetail | null) {
    return (detail?.messages ?? []).map((message) => message.text);
  }

  it("opens on the newest replies rather than the whole history", async () => {
    const detail = await threadDetail({
      projectId: ids.project,
      threadId: ids.thread,
      limit: 50,
    });

    const all = texts(detail);
    expect(all).toHaveLength(51);
    expect(all[0]).toBe("root");
    expect(all[1]).toBe(`reply ${REPLIES - 49}`);
    expect(all.at(-1)).toBe(`reply ${REPLIES}`);
  });

  it("returns the page before a cursor, oldest first, without the root", async () => {
    const first = await threadDetail({
      projectId: ids.project,
      threadId: ids.thread,
      limit: 50,
    });
    const oldest = first?.messages[1];
    expect(oldest).toBeDefined();

    const older = await threadDetail({
      projectId: ids.project,
      threadId: ids.thread,
      before: oldest!.seq,
      limit: 25,
    });

    const page = texts(older);
    expect(page).toHaveLength(25);
    expect(page).not.toContain("root");
    expect(page[0]).toBe(`reply ${REPLIES - 74}`);
    expect(page.at(-1)).toBe(`reply ${REPLIES - 50}`);
  });

  it("runs dry at the start of the thread, which is how the client stops", async () => {
    const page = await threadDetail({
      projectId: ids.project,
      threadId: ids.thread,
      before: 4,
      limit: 25,
    });

    expect(texts(page)).toEqual(["reply 1", "reply 2"]);
  });
});
