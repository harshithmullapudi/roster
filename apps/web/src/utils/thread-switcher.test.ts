import { describe, expect, it } from "vitest";

import type { SessionItem } from "~/utils/live-threads";
import type { VisitedThread } from "~/utils/thread-history";
import {
  SWITCHER_LIMIT,
  cycleIndex,
  groupLabel,
  initialIndex,
  isCancelKey,
  isCycleKey,
  isReleaseKey,
  stepFor,
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
  const items = (flags: boolean[]) =>
    flags.map((isCurrent, index) => ({
      threadId: `t${index}`,
      title: `t${index}`,
      channelSlug: "design",
      status: "running",
      turnUnseen: false,
      href: "#",
      group: "running" as const,
      isCurrent,
    }));

  it("lands on the thread you were in before, so a tap toggles back", () => {
    expect(initialIndex(items([false, true, false]))).toBe(0);
  });

  it("skips the thread you are already looking at wherever it sits", () => {
    expect(initialIndex(items([true, false, false]))).toBe(1);
  });

  it("stays put when the thread you are in is the only one", () => {
    expect(initialIndex(items([true]))).toBe(0);
  });

  it("lands on the most recent thread when you are not in one", () => {
    expect(initialIndex(items([false, false]))).toBe(0);
  });

  it("has nowhere to go with nothing to show", () => {
    expect(initialIndex([])).toBe(0);
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

describe("stepFor", () => {
  it("walks forward on the slash, backward with shift", () => {
    expect(stepFor(key("Slash", { metaKey: true }), false)).toBe("next");
    expect(stepFor(key("Slash", { metaKey: true, shiftKey: true }), false)).toBe(
      "previous",
    );
  });

  it("walks the list with the arrows while the switcher is up", () => {
    expect(stepFor(key("ArrowDown", { metaKey: true }), true)).toBe("next");
    expect(stepFor(key("ArrowUp", { metaKey: true }), true)).toBe("previous");
  });

  it("leaves the arrows to the page when the switcher is closed", () => {
    expect(stepFor(key("ArrowDown", { metaKey: true }), false)).toBe(null);
    expect(stepFor(key("ArrowUp"), false)).toBe(null);
  });

  it("ignores keys that are neither", () => {
    expect(stepFor(key("KeyJ", { metaKey: true }), true)).toBe(null);
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

describe("groupLabel", () => {
  it("names the groups the way the rest of the app does", () => {
    expect(groupLabel("needs-input")).toBe("Needs input");
    expect(groupLabel("turn-done")).toBe("Turn completed");
  });
});


describe("toSwitcherItems", () => {
  it("orders the groups needs input, turn completed, running", () => {
    const items = toSwitcherItems({
      history: [],
      sessions: [
        session("running", "running"),
        { ...session("done", "idle"), turnUnseen: true },
        session("asking", "needs_input"),
      ],
      currentThreadId: null,
    });

    expect(items.map((item) => [item.threadId, item.group])).toEqual([
      ["asking", "needs-input"],
      ["done", "turn-done"],
      ["running", "running"],
    ]);
  });

  it("leaves out a thread that came to rest with its turn already read", () => {
    const items = toSwitcherItems({
      history: [visit("a"), visit("b")],
      sessions: [session("a", "idle"), session("b", "running")],
      currentThreadId: null,
    });

    expect(items.map((item) => item.threadId)).toEqual(["b"]);
  });

  it("leaves out a visited thread with no live session at all", () => {
    const items = toSwitcherItems({
      history: [visit("a")],
      sessions: [],
      currentThreadId: null,
    });

    expect(items).toEqual([]);
  });

  it("keeps a rested thread whose last turn is unread", () => {
    const items = toSwitcherItems({
      history: [visit("a")],
      sessions: [{ ...session("a", "idle"), turnUnseen: true }],
      currentThreadId: null,
    });

    expect(items.map((item) => [item.threadId, item.group])).toEqual([
      ["a", "turn-done"],
    ]);
  });

  it("groups a thread by what it is doing over an unread turn behind it", () => {
    const items = toSwitcherItems({
      history: [],
      sessions: [
        { ...session("a", "needs_input"), turnUnseen: true },
        { ...session("b", "running"), turnUnseen: true },
      ],
      currentThreadId: null,
    });

    expect(items.map((item) => item.group)).toEqual(["needs-input", "running"]);
  });

  it("counts a waiting thread as running", () => {
    const items = toSwitcherItems({
      history: [visit("a")],
      sessions: [session("a", "waiting")],
      currentThreadId: null,
    });

    expect(items[0]?.group).toBe("running");
  });

  it("takes the live status and fresher title for a visited thread", () => {
    const items = toSwitcherItems({
      history: [visit("a", "stale title")],
      sessions: [session("a", "running")],
      currentThreadId: null,
    });

    expect(items[0]).toMatchObject({
      threadId: "a",
      status: "running",
      title: "live a",
      channelSlug: "eng",
      href: "/acme/eng?thread=a",
    });
  });

  it("puts a visited thread above one you have never opened", () => {
    const items = toSwitcherItems({
      history: [visit("a")],
      sessions: [session("z", "running"), session("a", "running")],
      currentThreadId: null,
    });

    expect(items.map((item) => item.threadId)).toEqual(["a", "z"]);
  });

  it("works on a first run with no history at all", () => {
    const items = toSwitcherItems({
      history: [],
      sessions: [session("z"), session("y")],
      currentThreadId: null,
    });

    expect(items.map((item) => item.threadId)).toEqual(["z", "y"]);
  });

  it("marks the thread you are looking at rather than moving it", () => {
    const items = toSwitcherItems({
      history: [visit("a"), visit("b"), visit("c")],
      sessions: [session("a"), session("b"), session("c")],
      currentThreadId: "c",
    });

    expect(items.map((item) => item.threadId)).toEqual(["a", "b", "c"]);
    expect(items.map((item) => item.isCurrent)).toEqual([false, false, true]);
  });

  it("keeps most-recent-first inside each group", () => {
    const items = toSwitcherItems({
      history: [visit("a"), visit("b"), visit("c"), visit("d")],
      sessions: [
        session("a", "running"),
        session("b", "needs_input"),
        session("c", "running"),
        session("d", "needs_input"),
      ],
      currentThreadId: null,
    });

    expect(items.map((item) => item.threadId)).toEqual(["b", "d", "a", "c"]);
  });

  it("caps the list", () => {
    const sessions = Array.from({ length: SWITCHER_LIMIT + 4 }, (_, index) =>
      session(`thread-${index}`),
    );

    const items = toSwitcherItems({
      history: sessions.map((item) => visit(item.id)),
      sessions,
      currentThreadId: null,
    });

    expect(items).toHaveLength(SWITCHER_LIMIT);
  });
});
