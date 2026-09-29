import { beforeAll, describe, expect, it } from "vitest";

import { hasDatabase, makeFixture } from "../test/fixtures";

describe.skipIf(!hasDatabase())("agents on a folder", () => {
  let agents: typeof import("./agents");

  beforeAll(async () => {
    agents = await import("./agents");
  });

  it("names a new agent exactly what it was asked to", async () => {
    const fixture = await makeFixture("agentname");

    const made = await agents.createAgent({
      organizationId: fixture.orgId,
      folderId: fixture.folderId,
      name: "pm",
      brief: "Own the spec.",
    });

    expect(made.handle).toBe("pm");
    expect(made.brief).toBe("Own the spec.");
    expect(made.folderId).toBe(fixture.folderId);

    await fixture.cleanup();
  });

  it("reaches the same agent when the same name is asked for twice", async () => {
    const fixture = await makeFixture("twice");

    const first = await agents.createAgent({
      organizationId: fixture.orgId,
      folderId: fixture.folderId,
      name: "pm",
      brief: "Own the spec.",
    });
    const again = await agents.createAgent({
      organizationId: fixture.orgId,
      folderId: fixture.folderId,
      name: "pm",
    });

    expect(again.id).toBe(first.id);
    expect(again.brief).toBe("Own the spec.");

    await fixture.cleanup();
  });

  it("refuses a name an agent on another folder already answers to", async () => {
    const fixture = await makeFixture("clash");
    const other = await fixture.channel("clash-other");

    await fixture.agent(other, "clash-pm");

    await expect(
      agents.createAgent({
        organizationId: fixture.orgId,
        folderId: fixture.folderId,
        name: "clash-pm",
      }),
    ).rejects.toThrow(/taken/);

    await fixture.cleanup();
  });

  it("resolves a handle however it was typed", async () => {
    const fixture = await makeFixture("resolve");
    await agents.createAgent({
      organizationId: fixture.orgId,
      folderId: fixture.folderId,
      name: "resolve-pm",
    });

    const found = await agents.resolveAgent({
      organizationId: fixture.orgId,
      handle: "@Resolve-PM",
    });

    expect(found?.handle).toBe("resolve-pm");

    await fixture.cleanup();
  });

  it("stops listing an archived agent but keeps its row", async () => {
    const fixture = await makeFixture("archive");
    const made = await agents.createAgent({
      organizationId: fixture.orgId,
      folderId: fixture.folderId,
      name: "reviewer",
    });

    await agents.archiveAgent(made.id);

    const listed = await agents.listAgents({
      organizationId: fixture.orgId,
      memberId: fixture.memberId,
      role: "owner",
    });

    expect(listed.map((agent) => agent.handle)).not.toContain(made.handle);

    const { db, members } = await import("@roster/db");
    const { eq } = await import("drizzle-orm");
    const row = await db.query.members.findFirst({
      where: eq(members.id, made.id),
    });
    expect(row).toBeDefined();

    await fixture.cleanup();
  });

  it("frees the handle it was archived under", async () => {
    const fixture = await makeFixture("freename");

    const first = await agents.createAgent({
      organizationId: fixture.orgId,
      folderId: fixture.folderId,
      name: "pm",
    });
    await agents.archiveAgent(first.id);

    const second = await agents.createAgent({
      organizationId: fixture.orgId,
      folderId: fixture.folderId,
      name: "pm",
    });

    expect(second.handle).toBe("pm");
    expect(second.id).not.toBe(first.id);

    await fixture.cleanup();
  });

  it("refuses to archive the agent a channel answers as", async () => {
    const fixture = await makeFixture("lastagent");

    const main = await agents.defaultAgentFor(fixture.projectId);
    expect(main?.main).toBe(true);

    await expect(agents.archiveAgent(main!.id)).rejects.toThrow(/answers #/);

    await fixture.cleanup();
  });

  it("renames without letting two agents answer to one handle", async () => {
    const fixture = await makeFixture("rename");

    const pm = await agents.createAgent({
      organizationId: fixture.orgId,
      folderId: fixture.folderId,
      name: "pm",
    });
    await agents.createAgent({
      organizationId: fixture.orgId,
      folderId: fixture.folderId,
      name: "qa",
    });

    const renamed = await agents.updateAgent({
      organizationId: fixture.orgId,
      id: pm.id,
      name: "product",
      brief: "Scope only.",
    });
    expect(renamed.handle).toBe("product");
    expect(renamed.brief).toBe("Scope only.");

    await expect(
      agents.updateAgent({
        organizationId: fixture.orgId,
        id: pm.id,
        name: "qa",
      }),
    ).rejects.toThrow(/taken/);

    await fixture.cleanup();
  });

  it("moves an agent to another folder", async () => {
    const fixture = await makeFixture("movefolder");
    const other = await fixture.channel("movefolder-other");

    const pm = await agents.createAgent({
      organizationId: fixture.orgId,
      folderId: fixture.folderId,
      name: "pm",
    });

    const moved = await agents.updateAgent({
      organizationId: fixture.orgId,
      id: pm.id,
      folderId: fixture.folderFor(other),
    });

    expect(moved.folderId).toBe(fixture.folderFor(other));

    await fixture.cleanup();
  });

  it("archives an ephemeral agent when its thread is done", async () => {
    const fixture = await makeFixture("ephem");
    const made = await fixture.thread();

    const scratch = await agents.createAgent({
      organizationId: fixture.orgId,
      folderId: fixture.folderId,
      name: "scratch",
      ephemeral: true,
    });
    const kept = await agents.createAgent({
      organizationId: fixture.orgId,
      folderId: fixture.folderId,
      name: "pm",
    });

    const { db, threadSessions } = await import("@roster/db");
    await db.insert(threadSessions).values({
      threadId: made.threadId,
      projectId: fixture.projectId,
      agentMemberId: scratch.id,
      role: "delegate",
      status: "idle",
    });

    const { completeThread } = await import("./sessions/supervisor");
    await completeThread({
      threadId: made.threadId,
      memberId: fixture.memberId,
    });

    const left = await agents.listAgents({
      organizationId: fixture.orgId,
      memberId: fixture.memberId,
      role: "owner",
    });

    expect(left.map((agent) => agent.handle)).toContain(kept.handle);
    expect(left.map((agent) => agent.handle)).not.toContain(scratch.handle);

    const reused = await agents.createAgent({
      organizationId: fixture.orgId,
      folderId: fixture.folderId,
      name: "scratch",
    });
    expect(reused.handle).toBe(scratch.handle);
    expect(reused.id).not.toBe(scratch.id);

    await fixture.cleanup();
  });

  it("gives a bare folder an agent named for it", async () => {
    const fixture = await makeFixture("ensure");

    const { randomUUID } = await import("node:crypto");
    const { db, folders } = await import("@roster/db");
    const folderId = randomUUID();
    await db.insert(folders).values({
      id: folderId,
      organizationId: fixture.orgId,
      supersetProjectId: `superset-bare-${folderId.slice(0, 8)}`,
      supersetHostId: "host-1",
      supersetOrgId: fixture.orgId,
      name: "ensure-bare",
      ownerMemberId: fixture.memberId,
    });

    const made = await agents.ensureFolderAgent({
      organizationId: fixture.orgId,
      folderId,
      handle: "ensure-bare",
    });

    expect(made.handle).toBe("ensure-bare");
    expect(made.folderId).toBe(folderId);

    await fixture.cleanup();
  });
});
