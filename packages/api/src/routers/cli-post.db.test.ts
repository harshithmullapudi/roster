import { describe, expect, it } from "vitest";

import "../test/mock-superset";
import { hasDatabase, makeFixture, type Fixture } from "../test/fixtures";

describe.skipIf(!hasDatabase())("posting a channel message from the CLI", () => {
  async function callerFor(fixture: Fixture) {
    const { mintApiKey } = await import("../services/api-keys");
    const { createCallerFactory } = await import("../trpc");
    const { cliRouter } = await import("./cli");

    const key = await mintApiKey({
      organizationId: fixture.orgId,
      memberId: fixture.memberId,
      name: "posting",
    });

    return createCallerFactory(cliRouter)({
      headers: new Headers({ authorization: `Bearer ${key.key}` }),
      session: null,
      user: null,
    });
  }

  it("lands at channel level, in no thread", async () => {
    const fixture = await makeFixture("clipost");
    const caller = await callerFor(fixture);

    const posted = await caller.post({
      channelId: fixture.projectId,
      text: "heads up: release at noon",
    });

    expect(posted.channelSlug).toBe("clipost");

    const page = await caller.readMessages({ channelId: fixture.projectId });
    const found = page.messages.find(
      (message) => message.id === posted.id,
    );

    expect(found?.text).toBe("heads up: release at noon");
    expect(found?.thread).toBeNull();

    await fixture.cleanup();
  });

  it("refuses a channel this key cannot see", async () => {
    const fixture = await makeFixture("clipostmine");
    const stranger = await makeFixture("clipoststranger");
    const caller = await callerFor(fixture);

    await expect(
      caller.post({
        channelId: stranger.projectId,
        text: "should not land",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await stranger.cleanup();
    await fixture.cleanup();
  });
});
