import SuperJSON from "superjson";

import { SupersetError } from "./client";

const RELAY_URL = process.env.SUPERSET_RELAY_URL ?? "https://relay.superset.sh";

export const DEFAULT_AGENT = "claude";

export function routingKey(organizationId: string, hostId: string): string {
  return `${organizationId}:${hostId}`;
}

async function unwrap<T>(response: Response, what: string): Promise<T> {
  const raw = await response.text();

  if (!response.ok) {
    throw new SupersetError(
      `${what} failed with ${response.status}: ${raw.slice(0, 300)}`,
      response.status,
    );
  }

  let parsed: { result?: { data?: unknown } };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SupersetError(`${what} returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  const data = parsed.result?.data;
  if (data === undefined) {
    throw new SupersetError(`${what} returned a malformed response.`);
  }
  return SuperJSON.deserialize(
    data as Parameters<typeof SuperJSON.deserialize>[0],
  ) as T;
}

async function call<T>(args: {
  jwt: string;
  routingKey: string;
  procedure: string;
  input: unknown;
  what: string;
  method: "GET" | "POST";
  timeoutMs?: number;
}): Promise<T> {
  const base = `${RELAY_URL}/hosts/${args.routingKey}/trpc/${args.procedure}`;
  const serialized = JSON.stringify(SuperJSON.serialize(args.input));
  const url =
    args.method === "GET"
      ? `${base}?input=${encodeURIComponent(serialized)}`
      : base;

  let response: Response;
  try {
    response = await fetch(url, {
      method: args.method,
      headers: {
        Authorization: `Bearer ${args.jwt}`,
        "Content-Type": "application/json",
      },
      body: args.method === "POST" ? serialized : undefined,
      signal: AbortSignal.timeout(args.timeoutMs ?? 30_000),
    });
  } catch (cause) {
    throw new SupersetError(
      `${args.what} could not reach that machine. ${(cause as Error).message}`,
    );
  }

  return unwrap<T>(response, args.what);
}

export interface CreatedWorkspace {
  id: string;
  name: string;
  branch: string;
}

export async function createWorkspace(args: {
  jwt: string;
  routingKey: string;
  projectId: string;
  namingPrompt: string;
}): Promise<CreatedWorkspace> {
  const result = await call<{ workspace: CreatedWorkspace }>({
    jwt: args.jwt,
    routingKey: args.routingKey,
    procedure: "workspaces.create",
    input: {
      projectId: args.projectId,
      namingPrompt: args.namingPrompt,
      runSetup: false,
    },
    what: "Creating a worktree on that machine",
    method: "POST",
    timeoutMs: 60_000,
  });
  return result.workspace;
}

export async function createWorkspaceEnqueued(args: {
  jwt: string;
  routingKey: string;
  projectId: string;
  workspaceId: string;
  name: string;
}): Promise<{ workspaceId: string }> {
  return call<{ workspaceId: string }>({
    jwt: args.jwt,
    routingKey: args.routingKey,
    procedure: "workspaces.createEnqueued",
    input: {
      id: args.workspaceId,
      projectId: args.projectId,
      name: args.name,
      runSetup: false,
    },
    what: "Creating a worktree on that machine",
    method: "POST",
  });
}

export async function deleteWorkspace(args: {
  jwt: string;
  routingKey: string;
  workspaceId: string;
}): Promise<void> {
  await call({
    jwt: args.jwt,
    routingKey: args.routingKey,
    procedure: "workspace.delete",
    input: { id: args.workspaceId },
    what: "Removing that worktree",
    method: "POST",
    timeoutMs: 60_000,
  });
}

export interface AgentRun {
  kind: "terminal";
  sessionId: string;
  label: string;
}

export async function runAgent(args: {
  jwt: string;
  routingKey: string;
  workspaceId: string;
  prompt: string;
  agent?: string;
}): Promise<AgentRun> {
  return call<AgentRun>({
    jwt: args.jwt,
    routingKey: args.routingKey,
    procedure: "agents.run",
    input: {
      workspaceId: args.workspaceId,
      agent: args.agent ?? DEFAULT_AGENT,
      prompt: args.prompt,
    },
    what: "Starting the agent",
    method: "POST",
    timeoutMs: 60_000,
  });
}

export async function sendToAgent(args: {
  jwt: string;
  routingKey: string;
  workspaceId: string;
  terminalId: string;
  text: string;
}): Promise<void> {
  await call({
    jwt: args.jwt,
    routingKey: args.routingKey,
    procedure: "terminal.send",
    input: {
      terminalId: args.terminalId,
      workspaceId: args.workspaceId,
      text: args.text,
      submit: true,
    },
    what: "Sending the agent a message",
    method: "POST",
  });
}

const ESCAPE = "\u001b";

export async function writeTerminalInput(args: {
  jwt: string;
  routingKey: string;
  workspaceId: string;
  terminalId: string;
  data: string;
}): Promise<void> {
  await call({
    jwt: args.jwt,
    routingKey: args.routingKey,
    procedure: "terminal.writeInput",
    input: {
      terminalId: args.terminalId,
      workspaceId: args.workspaceId,
      data: args.data,
    },
    what: "Typing into that session",
    method: "POST",
  });
}

export async function interruptAgent(args: {
  jwt: string;
  routingKey: string;
  workspaceId: string;
  terminalId: string;
}): Promise<void> {
  await writeTerminalInput({ ...args, data: ESCAPE });
}

export async function clearWorkspaceStatuses(args: {
  jwt: string;
  routingKey: string;
  workspaceId: string;
  terminalId?: string;
}): Promise<void> {
  await call({
    jwt: args.jwt,
    routingKey: args.routingKey,
    procedure: "terminalAgents.clearWorkspaceStatuses",
    input: {
      workspaceId: args.workspaceId,
      terminalId: args.terminalId,
    },
    what: "Clearing the agent's status",
    method: "POST",
  });
}

export interface Transcript {
  terminalId: string;
  text: string;
  source: "harness" | "stream" | "screen";
  streamBytes: number;
}

export async function readTranscript(args: {
  jwt: string;
  routingKey: string;
  workspaceId: string;
  terminalId: string;
  maxChars?: number;
}): Promise<Transcript> {
  return call<Transcript>({
    jwt: args.jwt,
    routingKey: args.routingKey,
    procedure: "terminal.transcript",
    input: {
      terminalId: args.terminalId,
      workspaceId: args.workspaceId,
      maxChars: args.maxChars ?? 32_000,
    },
    what: "Reading the agent's output",
    method: "GET",
  });
}

export interface AgentBinding {
  terminalId: string;
  workspaceId: string;
  lastEventAt: number;
  lastEventType: string;
  endedAt?: number;
  endReason?: string;
}

export async function listAgentBindings(args: {
  jwt: string;
  routingKey: string;
  workspaceId: string;
}): Promise<AgentBinding[]> {
  return call<AgentBinding[]>({
    jwt: args.jwt,
    routingKey: args.routingKey,
    procedure: "terminalAgents.listByWorkspace",
    input: { workspaceId: args.workspaceId },
    what: "Checking the agent's state",
    method: "GET",
  });
}

export interface TerminalSession {
  terminalId: string;
  workspaceId: string;
  createdAt: number;
  exited: boolean;
  exitCode: number;
  attached: boolean;
  title: string | null;
  customTitle: string | null;
}

export async function listTerminals(args: {
  jwt: string;
  routingKey: string;
  workspaceId: string;
}): Promise<TerminalSession[]> {
  const result = await call<{ sessions: TerminalSession[] }>({
    jwt: args.jwt,
    routingKey: args.routingKey,
    procedure: "terminal.list",
    input: { workspaceId: args.workspaceId },
    what: "Listing that worktree's sessions",
    method: "GET",
  });
  return result.sessions;
}

export interface HostAgent {
  id: string;
  presetId: string;
  iconId: string | null;
  label: string;
  order: number;
}

export async function listHostAgents(args: {
  jwt: string;
  routingKey: string;
}): Promise<HostAgent[]> {
  const rows = await call<HostAgent[]>({
    jwt: args.jwt,
    routingKey: args.routingKey,
    procedure: "settings.agentConfigs.list",
    input: undefined,
    what: "Listing the agents on that machine",
    method: "GET",
  });
  return rows.map((row) => ({
    id: row.id,
    presetId: row.presetId,
    iconId: row.iconId ?? null,
    label: row.label,
    order: row.order,
  }));
}

export async function createTerminal(args: {
  jwt: string;
  routingKey: string;
  workspaceId: string;
}): Promise<{ terminalId: string }> {
  return call<{ terminalId: string }>({
    jwt: args.jwt,
    routingKey: args.routingKey,
    procedure: "terminal.createSession",
    input: { workspaceId: args.workspaceId, themeType: "dark" },
    what: "Opening a shell in that worktree",
    method: "POST",
    timeoutMs: 60_000,
  });
}

export async function killTerminal(args: {
  jwt: string;
  routingKey: string;
  workspaceId: string;
  terminalId: string;
}): Promise<void> {
  await call({
    jwt: args.jwt,
    routingKey: args.routingKey,
    procedure: "terminal.killSession",
    input: {
      terminalId: args.terminalId,
      workspaceId: args.workspaceId,
    },
    what: "Closing that session",
    method: "POST",
  });
}

export function terminalSocketUrl(args: {
  routingKey: string;
  terminalId: string;
  workspaceId: string;
  jwt: string;
  seq: string;
}): string {
  const query = new URLSearchParams({
    workspaceId: args.workspaceId,
    themeType: "dark",
    seq: args.seq,
    token: args.jwt,
  });
  const base = RELAY_URL.replace(/^http/, "ws");
  return `${base}/hosts/${args.routingKey}/terminal/${encodeURIComponent(
    args.terminalId,
  )}?${query.toString()}`;
}

const IDLE_EVENT_TYPES = new Set(["Stop", "Detached", "exit", "error"]);

export function bindingIsIdle(
  binding: AgentBinding | undefined,
  settleMs: number,
): boolean {
  if (!binding) return false;
  if (binding.endedAt !== undefined) return true;
  if (!IDLE_EVENT_TYPES.has(binding.lastEventType)) return false;
  return Date.now() - binding.lastEventAt >= settleMs;
}

export function eventsUrl(key: string): string {
  return `${RELAY_URL.replace(/^http/, "ws")}/hosts/${key}/events`;
}

export interface AgentLifecycleEvent {
  type: "agent:lifecycle";
  workspaceId: string;
  terminalId: string;
  eventType: "Start" | "Stop" | "PermissionRequest" | "Failed" | "Attached" | "Detached";
  occurredAt: number;
}

export function isAgentLifecycle(value: unknown): value is AgentLifecycleEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    event.type === "agent:lifecycle" &&
    typeof event.workspaceId === "string" &&
    typeof event.terminalId === "string" &&
    typeof event.eventType === "string"
  );
}
