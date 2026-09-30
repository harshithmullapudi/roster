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
  const items = (flags: boolean[]) =>
    flags.map((isCurrent, index) => ({
      threadId: `t${index}`,
      title: `t${index}`,
      channelSlug: "design",
      status: "completed",
      turnUnseen: false,
      href: "#",
      group: "finished" as const,
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

  it("reaches running threads you have never opened", () => {
    const items = toSwitcherItems({
      history: [visit("a")],
      sessions: [session("z")],
      orgSlug,
      currentThreadId: null,
    });

    expect(items.map((item) => item.threadId)).toEqual(["z", "a"]);
  });

  it("puts a visited working thread above an unvisited one", () => {
    const items = toSwitcherItems({
      history: [visit("a")],
      sessions: [session("a", "running"), session("z", "running")],
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

  it("marks the thread you are looking at rather than moving it", () => {
    const items = toSwitcherItems({
      history: [visit("a"), visit("b"), visit("c")],
      sessions: [],
      orgSlug,
      currentThreadId: "c",
    });

    expect(items.map((item) => item.threadId)).toEqual(["a", "b", "c"]);
    expect(items.map((item) => item.isCurrent)).toEqual([false, false, true]);
  });

  it("puts working threads above finished ones", () => {
    const items = toSwitcherItems({
      history: [visit("a"), visit("b"), visit("c")],
      sessions: [session("b", "running")],
      orgSlug,
      currentThreadId: null,
    });

    expect(items.map((item) => [item.threadId, item.group])).toEqual([
      ["b", "working"],
      ["a", "finished"],
      ["c", "finished"],
    ]);
  });

  it("keeps most-recent-first inside each group", () => {
    const items = toSwitcherItems({
      history: [visit("a"), visit("b"), visit("c"), visit("d")],
      sessions: [session("b", "running"), session("d", "needs_input")],
      orgSlug,
      currentThreadId: null,
    });

    expect(items.map((item) => item.threadId)).toEqual(["b", "d", "a", "c"]);
  });

  it("counts waiting and needs-input as working, not finished", () => {
    const items = toSwitcherItems({
      history: [visit("a"), visit("b")],
      sessions: [session("a", "waiting"), session("b", "needs_input")],
      orgSlug,
      currentThreadId: null,
    });

    expect(items.every((item) => item.group === "working")).toBe(true);
  });

  it("caps the list", () => {
    const history = Array.from({ length: SWITCHER_LIMIT + 4 }, (_, index) =>
      visit(`thread-${index}`),
    );

    const items = toSwitcherItems({
      history,
      sessions: [],
      orgSlug,
      currentThreadId: null,
    });

    expect(items).toHaveLength(SWITCHER_LIMIT);
  });
});
