import { describe, expect, it } from "vitest";

import { relayNote, withRelayNote } from "./mention-relay";

const THREAD = "5f2b8e2c-0c2e-4a5f-9f7a-0c1f6a1b2c3d";

describe("relayNote", () => {
  it("is nothing when nobody else was tagged", () => {
    expect(relayNote({ handles: [], threadId: THREAD, me: "roster" })).toBeNull();
  });

  it("gives the ask for the one agent tagged", () => {
    const note = relayNote({ handles: ["fern-core"], threadId: THREAD, me: "roster" });

    expect(note).toContain("Tagged in that message: @fern-core.");
    expect(note).toContain(`roster ask fern-core `);
    expect(note).toContain(`--thread ${THREAD} --as roster`);
  });

  it("gives one ask per agent when several were tagged", () => {
    const note = relayNote({
      handles: ["fern-core", "sol-superset"],
      threadId: THREAD,
      me: "roster",
    });

    expect(note).toContain("@fern-core and @sol-superset");
    expect(note).toContain("roster ask fern-core ");
    expect(note).toContain("roster ask sol-superset ");
    expect(note).toContain("once every");
  });
});

describe("withRelayNote", () => {
  it("leaves a message with no tags untouched", () => {
    expect(withRelayNote({ text: "ship it", handles: [], threadId: THREAD, me: "roster" })).toBe(
      "ship it",
    );
  });

  it("keeps the message first, so the request still reads as the request", () => {
    const text = withRelayNote({
      text: "@fern-core take a look",
      handles: ["fern-core"],
      threadId: THREAD,
      me: "roster",
    });

    expect(text.startsWith("@fern-core take a look\n\n")).toBe(true);
  });
});
