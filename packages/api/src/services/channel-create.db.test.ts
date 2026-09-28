import { beforeAll, describe, expect, it, vi } from "vitest";

import { hasDatabase, makeFixture } from "../test/fixtures";
import "../test/mock-superset";

describe.skipIf(!hasDatabase())("creating a channel from the sidebar", () => {
  let superset: typeof import("@roster/superset");
  let channelCreate: typeof import("./channel-create");
  let dbmod: typeof import("@roster/db");
  let drizzle: typeof import("drizzle-orm");

  beforeAll(async () => {
    superset = await import("@roster/superset");
    channelCreate = await import("./channel-create");
    dbmod = await import("@roster/db");
    drizzle = await import("drizzle-orm");
  });

  it("makes a private channel with its own workspace on the source repo", async () => {
    const fixture = await makeFixture("plusbtn");
    vi.mocked(superset.createWorkspaceEnqueued).mockClear();

    const channel = await channelCreate.createChannel({
      organizationId: fixture.orgId,
      memberId: fixture.memberId,
      role: "owner",
      name: "Growth Experiments",
      sourceChannelId: fixture.projectId,
    });

    expect(channel.visibility).toBe("private");
    expect(channel.slug).toBe("growth-experiments");
    expect(channel.supersetWorkspaceId).toBeTruthy();

    const source = await dbmod.db.query.projects.findFirst({
      where: drizzle.eq(dbmod.projects.id, fixture.projectId),
    });
    expect(channel.supersetProjectId).toBe(source!.supersetProjectId);
    expect(channel.supersetHostId).toBe(source!.supersetHostId);

    const enqueue = vi.mocked(superset.createWorkspaceEnqueued).mock
      .calls[0]?.[0];
    expect(enqueue?.projectId).toBe(source!.supersetProjectId);
    expect(enqueue?.name).toBe("growth-experiments");
    expect(enqueue?.workspaceId).toBe(channel.supersetWorkspaceId);

    const agent = await dbmod.db.query.members.findFirst({
      where: drizzle.eq(dbmod.members.projectId, channel.id),
    });
    expect(agent?.agentName).toBe("growth-experiments");

    const again = await channelCreate.createChannel({
      organizationId: fixture.orgId,
      memberId: fixture.memberId,
      role: "owner",
      name: "Growth Experiments",
      sourceChannelId: fixture.projectId,
    });
    expect(again.slug).toBe("growth-experiments-2");

    await fixture.cleanup();
  });

  it("removes the channel again when the machine cannot be reached", async () => {
    const fixture = await makeFixture("plusfail");
    vi.mocked(superset.createWorkspaceEnqueued).mockRejectedValueOnce(
      new superset.SupersetError("That machine did not answer."),
    );

    await expect(
      channelCreate.createChannel({
        organizationId: fixture.orgId,
        memberId: fixture.memberId,
        role: "owner",
        name: "Doomed",
        sourceChannelId: fixture.projectId,
      }),
    ).rejects.toThrow("did not answer");

    const leftover = await dbmod.db.query.projects.findFirst({
      where: drizzle.and(
        drizzle.eq(dbmod.projects.organizationId, fixture.orgId),
        drizzle.eq(dbmod.projects.slug, "doomed"),
      ),
    });
    expect(leftover).toBeUndefined();

    await fixture.cleanup();
  });
});
