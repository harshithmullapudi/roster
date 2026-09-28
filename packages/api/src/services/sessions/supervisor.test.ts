import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://roster:roster@127.0.0.1:5432/roster";
});

const { restAction, REST_TTL_MS, workspaceSurvivedReap } = await import(
  "./supervisor"
);

const session = (
  over: Partial<{
    supersetWorkspaceId: string | null;
    workspaceReapedAt: Date | null;
  }> = {},
) => ({
  supersetWorkspaceId: "ws_1",
  workspaceReapedAt: null,
  ...over,
});

describe("workspaceSurvivedReap", () => {
  it("flags a workspace the reap never stamped", () => {
    expect(workspaceSurvivedReap(session())).toBe(true);
  });

  it("clears a workspace the reap stamped", () => {
    expect(
      workspaceSurvivedReap(session({ workspaceReapedAt: new Date() })),
    ).toBe(false);
  });

  it("ignores a session that never had a workspace", () => {
    expect(workspaceSurvivedReap(session({ supersetWorkspaceId: null }))).toBe(
      false,
    );
  });

  it("ignores a workspaceless session even if it somehow carries a stamp", () => {
    expect(
      workspaceSurvivedReap(
        session({ supersetWorkspaceId: null, workspaceReapedAt: new Date() }),
      ),
    ).toBe(false);
  });
});

describe("restAction", () => {
  const NOW = 1_000_000;

  const args = (
    over: Partial<Parameters<typeof restAction>[0]> = {},
  ): Parameters<typeof restAction>[0] => ({
    restingSince: NOW - 60_000,
    now: NOW,
    transcriptChanged: false,
    bindingActive: false,
    ...over,
  });

  it("sleeps on while nothing happens", () => {
    expect(restAction(args())).toBe("sleep");
  });

  it("wakes when the transcript moved again", () => {
    expect(restAction(args({ transcriptChanged: true }))).toBe("wake");
  });

  it("wakes when the harness reports the agent working again", () => {
    expect(restAction(args({ bindingActive: true }))).toBe("wake");
  });

  it("stops watching once the rest has aged out", () => {
    expect(restAction(args({ restingSince: NOW - REST_TTL_MS }))).toBe("stop");
  });

  it("prefers waking over stopping when both apply", () => {
    expect(
      restAction(
        args({ restingSince: NOW - REST_TTL_MS, transcriptChanged: true }),
      ),
    ).toBe("wake");
  });
});
