import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import "../test/mock-superset";
import { hasDatabase, makeFixture } from "../test/fixtures";

describe.skipIf(!hasDatabase())("renaming a task", () => {
  it("changes the title and nothing else", async () => {
    const fixture = await makeFixture("taskrename");
    const { createTask, setTaskTitle } = await import("./tasks");

    const created = await createTask({
      organizationId: fixture.orgId,
      memberId: fixture.memberId,
      title: "first draft",
      status: "todo",
    });

    const renamed = await setTaskTitle({
      organizationId: fixture.orgId,
      memberId: fixture.memberId,
      role: "owner",
      taskId: created!.id,
      title: "second thoughts",
    });

    expect(renamed?.title).toBe("second thoughts");
    expect(renamed?.status).toBe(created!.status);
    expect(renamed?.projectId).toBe(created!.projectId);

    await fixture.cleanup();
  });

  it("refuses a task this key cannot see", async () => {
    const fixture = await makeFixture("taskrenamestranger");
    const { setTaskTitle } = await import("./tasks");

    const renamed = await setTaskTitle({
      organizationId: fixture.orgId,
      memberId: fixture.memberId,
      role: "owner",
      taskId: randomUUID(),
      title: "should not land",
    });

    expect(renamed).toBeNull();

    await fixture.cleanup();
  });
});
