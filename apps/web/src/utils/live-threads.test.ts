import { describe, expect, it } from "vitest";

import {
  countByState,
  type LiveThreadItem,
  sessionsHeading,
  threadTitle,
  toSessionItems,
} from "./live-threads";

const thread = (over: Partial<LiveThreadItem> = {}): LiveThreadItem => ({
  id: "t1",
  projectId: "p1",
  channelSlug: "general",
  status: "running",
  rootText: "Ship the sidebar",
  lastProgress: null,
  startedAt: new Date("2026-09-19T10:00:00Z"),
  turnUnseen: false,
  ...over,
});

describe("threadTitle", () => {
  it("takes the first line of the root message", () => {
    expect(threadTitle("Fix the dock\n\nIt drops frames on resize.")).toBe(
      "Fix the dock",
    );
  });

  it("trims the line it takes", () => {
    expect(threadTitle("   Fix the dock   \nmore")).toBe("Fix the dock");
  });

  it("falls back when the root message is empty or blank", () => {
    expect(threadTitle("")).toBe("Untitled");
    expect(threadTitle("   \nsomething")).toBe("Untitled");
  });
});

describe("countByState", () => {
  it("counts an agent working separately from one waiting on a person", () => {
    const counts = countByState([
      thread({ id: "a", status: "running" }),
      thread({ id: "b", status: "starting" }),
      thread({ id: "c", status: "needs_input" }),
    ]);

    expect(counts).toEqual({ running: 2, needsInput: 1, turnDone: 0 });
  });

  it("does not let a thread waiting on a person be counted as running", () => {
    const counts = countByState([thread({ status: "needs_input" })]);

    expect(counts.running).toBe(0);
    expect(counts.needsInput).toBe(1);
  });

  it("counts a finished turn nobody has read as its own state", () => {
    const counts = countByState([
      thread({ id: "a", status: "running" }),
      thread({ id: "b", status: "idle", turnUnseen: true }),
      thread({ id: "c", status: "completed", turnUnseen: true }),
    ]);

    expect(counts).toEqual({ running: 1, needsInput: 0, turnDone: 2 });
  });

  it("stops counting a finished turn once it has been read", () => {
    const counts = countByState([
      thread({ id: "a", status: "waiting" }),
      thread({ id: "b", status: "idle", turnUnseen: false }),
    ]);

    expect(counts).toEqual({ running: 0, needsInput: 0, turnDone: 0 });
  });
});

describe("sessionsHeading", () => {
  const counts = (over: Partial<ReturnType<typeof countByState>> = {}) => ({
    running: 0,
    needsInput: 0,
    turnDone: 0,
    ...over,
  });

  it("names the one session running", () => {
    expect(sessionsHeading(counts({ running: 1 }), 1)).toBe("1 session running");
  });

  it("counts several sessions running", () => {
    expect(sessionsHeading(counts({ running: 3 }), 3)).toBe(
      "3 sessions running",
    );
  });

  it("leads with what is waiting on you", () => {
    expect(sessionsHeading(counts({ needsInput: 2, running: 3 }), 5)).toBe(
      "2 of 5 waiting on you",
    );
  });

  it("puts what is waiting on you ahead of what finished", () => {
    expect(sessionsHeading(counts({ needsInput: 1, turnDone: 2 }), 3)).toBe(
      "1 of 3 waiting on you",
    );
  });

  it("drops the ratio when every session has finished", () => {
    expect(sessionsHeading(counts({ turnDone: 1 }), 1)).toBe("1 turn completed");
    expect(sessionsHeading(counts({ turnDone: 2 }), 2)).toBe(
      "2 turns completed",
    );
  });

  it("keeps the ratio when some are still working", () => {
    expect(sessionsHeading(counts({ turnDone: 1, running: 2 }), 3)).toBe(
      "1 of 3 finished their turn",
    );
  });
});

describe("toSessionItems", () => {
  const channels = [
    { id: "p1", slug: "design" },
    { id: "p2", slug: "infra" },
  ];

  it("links each session to the thread inside its channel", () => {
    const items = toSessionItems(
      [thread({ id: "t1", projectId: "p2", rootText: "Fix the dock\nmore" })],
      channels,
      "acme",
    );

    expect(items).toEqual([
      {
        id: "t1",
        title: "Fix the dock",
        channelSlug: "infra",
        status: "running",
        turnUnseen: false,
        href: "/acme/infra?thread=t1",
      },
    ]);
  });

  it("drops a session whose channel this member cannot see", () => {
    const items = toSessionItems(
      [
        thread({ id: "t1", projectId: "p1" }),
        thread({ id: "t2", projectId: "hidden" }),
      ],
      channels,
      "acme",
    );

    expect(items.map((item) => item.id)).toEqual(["t1"]);
  });

  it("returns nothing when there are no live sessions", () => {
    expect(toSessionItems([], channels, "acme")).toEqual([]);
  });
});
