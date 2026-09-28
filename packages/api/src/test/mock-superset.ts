import { vi } from "vitest";

import { runSessionsInThisProcess } from "../services/sessions/dispatch";

runSessionsInThisProcess();

vi.mock("@roster/superset", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@roster/superset")>();

  return {
    ...actual,
    createWorkspace: vi.fn(async () => ({
      id: "workspace-1",
      path: "/tmp/workspace-1",
    })),
    createWorkspaceEnqueued: vi.fn(
      async (args: { workspaceId: string }) => ({
        workspaceId: args.workspaceId,
      }),
    ),
    deleteWorkspace: vi.fn(async () => undefined),
    clearWorkspaceStatuses: vi.fn(async () => undefined),
    createTerminal: vi.fn(async () => ({ id: "terminal-1" })),
    killTerminal: vi.fn(async () => undefined),
    runAgent: vi.fn(async () => ({ sessionId: "terminal-1" })),
    sendToAgent: vi.fn(async () => undefined),
    interruptAgent: vi.fn(async () => undefined),
    writeTerminalInput: vi.fn(async () => undefined),
    listTerminals: vi.fn(async () => []),
    listHostAgents: vi.fn(async () => []),
    listAgentBindings: vi.fn(async () => []),
    readTranscript: vi.fn(async () => ({
      terminalId: "terminal-1",
      text: "",
      source: "harness" as const,
      streamBytes: 0,
    })),
    mintJwt: vi.fn(async () => ({ token: "jwt" })),
    listHosts: vi.fn(async () => []),
    listProjects: vi.fn(async () => []),
    listOrganizations: vi.fn(async () => []),
    getOrganization: vi.fn(async () => null),
  };
});

vi.mock("../services/sessions/connection", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/sessions/connection")>();

  return {
    ...actual,
    hostConnection: vi.fn(async () => ({
      jwt: "jwt",
      hostKey: "host-1",
      memberId: "member-1",
      project: { supersetProjectId: "superset-project" },
    })),
    jwtForMember: vi.fn(async () => ({ jwt: "jwt" })),
  };
});
