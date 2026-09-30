import { describe, expect, it } from "vitest";

import { answersFor } from "./delegation-answers";

describe("answersFor", () => {
  it("reads as one reply when only one agent was asked", () => {
    expect(
      answersFor([{ handle: "fern-core", reply: "done, tests green", failed: false }]),
    ).toBe("@fern-core replied:\n\ndone, tests green");
  });

  it("tells the asker to decide when its one ask failed", () => {
    expect(answersFor([{ handle: "fern-core", reply: "", failed: true }])).toBe(
      "@fern-core could not complete that.\n\nDecide what to do next.",
    );
  });

  it("carries every answer, so the asker resumes with the whole picture", () => {
    const text = answersFor([
      { handle: "fern-core", reply: "the api is ready", failed: false },
      { handle: "sol-superset", reply: "the host is up", failed: false },
    ]);

    expect(text).toContain("@fern-core replied:\n\nthe api is ready");
    expect(text).toContain("@sol-superset replied:\n\nthe host is up");
    expect(text).toContain("That is everyone you asked.");
  });

  it("keeps a failure beside the answers that did come back", () => {
    const text = answersFor([
      { handle: "fern-core", reply: "the api is ready", failed: false },
      { handle: "sol-superset", reply: "", failed: true },
    ]);

    expect(text).toContain("@sol-superset could not complete that.");
    expect(text).toContain("the api is ready");
  });

  it("says so when an agent finished without a word", () => {
    expect(answersFor([{ handle: "fern-core", reply: "  ", failed: false }])).toBe(
      "@fern-core finished without a reply.",
    );
  });
});
