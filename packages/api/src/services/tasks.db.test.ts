import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("upcoming tasks for a channel", () => {
  let upcoming: (scope: {
    organizationId: string;
    memberId: string;
    role: string;
    projectId: string;
    withinMinutes?: number;
  }) => Promise<Array<{ title: string }>>;
  let fixture: Awaited<
    ReturnType<typeof import("../test/fixtures").makeFixture>
  >;
  let otherChannelId: string;

  const minutes = (n: number) => new Date(Date.now() + n * 60_000);

  beforeAll(async () => {
    const { makeFixture } = await import("../test/fixtures");
    const { upcomingTasks } = await import("./tasks");
    const { db, tasks } = await import("@roster/db");

    upcoming = upcomingTasks;
    fixture = await makeFixture("upcoming");
    otherChannelId = await fixture.channel("upcoming-other");

    await db.insert(tasks).values([
      {
        organizationId: fixture.orgId,
        projectId: fixture.projectId,
        title: "second soonest",
        rrule: "FREQ=DAILY",
        nextRunAt: minutes(25),
      },
      {
        organizationId: fixture.orgId,
        projectId: fixture.projectId,
        title: "soonest",
        rrule: "FREQ=DAILY",
        nextRunAt: minutes(10),
      },
      {
        organizationId: fixture.orgId,
        projectId: fixture.projectId,
        title: "beyond the window",
        rrule: "FREQ=DAILY",
        nextRunAt: minutes(45),
      },
      {
        organizationId: fixture.orgId,
        projectId: fixture.projectId,
        title: "already fired",
        rrule: "FREQ=DAILY",
        nextRunAt: minutes(-5),
      },
      {
        organizationId: fixture.orgId,
        projectId: fixture.projectId,
        title: "not recurring",
        nextRunAt: minutes(5),
      },
      {
        organizationId: fixture.orgId,
        projectId: otherChannelId,
        title: "other channel",
        rrule: "FREQ=DAILY",
        nextRunAt: minutes(5),
      },
    ]);
  });

  afterAll(async () => {
    await fixture?.cleanup();
  });

  it("returns only recurring tasks inside the window, soonest first", async () => {
    const result = await upcoming({
      organizationId: fixture.orgId,
      memberId: fixture.memberId,
      role: "owner",
      projectId: fixture.projectId,
    });

    expect(result.map((task) => task.title)).toEqual([
      "soonest",
      "second soonest",
    ]);
  });

  it("widens with the window", async () => {
    const result = await upcoming({
      organizationId: fixture.orgId,
      memberId: fixture.memberId,
      role: "owner",
      projectId: fixture.projectId,
      withinMinutes: 60,
    });

    expect(result.map((task) => task.title)).toEqual([
      "soonest",
      "second soonest",
      "beyond the window",
    ]);
  });

  it("returns nothing for a member outside the org", async () => {
    const { makeFixture } = await import("../test/fixtures");
    const stranger = await makeFixture("upcoming-stranger");
    try {
      const result = await upcoming({
        organizationId: stranger.orgId,
        memberId: stranger.memberId,
        role: "owner",
        projectId: fixture.projectId,
      });
      expect(result).toEqual([]);
    } finally {
      await stranger.cleanup();
    }
  });
});
