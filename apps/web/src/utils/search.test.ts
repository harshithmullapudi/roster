import type { MessageHit, TaskHit } from "@roster/api";
import { describe, expect, it } from "vitest";

import { messageHref, searchable, taskHref } from "./search";

const message: MessageHit = {
  id: "message-1",
  projectId: "project-1",
  channelSlug: "infra",
  threadId: null,
  author: "Ada",
  snippet: [{ text: "nothing", hit: false }],
  createdAt: new Date(),
};

const task: TaskHit = {
  id: "task-1",
  projectId: "project-1",
  channelSlug: "infra",
  threadId: null,
  title: "Fix the deploy",
  status: "todo",
  snippet: [{ text: "nothing", hit: false }],
};

describe("searchable", () => {
  it("waits for two characters", () => {
    expect(searchable("")).toBe(false);
    expect(searchable(" a ")).toBe(false);
    expect(searchable("ab")).toBe(true);
  });
});

describe("messageHref", () => {
  it("opens the thread when the message has one", () => {
    expect(messageHref("acme", { ...message, threadId: "thread-1" })).toBe(
      "/acme/infra?thread=thread-1",
    );
  });

  it("falls back to the channel when the message has no thread", () => {
    expect(messageHref("acme", message)).toBe("/acme/infra");
  });
});

describe("taskHref", () => {
  it("opens the thread a task runs in", () => {
    expect(taskHref("acme", { ...task, threadId: "thread-1" })).toBe(
      "/acme/infra?thread=thread-1",
    );
  });

  it("opens the channel's task tab otherwise", () => {
    expect(taskHref("acme", task)).toBe("/acme/infra?tab=tasks&channel=infra");
  });

  it("sends a backlog task to the org task list", () => {
    expect(
      taskHref("acme", { ...task, projectId: null, channelSlug: null }),
    ).toBe("/acme/tasks");
  });
});
