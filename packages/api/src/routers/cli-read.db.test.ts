import { beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("reading a channel and a thread from the CLI", () => {
  let caller: {
    readMessages: (input: {
      channelId: string;
      limit?: number;
    }) => Promise<ReadMessagesResult>;
    readThread: (input: {
      threadId: string;
      limit?: number;
    }) => Promise<ReadThreadResult>;
  };
  let replyCountsByThread: (
    ids: string[],
  ) => Promise<Map<string, number>>;
  let cleanup: () => Promise<void>;

  interface ReadMessagesResult {
    messages: Array<{
      text: string;
      author: string;
      thread: { id: string; replyCount: number } | null;
    }>;
  }

  interface ReadThreadResult {
    thread: { id: string; status: string; replyCount: number };
    messages: Array<{ text: string; author: string }>;
  }

  const ids = {
    org: "",
    user: "",
    member: "",
    project: "",
    stranger: "",
    strangerUser: "",
    strangerProject: "",
    asked: "",
    askedThread: "",
    talked: "",
    talkedThread: "",
    hidden: "",
    hiddenThread: "",
  };

  beforeAll(async () => {
    const { randomUUID } = await import("node:crypto");
    const {
      apiKeys,
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
    const { mintApiKey } = await import("../services/api-keys");
    const messagesService = await import("../services/messages");
    const { createCallerFactory } = await import("../trpc");
    const { cliRouter } = await import("./cli");

    replyCountsByThread = messagesService.replyCountsByThread;

    Object.assign(ids, {
      org: randomUUID(),
      user: randomUUID(),
      member: randomUUID(),
      project: randomUUID(),
      stranger: randomUUID(),
      strangerUser: randomUUID(),
      strangerProject: randomUUID(),
      asked: randomUUID(),
      talked: randomUUID(),
      hidden: randomUUID(),
    });

    const person = async (id: string, name: string) => {
      await db.insert(users).values({
        id,
        name,
        email: `${id}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    };

    await person(ids.user, "Reader");
    await person(ids.strangerUser, "Stranger");

    await db.insert(organizations).values({
      id: ids.org,
      name: "Reading",
      slug: `reading-${ids.org.slice(0, 8)}`,
      createdAt: new Date(),
    });

    await db.insert(members).values([
      {
        id: ids.member,
        organizationId: ids.org,
        userId: ids.user,
        role: "member",
        createdAt: new Date(),
      },
      {
        id: ids.stranger,
        organizationId: ids.org,
        userId: ids.strangerUser,
        role: "member",
        createdAt: new Date(),
      },
    ]);

    const channel = async (
      id: string,
      slug: string,
      owner: string,
      visibility: string,
    ) => {
      const folderId = randomUUID();
      await db.insert(folders).values({
        id: folderId,
        organizationId: ids.org,
        supersetProjectId: `superset-${slug}`,
        supersetHostId: "host-1",
        supersetOrgId: ids.org,
        name: slug,
        ownerMemberId: owner,
      });
      const [agent] = await db
        .insert(members)
        .values({
          organizationId: ids.org,
          userId: null,
          role: "member",
          type: "agent",
          agentName: slug,
          folderId,
          createdAt: new Date(),
        })
        .returning({ id: members.id });
      await db.insert(projects).values({
        id,
        organizationId: ids.org,
        name: slug,
        slug,
        visibility,
        defaultAgentId: agent!.id,
        addedByMemberId: owner,
      });
    };

    await channel(ids.project, "reading", ids.member, "public");
    await channel(ids.strangerProject, "locked", ids.stranger, "private");

    let seq = 0;
    const message = async (args: {
      id: string;
      projectId?: string;
      text: string;
      kind?: string;
      parentMessageId?: string;
      threadId?: string;
      deleted?: boolean;
    }) => {
      seq += 1;
      await db.insert(messages).values({
        id: args.id,
        organizationId: ids.org,
        projectId: args.projectId ?? ids.project,
        seq,
        authorMemberId: args.kind === "agent" ? null : ids.member,
        kind: args.kind ?? "user",
        body: { type: "doc", content: [] },
        text: args.text,
        parentMessageId: args.parentMessageId ?? null,
        threadId: args.threadId ?? null,
        deletedAt: args.deleted ? new Date() : null,
      });
    };

    const thread = async (rootMessageId: string, projectId = ids.project) => {
      const [row] = await db
        .insert(threads)
        .values({
          organizationId: ids.org,
          projectId,
          rootMessageId,
        })
        .returning();
      if (!row) throw new Error("thread not created");

      await db
        .update(messages)
        .set({ threadId: row.id })
        .where(eq(messages.id, rootMessageId));

      return row.id;
    };

    await message({ id: ids.talked, text: "does the cli read threads?" });
    ids.talkedThread = await thread(ids.talked);

    await message({
      id: randomUUID(),
      text: "not yet",
      kind: "agent",
      parentMessageId: ids.talked,
      threadId: ids.talkedThread,
    });
    await message({
      id: randomUUID(),
      text: "it does now",
      kind: "agent",
      parentMessageId: ids.talked,
      threadId: ids.talkedThread,
    });
    await message({
      id: randomUUID(),
      text: "retracted",
      kind: "agent",
      parentMessageId: ids.talked,
      threadId: ids.talkedThread,
      deleted: true,
    });

    await message({ id: randomUUID(), text: "shipping the mac app today" });

    await message({
      id: ids.asked,
      text: "@reading please cut release 0.1.4",
      kind: "delegation",
    });
    ids.askedThread = await thread(ids.asked);
    await message({
      id: randomUUID(),
      text: "cut, tagged, pushed",
      kind: "agent",
      parentMessageId: ids.asked,
      threadId: ids.askedThread,
    });

    await message({
      id: ids.hidden,
      projectId: ids.strangerProject,
      text: "not for you",
    });
    ids.hiddenThread = await thread(ids.hidden, ids.strangerProject);

    const key = await mintApiKey({
      organizationId: ids.org,
      memberId: ids.member,
      name: "verification",
    });

    caller = createCallerFactory(cliRouter)({
      headers: new Headers({ authorization: `Bearer ${key.key}` }),
      session: null,
      user: null,
    }) as typeof caller;

    cleanup = async () => {
      await db.delete(apiKeys).where(eq(apiKeys.organizationId, ids.org));
      await db.delete(threads).where(eq(threads.organizationId, ids.org));
      await db.delete(messages).where(eq(messages.organizationId, ids.org));
      await db.delete(projects).where(eq(projects.organizationId, ids.org));
      await db
        .update(members)
        .set({ folderId: null })
        .where(eq(members.organizationId, ids.org));
      await db.delete(folders).where(eq(folders.organizationId, ids.org));
      await db.delete(members).where(eq(members.organizationId, ids.org));
      await db.delete(organizations).where(eq(organizations.id, ids.org));
      await db.delete(users).where(eq(users.id, ids.user));
      await db.delete(users).where(eq(users.id, ids.strangerUser));
    };
  });

  it("counts the replies under a thread, and neither the root nor a deleted one", async () => {
    const counts = await replyCountsByThread([ids.talkedThread]);
    expect(counts.get(ids.talkedThread)).toBe(2);
  });

  it("marks a message that has a thread, and leaves the rest unmarked", async () => {
    const page = await caller.readMessages({ channelId: ids.project });

    const talked = page.messages.find(
      (message) => message.text === "does the cli read threads?",
    );
    expect(talked?.thread).toEqual({ id: ids.talkedThread, replyCount: 2 });

    const plain = page.messages.find(
      (message) => message.text === "shipping the mac app today",
    );
    expect(plain?.thread).toBeNull();
  });

  it("still keeps a handover out of the channel it was sent to", async () => {
    const page = await caller.readMessages({ channelId: ids.project });
    expect(page.messages.map((message) => message.text)).not.toContain(
      "@reading please cut release 0.1.4",
    );
  });

  it("reads a thread root first, then its replies", async () => {
    const page = await caller.readThread({ threadId: ids.talkedThread });

    expect(page.messages.map((message) => message.text)).toEqual([
      "does the cli read threads?",
      "not yet",
      "it does now",
    ]);
    expect(page.thread.replyCount).toBe(2);
  });

  it("opens a delegated thread with the request that started it", async () => {
    const page = await caller.readThread({ threadId: ids.askedThread });

    expect(page.messages.map((message) => message.text)).toEqual([
      "@reading please cut release 0.1.4",
      "cut, tagged, pushed",
    ]);
  });

  it("returns the tail when a thread is longer than the limit", async () => {
    const page = await caller.readThread({
      threadId: ids.talkedThread,
      limit: 1,
    });

    expect(page.messages.map((message) => message.text)).toEqual([
      "it does now",
    ]);
  });

  it("refuses a thread in a channel this key cannot see", async () => {
    await expect(
      caller.readThread({ threadId: ids.hiddenThread }),
    ).rejects.toThrow(/cannot read that thread/);
  });

  it("refuses a thread id that belongs to nothing", async () => {
    const { randomUUID } = await import("node:crypto");
    await expect(
      caller.readThread({ threadId: randomUUID() }),
    ).rejects.toThrow(/cannot read that thread/);
  });

  it("cleans up after itself", async () => {
    await cleanup();
  });
});
