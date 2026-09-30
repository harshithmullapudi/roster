import { describe, expect, it } from "vitest";

import type { SessionItem } from "~/utils/live-threads";
import type { VisitedThread } from "~/utils/thread-history";
import {
  SWITCHER_LIMIT,
  cycleIndex,
  initialIndex,
  isCancelKey,
  isCycleKey,
  isReleaseKey,
  toSwitcherItems,
} from "~/utils/thread-switcher";

function visit(threadId: string, title = threadId): VisitedThread {
  return { threadId, channelSlug: "design", title };
}

function session(id: string, status = "running"): SessionItem {
  return {
    id,
    title: `live ${id}`,
    channelSlug: "eng",
    status,
    turnUnseen: false,
    href: `/acme/eng?thread=${id}`,
  };
}

function key(
  code: string,
  modifiers: Partial<{
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    repeat: boolean;
  }> = {},
) {
  return {
    code,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    repeat: false,
    ...modifiers,
  };
}

describe("initialIndex", () => {
  it("lands on the thread you were in before, so a tap toggles back", () => {
    expect(initialIndex({ length: 4, onThread: true })).toBe(1);
  });

  it("stays put when the thread you are in is the only one", () => {
    expect(initialIndex({ length: 1, onThread: true })).toBe(0);
  });

  it("lands on the most recent thread when you are not in one", () => {
    expect(initialIndex({ length: 4, onThread: false })).toBe(0);
  });
});

describe("cycleIndex", () => {
  it("walks forward and wraps around the end", () => {
    expect(cycleIndex(0, 3, false)).toBe(1);
    expect(cycleIndex(2, 3, false)).toBe(0);
  });

  it("walks backward and wraps around the start", () => {
    expect(cycleIndex(1, 3, true)).toBe(0);
    expect(cycleIndex(0, 3, true)).toBe(2);
  });

  it("has nowhere to go with a single thread", () => {
    expect(cycleIndex(0, 1, false)).toBe(0);
    expect(cycleIndex(0, 0, false)).toBe(0);
  });
});

describe("isCycleKey", () => {
  it("answers to the slash key with a command modifier held", () => {
    expect(isCycleKey(key("Slash", { metaKey: true }))).toBe(true);
    expect(isCycleKey(key("Slash", { ctrlKey: true }))).toBe(true);
  });

  it("matches on the physical key, so shift still cycles backwards", () => {
    expect(isCycleKey(key("Slash", { metaKey: true, shiftKey: true }))).toBe(
      true,
    );
  });

  it("ignores a slash nobody held a modifier for", () => {
    expect(isCycleKey(key("Slash"))).toBe(false);
  });

  it("ignores other command shortcuts", () => {
    expect(isCycleKey(key("KeyK", { metaKey: true }))).toBe(false);
  });

  it("takes key repeat, because holding slash should keep cycling", () => {
    expect(isCycleKey(key("Slash", { metaKey: true, repeat: true }))).toBe(true);
  });
});

describe("isReleaseKey", () => {
  it("commits when the modifier that held the switcher open comes up", () => {
    expect(isReleaseKey({ key: "Meta" })).toBe(true);
    expect(isReleaseKey({ key: "Control" })).toBe(true);
  });

  it("does not commit when the slash comes up", () => {
    expect(isReleaseKey({ key: "/" })).toBe(false);
  });
});

describe("isCancelKey", () => {
  it("cancels on escape", () => {
    expect(isCancelKey({ key: "Escape" })).toBe(true);
    expect(isCancelKey({ key: "Meta" })).toBe(false);
  });
});

describe("toSwitcherItems", () => {
  const orgSlug = "acme";

  it("lists visited threads newest first", () => {
    const items = toSwitcherItems({
      history: [visit("a"), visit("b")],
      sessions: [],
      orgSlug,
      currentThreadId: null,
    });

    expect(items.map((item) => item.threadId)).toEqual(["a", "b"]);
    expect(items[0]?.href).toBe("/acme/design?thread=a");
  });

  it("shows a visited thread with no live session as completed", () => {
    const items = toSwitcherItems({
      history: [visit("a")],
      sessions: [],
      orgSlug,
      currentThreadId: null,
    });

    expect(items[0]?.status).toBe("completed");
    expect(items[0]?.turnUnseen).toBe(false);
  });

  it("takes the live status and fresher title for a thread still running", () => {
    const items = toSwitcherItems({
      history: [visit("a", "stale title")],
      sessions: [{ ...session("a"), turnUnseen: true }],
      orgSlug,
      currentThreadId: null,
    });

    expect(items[0]).toMatchObject({
      threadId: "a",
      status: "running",
      turnUnseen: true,
      title: "live a",
      channelSlug: "eng",
    });
  });

  it("reaches running threads you have never opened, after the visited ones", () => {
    const items = toSwitcherItems({
      history: [visit("a")],
      sessions: [session("z")],
      orgSlug,
      currentThreadId: null,
    });

    expect(items.map((item) => item.threadId)).toEqual(["a", "z"]);
  });

  it("works on a first run with no history at all", () => {
    const items = toSwitcherItems({
      history: [],
      sessions: [session("z"), session("y")],
      orgSlug,
      currentThreadId: null,
    });

    expect(items.map((item) => item.threadId)).toEqual(["z", "y"]);
  });

  it("hoists the thread you are looking at to the front", () => {
    const items = toSwitcherItems({
      history: [visit("a"), visit("b"), visit("c")],
      sessions: [],
      orgSlug,
      currentThreadId: "c",
    });

    expect(items.map((item) => item.threadId)).toEqual(["c", "a", "b"]);
  });

  it("keeps the thread you are looking at even past the cap", () => {
    const history = Array.from({ length: SWITCHER_LIMIT + 4 }, (_, index) =>
      visit(`thread-${index}`),
    );

    const items = toSwitcherItems({
      history,
      sessions: [],
      orgSlug,
      currentThreadId: `thread-${SWITCHER_LIMIT + 2}`,
    });

    expect(items).toHaveLength(SWITCHER_LIMIT);
    expect(items[0]?.threadId).toBe(`thread-${SWITCHER_LIMIT + 2}`);
  });
});
