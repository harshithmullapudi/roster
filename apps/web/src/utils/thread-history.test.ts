import { describe, expect, it } from "vitest";

import {
  HISTORY_LIMIT,
  parseHistory,
  recordVisit,
  type VisitedThread,
} from "~/utils/thread-history";

function visit(threadId: string, title = threadId): VisitedThread {
  return { threadId, channelSlug: "design", title };
}

describe("recordVisit", () => {
  it("puts a thread you have not seen at the front", () => {
    const history = recordVisit([visit("a")], visit("b"));
    expect(history.map((entry) => entry.threadId)).toEqual(["b", "a"]);
  });

  it("moves a thread you come back to without duplicating it", () => {
    const history = recordVisit([visit("a"), visit("b"), visit("c")], visit("c"));
    expect(history.map((entry) => entry.threadId)).toEqual(["c", "a", "b"]);
  });

  it("refreshes a title that changed since the last visit", () => {
    const history = recordVisit([visit("a", "old")], visit("a", "new"));
    expect(history[0]?.title).toBe("new");
  });

  it("drops the oldest visit once the list is full", () => {
    const full = Array.from({ length: HISTORY_LIMIT }, (_, index) =>
      visit(`thread-${index}`),
    );
    const history = recordVisit(full, visit("newest"));

    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[0]?.threadId).toBe("newest");
    expect(history.some((entry) => entry.threadId === "thread-19")).toBe(false);
  });
});

describe("parseHistory", () => {
  it("reads back what it stored", () => {
    const stored = [visit("a"), visit("b")];
    expect(parseHistory(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it("skips entries missing the fields the switcher needs", () => {
    const parsed = parseHistory([
      visit("a"),
      { threadId: "b" },
      { threadId: "c", channelSlug: "design" },
      null,
      "nope",
    ]);
    expect(parsed.map((entry) => entry.threadId)).toEqual(["a"]);
  });

  it("treats anything that is not a list as no history", () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory({ threadId: "a" })).toEqual([]);
  });

  it("caps a stored list that grew past the limit", () => {
    const stored = Array.from({ length: HISTORY_LIMIT + 5 }, (_, index) =>
      visit(`thread-${index}`),
    );
    expect(parseHistory(stored)).toHaveLength(HISTORY_LIMIT);
  });
});
