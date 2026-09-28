import { describe, expect, it } from "vitest";

import {
  type AttentionInboxThread,
  type AttentionLiveThread,
  channelsNeedingAttention,
} from "./channel-attention";

const live = (
  over: Partial<AttentionLiveThread> = {},
): AttentionLiveThread => ({
  projectId: "p1",
  status: "running",
  turnUnseen: false,
  ...over,
});

const inbox = (
  over: Partial<AttentionInboxThread> = {},
): AttentionInboxThread => ({
  projectId: "p1",
  unread: false,
  muted: false,
  ...over,
});

describe("channelsNeedingAttention", () => {
  it("flags a channel whose session is waiting on a person", () => {
    const flagged = channelsNeedingAttention(
      [live({ status: "needs_input" })],
      [],
    );
    expect(flagged.has("p1")).toBe(true);
  });

  it("flags a channel with a finished turn nobody has read", () => {
    const flagged = channelsNeedingAttention(
      [live({ status: "idle", turnUnseen: true })],
      [],
    );
    expect(flagged.has("p1")).toBe(true);
  });

  it("flags a channel with an unread followed thread", () => {
    const flagged = channelsNeedingAttention([], [inbox({ unread: true })]);
    expect(flagged.has("p1")).toBe(true);
  });

  it("leaves a channel alone while its agent is just working", () => {
    const flagged = channelsNeedingAttention([live()], [inbox()]);
    expect(flagged.size).toBe(0);
  });

  it("never bolds a channel for a muted thread", () => {
    const flagged = channelsNeedingAttention(
      [],
      [inbox({ unread: true, muted: true })],
    );
    expect(flagged.size).toBe(0);
  });

  it("collects each channel once across both sources", () => {
    const flagged = channelsNeedingAttention(
      [
        live({ projectId: "p1", status: "needs_input" }),
        live({ projectId: "p2", turnUnseen: true, status: "idle" }),
      ],
      [inbox({ projectId: "p1", unread: true })],
    );
    expect([...flagged].sort()).toEqual(["p1", "p2"]);
  });
});
