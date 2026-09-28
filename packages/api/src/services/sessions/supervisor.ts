import { createHash } from "node:crypto";

import {
  db,
  delegations,
  members,
  messages,
  projects,
  type SelectThread,
  type SelectThreadSession,
  threadSessions,
  threads,
} from "@roster/db";
import {
  bindingIsIdle,
  clearWorkspaceStatuses,
  createWorkspace,
  deleteWorkspace,
  eventsUrl,
  interruptAgent,
  isAgentLifecycle,
  listAgentBindings,
  readTranscript,
  runAgent,
  sendToAgent,
} from "@roster/superset";
import { and, desc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";

import {
  humanSessionError,
  sessionErrorDetail,
  workspaceAlreadyGone,
} from "../../utils/session-error";
import { sessionPrompt } from "../../utils/message-run";
import {
  type DelegationContext,
  rosterEnvelope,
} from "../../utils/roster-envelope";
import { agentIsGone } from "../../utils/agent-liveness";
import {
  type LifecycleEvent,
  nextStatus,
  type ThreadStatus,
} from "../../utils/session-state";
import { mergeSteers, undeliveredSteerNotice } from "../../utils/steer-queue";
import { agentReply, lastMeaningfulLine } from "../../utils/thread-progress";
import { markdownToTiptap } from "../../utils/tiptap";
import {
  attachmentsForMessages,
  textWithAttachments,
} from "../attachments";
import {
  agentById,
  archiveEphemeralAgentsFor,
  mainAgentFor,
} from "../agents";
import { allocateSeq } from "../channels";
import { channelName, publish, threadChannelName } from "../centrifugo";
import { emitMessageById } from "../message-events";
import { notifyThreadFailed, subscribeThreadAuthor } from "../notifications";
import { addReaction } from "../reactions";
import { taskForThread } from "../tasks";
import { hostConnection, jwtForMember, NO_MEMBER } from "./connection";
import { threadPublishState } from "./queries";

export { threadChannelName };

const POLL_INTERVAL_MS = 2000;
const WRITE_INTERVAL_MS = 1000;
const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const SETTLE_DELAY_MS = 1500;
const STALENESS_TIMEOUT_MS = 60_000;
const STEER_READY_INTERVAL_MS = 500;
const STEER_READY_TIMEOUT_MS = 120_000;
const MAX_PUBLISH_HOPS = 3;
const REST_POLL_INTERVAL_MS = 30_000;
export const REST_TTL_MS = 60 * 60 * 1000;

const TERMINAL_STATUSES = ["completed", "failed", "canceled"] as const;

export { THREAD_STATUSES, type ThreadStatus } from "../../utils/session-state";

function isTerminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

const PARKED: ThreadStatus = "waiting";

function isParked(status: string): boolean {
  return status === PARKED;
}

function isIdle(status: string): boolean {
  return status === "idle";
}

export async function answersDelegation(args: {
  threadId: string;
  agentMemberId?: string;
}): Promise<boolean> {
  const open = await db.query.delegations.findFirst({
    where: and(
      eq(delegations.status, "open"),
      args.agentMemberId
        ? or(
            eq(delegations.childThreadId, args.threadId),
            and(
              eq(delegations.parentThreadId, args.threadId),
              eq(delegations.targetMemberId, args.agentMemberId),
            ),
          )
        : eq(delegations.childThreadId, args.threadId),
    ),
    columns: { id: true },
  });
  return open !== undefined;
}

async function statusAfter(
  session: SessionView,
  event: LifecycleEvent,
): Promise<ThreadStatus | null> {
  return nextStatus({
    current: session.status,
    event,
    answersDelegation: await answersDelegation({
      threadId: session.threadId,
      agentMemberId: session.agentMemberId,
    }),
  });
}

const COMPLETE_EMOJI = "✅";

interface HostLink {
  hostKey: string;
  memberId: string;
  socket: WebSocket | null;
  attempts: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
}

interface Watch {
  sessionId: string;
  threadId: string;
  hostKey: string;
  memberId: string;
  workspaceId: string;
  terminalId: string;
  pollTimer: ReturnType<typeof setInterval> | null;
  lastWriteAt: number;
  lastProgress: string | null;
  lastStartAt: number;
  lastStopAt: number;
  transcript: string | null;
  transcriptChangedAt: number;
  bindingEventAt: number | null;
  bindingChangedAt: number;
  restingSince: number | null;
}

const hosts = new Map<string, HostLink>();

function linkKey(hostKey: string, memberId: string): string {
  return `${memberId}@${hostKey}`;
}

const watches = new Map<string, Watch>();
const byTerminal = new Map<string, string>();
const finishing = new Set<string>();
const pendingSteers = new Map<string, string[]>();

let started = false;
let starting: Promise<void> | null = null;

interface SessionView {
  id: string;
  threadId: string;
  projectId: string;
  agentMemberId: string;
  role: string;
  runAsMemberId: string | null;
  supersetWorkspaceId: string | null;
  supersetTerminalId: string | null;
  supersetHostKey: string | null;
  status: string;
  lastProgress: string | null;
  workspaceReapedAt: Date | null;
  error: string | null;
  organizationId: string;
  threadProjectId: string;
  rootMessageId: string;
}

const sessionViewColumns = {
  id: threadSessions.id,
  threadId: threadSessions.threadId,
  projectId: threadSessions.projectId,
  agentMemberId: threadSessions.agentMemberId,
  role: threadSessions.role,
  runAsMemberId: threadSessions.runAsMemberId,
  supersetWorkspaceId: threadSessions.supersetWorkspaceId,
  supersetTerminalId: threadSessions.supersetTerminalId,
  supersetHostKey: threadSessions.supersetHostKey,
  status: threadSessions.status,
  lastProgress: threadSessions.lastProgress,
  workspaceReapedAt: threadSessions.workspaceReapedAt,
  error: threadSessions.error,
  organizationId: threads.organizationId,
  threadProjectId: threads.projectId,
  rootMessageId: threads.rootMessageId,
};

async function sessionById(sessionId: string): Promise<SessionView | null> {
  const [row] = await db
    .select(sessionViewColumns)
    .from(threadSessions)
    .innerJoin(threads, eq(threadSessions.threadId, threads.id))
    .where(eq(threadSessions.id, sessionId))
    .limit(1);
  return row ?? null;
}

async function sessionForAgent(
  threadId: string,
  agentMemberId: string,
): Promise<SessionView | null> {
  const [row] = await db
    .select(sessionViewColumns)
    .from(threadSessions)
    .innerJoin(threads, eq(threadSessions.threadId, threads.id))
    .where(
      and(
        eq(threadSessions.threadId, threadId),
        eq(threadSessions.agentMemberId, agentMemberId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function askingSession(
  threadId: string,
): Promise<SessionView | null> {
  const rows = await db
    .select(sessionViewColumns)
    .from(threadSessions)
    .innerJoin(threads, eq(threadSessions.threadId, threads.id))
    .where(
      and(
        eq(threadSessions.threadId, threadId),
        inArray(threadSessions.status, ["running", "starting", "needs_input"]),
      ),
    )
    .orderBy(desc(threadSessions.startedAt))
    .limit(1);

  return rows[0] ?? (await mainSession(threadId));
}

async function mainSession(threadId: string): Promise<SessionView | null> {
  const [row] = await db
    .select(sessionViewColumns)
    .from(threadSessions)
    .innerJoin(threads, eq(threadSessions.threadId, threads.id))
    .where(
      and(
        eq(threadSessions.threadId, threadId),
        eq(threadSessions.role, "main"),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function sessionsOf(threadId: string): Promise<SessionView[]> {
  return db
    .select(sessionViewColumns)
    .from(threadSessions)
    .innerJoin(threads, eq(threadSessions.threadId, threads.id))
    .where(eq(threadSessions.threadId, threadId))
    .orderBy(desc(threadSessions.role), threadSessions.createdAt);
}

async function patch(
  sessionId: string,
  values: Partial<SelectThreadSession>,
): Promise<SessionView | null> {
  const [row] = await db
    .update(threadSessions)
    .set(values)
    .where(eq(threadSessions.id, sessionId))
    .returning({ id: threadSessions.id });
  if (!row) return null;
  return sessionById(row.id);
}

export async function patchLive(
  sessionId: string,
  values: Partial<SelectThreadSession>,
): Promise<SessionView | null> {
  const [row] = await db
    .update(threadSessions)
    .set(values)
    .where(
      and(
        eq(threadSessions.id, sessionId),
        notInArray(threadSessions.status, [...TERMINAL_STATUSES]),
      ),
    )
    .returning({ id: threadSessions.id });
  if (!row) return null;
  return sessionById(row.id);
}

function threadIdentity(session: SessionView): {
  id: string;
  organizationId: string;
  projectId: string;
  rootMessageId: string;
} {
  return {
    id: session.threadId,
    organizationId: session.organizationId,
    projectId: session.threadProjectId,
    rootMessageId: session.rootMessageId,
  };
}

async function bumpTurn(threadId: string): Promise<void> {
  await db
    .update(threads)
    .set({ turnCount: sql`${threads.turnCount} + 1` })
    .where(eq(threads.id, threadId));
}

async function publishThread(threadId: string, hops = 0): Promise<void> {
  const state = await threadPublishState(threadId);
  if (!state) return;

  const payload = {
    type: "thread" as const,
    thread: {
      id: state.id,
      projectId: state.projectId,
      rootMessageId: state.rootMessageId,
      status: state.status,
      lastProgress: state.lastProgress,
      error: state.error,
      startedAt: state.startedAt.toISOString(),
      endedAt: state.endedAt ? state.endedAt.toISOString() : null,
      waitingOn: state.waitingOn,
      completedAt: state.completedAt ? state.completedAt.toISOString() : null,
      completedByMemberId: state.completedByMemberId,
    },
  };
  await Promise.all([
    publish(threadChannelName(state.id), payload),
    publish(channelName(state.projectId), payload),
  ]);

  if (hops >= MAX_PUBLISH_HOPS) return;

  const asked = await db.query.delegations.findFirst({
    where: and(
      eq(delegations.childThreadId, threadId),
      eq(delegations.status, "open"),
    ),
    columns: { parentThreadId: true },
  });
  if (asked) await publishThread(asked.parentThreadId, hops + 1);
}

export async function markWaiting(args: {
  threadId: string;
  waitingOn: string;
}): Promise<void> {
  const session = await mainSession(args.threadId);
  if (!session) return;

  const row = await patch(session.id, {
    status: "waiting",
    lastProgress: `Waiting on @${args.waitingOn}…`,
    error: null,
  });
  if (row) await publishThread(row.threadId);
}

function ensureHostLink(hostKey: string, memberId: string): void {
  const key = linkKey(hostKey, memberId);
  const existing = hosts.get(key);
  if (existing && (existing.socket || existing.retryTimer)) return;

  const link: HostLink = existing ?? {
    hostKey,
    memberId,
    socket: null,
    attempts: 0,
    retryTimer: null,
    stopped: false,
  };
  link.stopped = false;
  hosts.set(key, link);

  void (async () => {
    const auth = await jwtForMember({ memberId, hostKey });
    if (auth.jwt === null) {
      await failHostSessions(key, auth.problem);
      return;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(eventsUrl(hostKey), {
        headers: { Authorization: `Bearer ${auth.jwt}` },
      } as unknown as string[]);
    } catch {
      scheduleHostRetry(key);
      return;
    }

    link.socket = socket;

    socket.onopen = () => {
      const current = hosts.get(key);
      if (current) current.attempts = 0;
    };

    socket.onmessage = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!isAgentLifecycle(parsed)) return;
      handleLifecycle(key, parsed.terminalId, parsed.eventType);
    };

    socket.onerror = () => {};

    socket.onclose = () => {
      const current = hosts.get(key);
      if (!current || current.stopped) return;
      current.socket = null;
      if (hasWatchesOn(key)) scheduleHostRetry(key);
      else hosts.delete(key);
    };
  })();
}

function hasWatchesOn(key: string): boolean {
  for (const watch of watches.values()) {
    if (linkKey(watch.hostKey, watch.memberId) === key) return true;
  }
  return false;
}

function scheduleHostRetry(key: string): void {
  const link = hosts.get(key);
  if (!link || link.stopped) return;

  if (link.attempts >= MAX_ATTEMPTS) {
    void failHostSessions(
      key,
      "That machine is offline — Roster stopped waiting for it.",
    );
    hosts.delete(key);
    return;
  }

  const delay = Math.min(BASE_BACKOFF_MS * 2 ** link.attempts, MAX_BACKOFF_MS);
  link.attempts += 1;
  link.retryTimer = setTimeout(() => {
    const current = hosts.get(key);
    if (current) current.retryTimer = null;
    if (hasWatchesOn(key)) ensureHostLink(link.hostKey, link.memberId);
  }, delay);
}

async function failHostSessions(key: string, reason: string): Promise<void> {
  const affected = [...watches.values()].filter(
    (watch) => linkKey(watch.hostKey, watch.memberId) === key,
  );
  for (const watch of affected) {
    await finish({ sessionId: watch.sessionId, status: "failed", error: reason });
  }
}

function handleLifecycle(
  key: string,
  terminalId: string,
  eventType: string,
): void {
  const sessionId = byTerminal.get(terminalId);
  if (!sessionId) return;

  const watch = watches.get(sessionId);
  if (!watch) return;
  if (linkKey(watch.hostKey, watch.memberId) !== key) return;

  if (eventType === "Failed") {
    void finish({
      sessionId,
      status: "failed",
      error: "The agent stopped with an error.",
      capture: true,
    });
    return;
  }

  if (eventType === "Start") {
    watch.lastStartAt = Date.now();
    void wake(sessionId);
    return;
  }

  if (eventType === "PermissionRequest") {
    void askForInput(sessionId);
    return;
  }

  if (eventType === "Stop" || eventType === "Detached") {
    watch.lastStopAt = Date.now();
    void settle(sessionId);
  }
}

/** The agent's last turn of speech, or null if its output cannot be read. */
async function captureReply(
  session: SessionView,
  watch: Watch,
): Promise<string | null> {
  try {
    const connection = await hostConnection(session);
    const transcript = await readTranscript({
      jwt: connection.jwt,
      routingKey: watch.hostKey,
      workspaceId: watch.workspaceId,
      terminalId: watch.terminalId,
    });
    return agentReply(transcript.text);
  } catch {
    return null;
  }
}

/** The agent is working again — clear needs_input, or revive an idle session. */
async function wake(sessionId: string): Promise<void> {
  const session = await sessionById(sessionId);
  if (!session) return;

  const watch = watches.get(sessionId);
  if (watch && watch.restingSince !== null) activateWatch(watch);

  const status = await statusAfter(session, "Start");
  if (status === null) return;

  const row = await patch(sessionId, { status, endedAt: null, error: null });
  if (row) await publishThread(row.threadId);
}

/**
 * The agent has stopped to ask someone something. Post the question so it is
 * in the thread and the people following it are told, then park at needs_input
 * until somebody answers.
 */
async function askForInput(sessionId: string): Promise<void> {
  const watch = watches.get(sessionId);
  const session = await sessionById(sessionId);
  if (!session || !watch) return;

  const status = await statusAfter(session, "PermissionRequest");
  if (status === null) return;

  const question = await captureReply(session, watch);

  const row = await patch(sessionId, { status });
  if (!row) return;

  if (question && question.trim().length > 0) {
    await persistAgentMessage({
      sessionId,
      thread: threadIdentity(row),
      text: question,
      agentMemberId: row.agentMemberId,
      agentChannelId: row.projectId,
    });
  }

  await publishThread(row.threadId);
}

/**
 * The agent's terminal has gone quiet. A session parked on a delegate stays
 * parked — the quiet is what parking means — but the turn still ended, and
 * what the agent said before handing the work over belongs in the thread.
 */
export async function endTurn(
  session: SessionView,
  event: LifecycleEvent,
): Promise<void> {
  const status = await statusAfter(session, event);
  if (status === null && !isParked(session.status)) return;

  await finish({
    sessionId: session.id,
    status: status ?? PARKED,
    error: null,
    capture: true,
  });
}

async function settle(sessionId: string): Promise<void> {
  const watch = watches.get(sessionId);
  if (!watch) return;
  const stoppedAt = watch.lastStopAt;

  await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));

  const current = watches.get(sessionId);
  if (!current || current.lastStopAt !== stoppedAt) return;
  if (current.lastStartAt > stoppedAt) return;

  const session = await sessionById(sessionId);
  if (!session || isTerminal(session.status)) return;

  await endTurn(session, "Stop");
}

async function pollOnce(sessionId: string): Promise<void> {
  const watch = watches.get(sessionId);
  if (!watch) return;

  const session = await sessionById(sessionId);
  if (!session || isTerminal(session.status)) {
    stopWatch(sessionId);
    return;
  }

  let text: string;
  let jwt: string;
  try {
    const connection = await hostConnection(session);
    jwt = connection.jwt;
    const transcript = await readTranscript({
      jwt: connection.jwt,
      routingKey: watch.hostKey,
      workspaceId: watch.workspaceId,
      terminalId: watch.terminalId,
    });
    text = transcript.text;
  } catch (cause) {
    const reason = humanSessionError(cause, {
      fallback: "Could not read the agent's output.",
      retrying: true,
    });
    console.warn(
      `[sessions] transcript poll failed for ${sessionId}: ${sessionErrorDetail(cause)}`,
    );
    if (workspaceAlreadyGone(cause)) {
      await finish({ sessionId, status: "failed", error: reason });
      return;
    }
    if (session.error !== reason) {
      const row = await patch(sessionId, { error: reason });
      if (row) await publishThread(row.threadId);
    }
    return;
  }

  const now = Date.now();
  if (text !== watch.transcript) {
    watch.transcript = text;
    watch.transcriptChangedAt = now;
  }

  let bound = true;
  try {
    const bindings = await listAgentBindings({
      jwt,
      routingKey: watch.hostKey,
      workspaceId: watch.workspaceId,
    });
    const binding = bindings.find((b) => b.terminalId === watch.terminalId);
    if (bindingIsIdle(binding, SETTLE_DELAY_MS)) {
      if (pendingSteers.has(sessionId)) {
        await drainSteers(sessionId);
        return;
      }
      await endTurn(session, "Stop");
      return;
    }
    bound = binding !== undefined;
    const eventAt = binding?.lastEventAt ?? null;
    if (eventAt !== watch.bindingEventAt) {
      watch.bindingEventAt = eventAt;
      watch.bindingChangedAt = now;
    }
  } catch (cause) {
    console.warn(
      `[sessions] binding check failed for ${sessionId}: ${sessionErrorDetail(cause)}`,
    );
  }

  if (
    agentIsGone({
      now,
      bound,
      transcriptChangedAt: watch.transcriptChangedAt,
      bindingChangedAt: watch.bindingChangedAt,
      timeoutMs: STALENESS_TIMEOUT_MS,
    })
  ) {
    console.warn(
      `[sessions] nothing has been bound to ${sessionId}'s terminal for ${STALENESS_TIMEOUT_MS}ms and it wrote nothing — ending it`,
    );
    await endTurn(session, "Stop");
    return;
  }

  const line = lastMeaningfulLine(text);
  const progressed =
    !isParked(session.status) &&
    line !== null &&
    line !== watch.lastProgress &&
    now - watch.lastWriteAt >= WRITE_INTERVAL_MS;
  const recovered = session.error !== null;

  if (!progressed && !recovered) return;

  const values: Partial<SelectThreadSession> = {};
  if (recovered) values.error = null;
  if (progressed && line !== null) {
    watch.lastProgress = line;
    watch.lastWriteAt = now;
    values.lastProgress = line;
    values.transcriptOffset = text.length;
  }

  const row = await patch(sessionId, values);
  if (row) await publishThread(row.threadId);
}

function startWatch(args: {
  sessionId: string;
  threadId: string;
  hostKey: string;
  memberId: string;
  workspaceId: string;
  terminalId: string;
}): void {
  stopWatch(args.sessionId);

  const watch: Watch = {
    sessionId: args.sessionId,
    threadId: args.threadId,
    hostKey: args.hostKey,
    memberId: args.memberId,
    workspaceId: args.workspaceId,
    terminalId: args.terminalId,
    pollTimer: null,
    lastWriteAt: 0,
    lastProgress: null,
    lastStartAt: 0,
    lastStopAt: 0,
    transcript: null,
    transcriptChangedAt: Date.now(),
    bindingEventAt: null,
    bindingChangedAt: Date.now(),
    restingSince: null,
  };
  watches.set(args.sessionId, watch);
  byTerminal.set(args.terminalId, args.sessionId);

  watch.pollTimer = setInterval(() => {
    void pollOnce(args.sessionId);
  }, POLL_INTERVAL_MS);

  ensureHostLink(args.hostKey, args.memberId);
  void pollOnce(args.sessionId);
}

/**
 * A turn ended at idle, but the harness may still be running sub-agents or
 * background tasks that re-invoke the agent when they finish. Keep the watch
 * alive at a slow cadence so that later work still lands in the thread,
 * instead of vanishing into a terminal nobody reads.
 */
function restWatch(watch: Watch): void {
  if (watch.pollTimer) clearInterval(watch.pollTimer);
  watch.restingSince = Date.now();
  watch.pollTimer = setInterval(() => {
    void restPollOnce(watch.sessionId);
  }, REST_POLL_INTERVAL_MS);
}

function activateWatch(watch: Watch): void {
  if (watch.pollTimer) clearInterval(watch.pollTimer);
  const now = Date.now();
  watch.restingSince = null;
  watch.transcriptChangedAt = now;
  watch.bindingChangedAt = now;
  watch.pollTimer = setInterval(() => {
    void pollOnce(watch.sessionId);
  }, POLL_INTERVAL_MS);
}

export function restAction(args: {
  restingSince: number;
  now: number;
  transcriptChanged: boolean;
  bindingActive: boolean;
}): "wake" | "stop" | "sleep" {
  if (args.transcriptChanged || args.bindingActive) return "wake";
  if (args.now - args.restingSince >= REST_TTL_MS) return "stop";
  return "sleep";
}

async function restPollOnce(sessionId: string): Promise<void> {
  const watch = watches.get(sessionId);
  if (!watch || watch.restingSince === null) return;

  const session = await sessionById(sessionId);
  if (!session || isTerminal(session.status)) {
    stopWatch(sessionId);
    return;
  }
  if (isParked(session.status)) {
    stopWatch(sessionId);
    return;
  }
  if (!isIdle(session.status)) {
    activateWatch(watch);
    return;
  }

  let transcriptChanged = false;
  let bindingActive = false;
  try {
    const connection = await hostConnection(session);
    const transcript = await readTranscript({
      jwt: connection.jwt,
      routingKey: watch.hostKey,
      workspaceId: watch.workspaceId,
      terminalId: watch.terminalId,
    });
    transcriptChanged =
      watch.transcript !== null && transcript.text !== watch.transcript;
    watch.transcript = transcript.text;

    const bindings = await listAgentBindings({
      jwt: connection.jwt,
      routingKey: watch.hostKey,
      workspaceId: watch.workspaceId,
    });
    const binding = bindings.find((b) => b.terminalId === watch.terminalId);
    bindingActive =
      binding !== undefined && !bindingIsIdle(binding, SETTLE_DELAY_MS);
  } catch (cause) {
    console.warn(
      `[sessions] rest poll failed for ${sessionId}: ${sessionErrorDetail(cause)}`,
    );
    if (workspaceAlreadyGone(cause)) stopWatch(sessionId);
    return;
  }

  const action = restAction({
    restingSince: watch.restingSince,
    now: Date.now(),
    transcriptChanged,
    bindingActive,
  });
  if (action === "stop") {
    stopWatch(sessionId);
    return;
  }
  if (action === "wake") await wake(sessionId);
}

function stopWatch(sessionId: string): void {
  const watch = watches.get(sessionId);
  if (!watch) return;
  if (watch.pollTimer) clearInterval(watch.pollTimer);
  byTerminal.delete(watch.terminalId);
  watches.delete(sessionId);

  const key = linkKey(watch.hostKey, watch.memberId);
  if (!hasWatchesOn(key)) {
    const link = hosts.get(key);
    if (link) {
      link.stopped = true;
      if (link.retryTimer) clearTimeout(link.retryTimer);
      try {
        link.socket?.close();
      } catch {}
      hosts.delete(key);
    }
  }
}

interface FinishOutcome {
  resumeWith: string | null;
}

const NOTHING_TO_RESUME: FinishOutcome = { resumeWith: null };

async function finish(args: {
  sessionId: string;
  status: ThreadStatus;
  error?: string | null;
  capture?: boolean;
  evenIfParked?: boolean;
}): Promise<void> {
  if (finishing.has(args.sessionId)) return;
  finishing.add(args.sessionId);

  let outcome: FinishOutcome = NOTHING_TO_RESUME;
  try {
    outcome = await finishOnce(args);
  } finally {
    finishing.delete(args.sessionId);
  }

  if (outcome.resumeWith === null) return;

  console.warn(
    `[sessions] turn ended with queued work for ${args.sessionId} — starting the next turn with it`,
  );
  await resume({ sessionId: args.sessionId, text: outcome.resumeWith });
}

async function finishOnce(args: {
  sessionId: string;
  status: ThreadStatus;
  error?: string | null;
  capture?: boolean;
  evenIfParked?: boolean;
}): Promise<FinishOutcome> {
  const watch = watches.get(args.sessionId);
  const session = await sessionById(args.sessionId);
  if (!session || isTerminal(session.status)) {
    stopWatch(args.sessionId);
    if (session) await reportUndelivered(args.sessionId, "that session had already ended.");
    else pendingSteers.delete(args.sessionId);
    return NOTHING_TO_RESUME;
  }

  const finalText =
    args.capture && watch ? await captureReply(session, watch) : null;

  if (args.status === "idle" && watch && !isParked(session.status)) {
    restWatch(watch);
  } else {
    stopWatch(args.sessionId);
  }
  const queued = takeSteers(args.sessionId);

  if (isParked(session.status) && !args.evenIfParked) {
    if (finalText && finalText.trim().length > 0) {
      await persistAgentMessage({
        sessionId: args.sessionId,
        thread: threadIdentity(session),
        text: finalText,
        agentMemberId: session.agentMemberId,
        agentChannelId: session.projectId,
      });
    }
    return await resumable(session, queued);
  }

  const values: Partial<SelectThreadSession> = {
    status: args.status,
    endedAt: new Date(),
  };
  if (args.error !== undefined) values.error = args.error;

  const row = await patchLive(args.sessionId, values);
  if (!row) {
    await reportUndelivered(args.sessionId, "that session is gone.", queued);
    return NOTHING_TO_RESUME;
  }

  const spoke =
    finalText !== null && finalText.trim().length > 0
      ? await persistAgentMessage({
          sessionId: args.sessionId,
          thread: threadIdentity(row),
          text: finalText,
          agentMemberId: row.agentMemberId,
          agentChannelId: row.projectId,
        })
      : false;

  await publishThread(row.threadId);

  if (args.status === "failed" && !spoke) {
    await notifyThreadFailed({
      threadId: row.threadId,
      sessionId: args.sessionId,
      reason: args.error ?? null,
    });
  }

  if (args.status === "canceled" && queued.length > 0) {
    await reportUndelivered(row.id, "that session was canceled.", queued);
    return NOTHING_TO_RESUME;
  }

  const outcome = await resumable(row, queued);
  if (outcome.resumeWith !== null) return outcome;

  await settleIfDelegated({
    threadId: row.threadId,
    agentMemberId: row.agentMemberId,
    reply: finalText ?? "",
    failed: args.status !== "completed",
  });

  return NOTHING_TO_RESUME;
}

function takeSteers(sessionId: string): string[] {
  const queue = pendingSteers.get(sessionId) ?? [];
  pendingSteers.delete(sessionId);
  return queue;
}

async function resumable(
  session: SessionView,
  queued: string[],
): Promise<FinishOutcome> {
  if (queued.length === 0) return NOTHING_TO_RESUME;

  const text = mergeSteers(queued);
  if (text.length === 0) return NOTHING_TO_RESUME;

  if (!session.supersetWorkspaceId || session.workspaceReapedAt) {
    await reportUndelivered(session.id, "its worktree is gone.", queued);
    return NOTHING_TO_RESUME;
  }

  return { resumeWith: text };
}

async function reportUndelivered(
  sessionId: string,
  reason: string,
  taken?: string[],
): Promise<void> {
  const queue = taken ?? takeSteers(sessionId);
  if (queue.length === 0) return;

  console.warn(
    `[sessions] ${queue.length} undelivered steer(s) for ${sessionId}: ${reason}`,
  );
  await recordSessionError(sessionId, undeliveredSteerNotice(queue.length, reason));
}

async function settleIfDelegated(args: {
  threadId: string;
  agentMemberId: string;
  reply: string;
  failed: boolean;
}): Promise<void> {
  try {
    const { settleDelegationFor } = await import("../delegations");
    await settleDelegationFor(args);
  } catch (cause) {
    console.warn(
      `[sessions] delegation settle failed for ${args.threadId}: ${sessionErrorDetail(cause)}`,
    );
  }
}

export async function persistAgentMessage(args: {
  sessionId: string;
  thread: {
    id: string;
    organizationId: string;
    projectId: string;
    rootMessageId: string;
  };
  text: string;
  agentMemberId?: string;
  agentChannelId?: string;
  dedupe?: boolean;
}): Promise<boolean> {
  const { thread, text } = args;
  const agentChannelId = args.agentChannelId ?? thread.projectId;
  const agentMemberId =
    args.agentMemberId ?? (await sessionById(args.sessionId))?.agentMemberId;

  if (args.dedupe !== false) {
    const existing = await db.query.messages.findFirst({
      where: and(
        eq(messages.threadId, thread.id),
        eq(messages.kind, "agent"),
        agentMemberId
          ? eq(messages.authorMemberId, agentMemberId)
          : isNull(messages.authorMemberId),
      ),
      orderBy: desc(messages.seq),
    });
    if (existing?.text === text) return false;
  }

  const clientId =
    args.dedupe === false
      ? null
      : `agent:${args.sessionId}:${createHash("sha256")
          .update(text)
          .digest("base64url")
          .slice(0, 22)}`;

  const seq = await allocateSeq(thread.projectId);
  const [row] = await db
    .insert(messages)
    .values({
      organizationId: thread.organizationId,
      projectId: thread.projectId,
      seq,
      authorMemberId: agentMemberId ?? null,
      kind: "agent",
      agentChannelId,
      body: markdownToTiptap(text),
      text,
      threadId: thread.id,
      parentMessageId: thread.rootMessageId,
      clientId,
    })
    .onConflictDoNothing({ target: [messages.projectId, messages.clientId] })
    .returning();

  if (!row) return false;

  await emitMessageById(row.id);
  return true;
}

async function briefedPrompt(args: {
  session: SessionView;
  request: string;
  context?: string[];
  delegation?: DelegationContext;
}): Promise<string> {
  const [agent, task] = await Promise.all([
    agentById(args.session.agentMemberId),
    taskForThread(args.session.threadId),
  ]);

  const envelope = rosterEnvelope({
    threadId: args.session.threadId,
    channelId: args.session.projectId,
    handle: agent?.handle ?? "agent",
    brief: agent?.brief ?? null,
    delegation: args.delegation,
    task: task
      ? { id: task.id, title: task.title, status: task.status }
      : undefined,
  });

  return `${envelope}\n\n${sessionPrompt({
    context: args.context ?? [],
    request: args.request,
  })}`;
}

export async function startSession(args: {
  threadId: string;
  text: string;
  context?: string[];
  delegation?: DelegationContext;
}): Promise<void> {
  const session = await mainSession(args.threadId);
  if (!session) return;

  await startSessionRow({ session, ...args });
}

export async function joinThread(args: {
  threadId: string;
  agentMemberId: string;
  projectId: string;
  text: string;
  delegation?: DelegationContext;
}): Promise<boolean> {
  await ensureStarted();

  const host = await askingSession(args.threadId);
  if (!host?.supersetWorkspaceId || !host.supersetHostKey) return false;
  if (host.workspaceReapedAt) return false;

  const existing = await sessionForAgent(args.threadId, args.agentMemberId);
  const session =
    existing ??
    (await (async () => {
      const [row] = await db
        .insert(threadSessions)
        .values({
          threadId: args.threadId,
          projectId: args.projectId,
          agentMemberId: args.agentMemberId,
          role: "delegate",
          runAsMemberId: host.runAsMemberId,
          status: "starting",
        })
        .onConflictDoNothing({
          target: [threadSessions.threadId, threadSessions.agentMemberId],
        })
        .returning({ id: threadSessions.id });

      return row
        ? await sessionById(row.id)
        : await sessionForAgent(args.threadId, args.agentMemberId);
    })());

  if (!session) return false;

  await patch(session.id, { status: "starting", endedAt: null, error: null });

  await startSessionRow({
    session,
    text: args.text,
    delegation: args.delegation,
    shareWorkspace: {
      workspaceId: host.supersetWorkspaceId,
      hostKey: host.supersetHostKey,
    },
  });

  return true;
}

async function startSessionRow(args: {
  session: SessionView;
  text: string;
  context?: string[];
  delegation?: DelegationContext;
  shareWorkspace?: { workspaceId: string; hostKey: string };
}): Promise<void> {
  const { session } = args;

  await bumpTurn(session.threadId);

  try {
    const connection = await hostConnection(session);

    const workspace = args.shareWorkspace
      ? { id: args.shareWorkspace.workspaceId }
      : await createWorkspace({
          jwt: connection.jwt,
          routingKey: connection.hostKey,
          projectId: connection.project.supersetProjectId,
          namingPrompt: args.text,
        });
    const hostKey = args.shareWorkspace?.hostKey ?? connection.hostKey;

    await patch(session.id, {
      supersetWorkspaceId: workspace.id,
      supersetHostKey: hostKey,
    });

    const prompt = await briefedPrompt({
      session,
      request: args.text,
      context: args.context,
      delegation: args.delegation,
    });

    const run = await runAgent({
      jwt: connection.jwt,
      routingKey: hostKey,
      workspaceId: workspace.id,
      prompt,
    });

    const current = await sessionById(session.id);
    if (current && isTerminal(current.status)) {
      console.warn(
        `[sessions] ${session.id} was ${current.status} before its agent came up — not reviving it`,
      );
      await patch(session.id, { supersetTerminalId: run.sessionId });
      await reportUndelivered(session.id, `that session was ${current.status}.`);
      return;
    }

    const running = await patch(session.id, {
      supersetTerminalId: run.sessionId,
      status: "running",
      error: null,
    });
    if (running) await publishThread(running.threadId);

    startWatch({
      sessionId: session.id,
      threadId: session.threadId,
      hostKey,
      memberId: connection.memberId,
      workspaceId: workspace.id,
      terminalId: run.sessionId,
    });

    void drainWhenReady(session.id).catch((cause: unknown) => {
      console.warn(
        `[sessions] drain-on-start failed for ${session.id}: ${sessionErrorDetail(cause)}`,
      );
    });
  } catch (cause) {
    console.warn(
      `[sessions] start failed for ${session.id}: ${sessionErrorDetail(cause)}`,
    );
    await reportUndelivered(session.id, "that session never started.");
    await finish({
      sessionId: session.id,
      status: "failed",
      error: humanSessionError(cause, {
        fallback: "Could not start a session on that machine.",
      }),
    });
  }
}

function queueSteer(sessionId: string, text: string): void {
  const queue = pendingSteers.get(sessionId) ?? [];
  queue.push(text);
  pendingSteers.set(sessionId, queue);
  console.warn(`[sessions] queued steer for ${sessionId} (${queue.length})`);
}

async function drainWhenReady(sessionId: string): Promise<void> {
  const deadline = Date.now() + STEER_READY_TIMEOUT_MS;

  while (pendingSteers.has(sessionId)) {
    const watch = watches.get(sessionId);
    if (!watch) return;

    const session = await sessionById(sessionId);
    if (!session || isTerminal(session.status)) return;

    if (await terminalIsListening(session, watch)) {
      await drainSteers(sessionId);
      return;
    }

    if (Date.now() >= deadline) {
      console.warn(
        `[sessions] agent never came up for ${sessionId} — queued steer(s) left for the watch`,
      );
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, STEER_READY_INTERVAL_MS));
  }
}

async function terminalIsListening(
  session: SessionView,
  watch: Watch,
): Promise<boolean> {
  try {
    const connection = await hostConnection(session);
    const bindings = await listAgentBindings({
      jwt: connection.jwt,
      routingKey: watch.hostKey,
      workspaceId: watch.workspaceId,
    });
    const binding = bindings.find((b) => b.terminalId === watch.terminalId);
    return bindingIsIdle(binding, SETTLE_DELAY_MS);
  } catch {
    return false;
  }
}

async function drainSteers(sessionId: string): Promise<void> {
  const queue = takeSteers(sessionId);
  if (queue.length === 0) return;
  console.warn(`[sessions] draining ${queue.length} steer(s) for ${sessionId}`);

  for (let index = 0; index < queue.length; index += 1) {
    const text = queue[index] as string;

    let delivered = false;
    try {
      delivered = await interrupt({ sessionId, text });
    } catch (cause) {
      console.warn(
        `[sessions] drain failed for ${sessionId}: ${sessionErrorDetail(cause)}`,
      );
    }

    if (!delivered) {
      requeueSteers(sessionId, queue.slice(index));
      return;
    }
  }
}

function requeueSteers(sessionId: string, texts: string[]): void {
  if (texts.length === 0) return;
  const queue = pendingSteers.get(sessionId) ?? [];
  pendingSteers.set(sessionId, [...texts, ...queue]);
  console.warn(
    `[sessions] ${texts.length} steer(s) held for ${sessionId} — still undelivered`,
  );
}

async function interrupt(args: {
  sessionId: string;
  text: string;
}): Promise<boolean> {
  const session = await sessionById(args.sessionId);
  if (!session) return false;

  if (!session.supersetTerminalId || !session.supersetWorkspaceId) {
    if (isTerminal(session.status)) {
      if (session.supersetWorkspaceId && !session.workspaceReapedAt) {
        await resume({ sessionId: args.sessionId, text: args.text });
        return true;
      }
      await recordSessionError(
        args.sessionId,
        undeliveredSteerNotice(1, "that session had already ended."),
      );
      return true;
    }
    return false;
  }

  try {
    const connection = await hostConnection(session);
    await sendToAgent({
      jwt: connection.jwt,
      routingKey: connection.hostKey,
      workspaceId: session.supersetWorkspaceId,
      terminalId: session.supersetTerminalId,
      text: args.text,
    });

    const watch = watches.get(args.sessionId);
    if (watch) watch.lastStartAt = Date.now();

    const row = await patch(args.sessionId, {
      status: "running",
      error: null,
    });
    if (row) await publishThread(row.threadId);

    if (!watches.has(args.sessionId)) {
      startWatch({
        sessionId: session.id,
        threadId: session.threadId,
        hostKey: connection.hostKey,
        memberId: connection.memberId,
        workspaceId: session.supersetWorkspaceId,
        terminalId: session.supersetTerminalId,
      });
    }

    return true;
  } catch (cause) {
    console.warn(
      `[sessions] steer failed for ${args.sessionId}: ${sessionErrorDetail(cause)}`,
    );
    const row = await patch(args.sessionId, {
      error: humanSessionError(cause, {
        fallback: "Could not reach the running session.",
      }),
    });
    if (row) await publishThread(row.threadId);
    return false;
  }
}

async function resume(args: {
  sessionId: string;
  text: string;
}): Promise<void> {
  const session = await sessionById(args.sessionId);
  if (!session?.supersetWorkspaceId || session.workspaceReapedAt) {
    await recordSessionError(
      args.sessionId,
      "That session has no worktree left to reply into.",
    );
    return;
  }

  const revived = await patch(args.sessionId, {
    status: "running",
    endedAt: null,
    error: null,
  });
  if (revived) await publishThread(revived.threadId);

  try {
    const connection = await hostConnection(session);
    let terminalId = session.supersetTerminalId;

    if (terminalId) {
      try {
        await sendToAgent({
          jwt: connection.jwt,
          routingKey: connection.hostKey,
          workspaceId: session.supersetWorkspaceId,
          terminalId,
          text: args.text,
        });
      } catch {
        terminalId = null;
      }
    }

    if (!terminalId) {
      const run = await runAgent({
        jwt: connection.jwt,
        routingKey: connection.hostKey,
        workspaceId: session.supersetWorkspaceId,
        prompt: await briefedPrompt({ session, request: args.text }),
      });
      terminalId = run.sessionId;
      await patch(args.sessionId, { supersetTerminalId: terminalId });
    }

    startWatch({
      sessionId: session.id,
      threadId: session.threadId,
      hostKey: connection.hostKey,
      memberId: connection.memberId,
      workspaceId: session.supersetWorkspaceId,
      terminalId,
    });

    const watch = watches.get(args.sessionId);
    if (watch) watch.lastStartAt = Date.now();
  } catch (cause) {
    console.warn(
      `[sessions] resume failed for ${args.sessionId}: ${sessionErrorDetail(cause)}`,
    );
    await finish({
      sessionId: args.sessionId,
      status: "failed",
      error: humanSessionError(cause, {
        fallback: "Could not reach that machine to continue the session.",
      }),
    });
  }
}

async function recordSessionError(
  sessionId: string,
  reason: string,
): Promise<void> {
  const row = await patch(sessionId, { error: reason });
  if (row) await publishThread(row.threadId);
}

export async function steer(args: {
  threadId: string;
  text: string;
  agentMemberId?: string;
}): Promise<void> {
  await ensureStarted();

  const session = args.agentMemberId
    ? await sessionForAgent(args.threadId, args.agentMemberId)
    : await mainSession(args.threadId);
  if (!session) return;

  await bumpTurn(session.threadId);

  // An idle session has no agent listening, so it needs restarting rather
  // than typing into. A needs_input one is listening — interrupt types the
  // answer straight into the prompt it is blocked on.
  if (
    isTerminal(session.status) ||
    isParked(session.status) ||
    isIdle(session.status)
  ) {
    await resume({ sessionId: session.id, text: args.text });
    return;
  }

  const delivered = await interrupt({ sessionId: session.id, text: args.text });
  if (!delivered) queueSteer(session.id, args.text);
}

async function retryPrompt(session: SessionView): Promise<string> {
  const latest = await db.query.messages.findFirst({
    where: and(
      eq(messages.threadId, session.threadId),
      eq(messages.kind, "user"),
    ),
    orderBy: desc(messages.seq),
  });
  const text = latest?.text?.trim();
  if (latest && text && text.length > 0) {
    const files = await attachmentsForMessages([latest.id]);
    return textWithAttachments(text, files.get(latest.id) ?? []);
  }

  const root = await db.query.messages.findFirst({
    where: eq(messages.id, session.rootMessageId),
  });
  const rootText = root?.text?.trim();
  return rootText && rootText.length > 0 ? rootText : "Continue.";
}

async function reattach(session: SessionView): Promise<void> {
  const workspaceId = session.supersetWorkspaceId;
  if (!workspaceId) return;

  try {
    const connection = await hostConnection(session);
    let terminalId = session.supersetTerminalId;

    if (terminalId) {
      try {
        await readTranscript({
          jwt: connection.jwt,
          routingKey: connection.hostKey,
          workspaceId,
          terminalId,
        });
      } catch {
        terminalId = null;
      }
    }

    if (!terminalId) {
      const run = await runAgent({
        jwt: connection.jwt,
        routingKey: connection.hostKey,
        workspaceId,
        prompt: await briefedPrompt({
          session,
          request: await retryPrompt(session),
        }),
      });
      terminalId = run.sessionId;
      await patch(session.id, { supersetTerminalId: terminalId });
    }

    startWatch({
      sessionId: session.id,
      threadId: session.threadId,
      hostKey: connection.hostKey,
      memberId: connection.memberId,
      workspaceId,
      terminalId,
    });

    const watch = watches.get(session.id);
    if (watch) watch.lastStartAt = Date.now();
  } catch (cause) {
    console.warn(
      `[sessions] retry failed for ${session.id}: ${sessionErrorDetail(cause)}`,
    );
    await finish({
      sessionId: session.id,
      status: "failed",
      error: humanSessionError(cause, {
        fallback: "Could not reach that machine to retry the session.",
      }),
    });
  }
}

export async function cancelThread(args: {
  threadId: string;
}): Promise<boolean> {
  await ensureStarted();

  return cancelThreadTree(args.threadId, new Set());
}

async function cancelThreadTree(
  threadId: string,
  seen: Set<string>,
): Promise<boolean> {
  if (seen.has(threadId)) return false;
  seen.add(threadId);

  for (const childThreadId of await closeOpenDelegations(threadId)) {
    await cancelThreadTree(childThreadId, seen);
  }

  const sessions = await sessionsOf(threadId);
  const live = sessions.filter((session) => !isTerminal(session.status));
  if (live.length === 0) return false;

  for (const session of live) {
    await cancelSession(session);
  }

  return true;
}

async function closeOpenDelegations(parentThreadId: string): Promise<string[]> {
  const closed = await db
    .update(delegations)
    .set({ status: "canceled", answeredAt: new Date() })
    .where(
      and(
        eq(delegations.parentThreadId, parentThreadId),
        eq(delegations.status, "open"),
      ),
    )
    .returning({ childThreadId: delegations.childThreadId });

  return closed
    .map((row) => row.childThreadId)
    .filter((childThreadId): childThreadId is string => childThreadId !== null);
}

async function cancelSession(session: SessionView): Promise<void> {
  if (session.supersetWorkspaceId && session.supersetTerminalId) {
    try {
      const connection = await hostConnection(session);
      await interruptAgent({
        jwt: connection.jwt,
        routingKey: session.supersetHostKey ?? connection.hostKey,
        workspaceId: session.supersetWorkspaceId,
        terminalId: session.supersetTerminalId,
      });
      await clearWorkspaceStatuses({
        jwt: connection.jwt,
        routingKey: session.supersetHostKey ?? connection.hostKey,
        workspaceId: session.supersetWorkspaceId,
        terminalId: session.supersetTerminalId,
      });
    } catch (cause) {
      console.warn(
        `[sessions] cancel on host failed for ${session.id}: ${sessionErrorDetail(cause)}`,
      );
    }
  }

  await finish({
    sessionId: session.id,
    status: "canceled",
    error: null,
    evenIfParked: true,
  });
}

export async function reapThread(args: { threadId: string }): Promise<void> {
  const sessions = await sessionsOf(args.threadId);
  const reaped = new Set<string>();

  for (const session of sessions) {
    stopWatch(session.id);
    pendingSteers.delete(session.id);

    const workspaceId = session.supersetWorkspaceId;
    if (!workspaceId || session.workspaceReapedAt) continue;

    if (!reaped.has(workspaceId)) {
      try {
        const connection = await hostConnection(session);
        await deleteWorkspace({
          jwt: connection.jwt,
          routingKey: session.supersetHostKey ?? connection.hostKey,
          workspaceId,
        });
      } catch (cause) {
        console.warn(
          `[sessions] reap failed for ${session.id}: ${sessionErrorDetail(cause)}`,
        );
        continue;
      }
      reaped.add(workspaceId);
    }

    await patch(session.id, { workspaceReapedAt: new Date() });
  }
}

export function workspaceSurvivedReap(session: {
  supersetWorkspaceId: string | null;
  workspaceReapedAt: Date | null;
}): boolean {
  return session.supersetWorkspaceId !== null && !session.workspaceReapedAt;
}

export async function assertReaped(args: { threadId: string }): Promise<void> {
  const sessions = await sessionsOf(args.threadId);
  const survived = sessions.filter(workspaceSurvivedReap);
  if (survived.length === 0) return;

  throw new Error(
    `${survived.length} workspace${survived.length === 1 ? "" : "s"} for thread ${args.threadId} outlived the reap`,
  );
}

export async function completeThread(args: {
  threadId: string;
  memberId: string;
}): Promise<void> {
  const [thread] = await db
    .update(threads)
    .set({ completedAt: new Date(), completedByMemberId: args.memberId })
    .where(eq(threads.id, args.threadId))
    .returning({ rootMessageId: threads.rootMessageId });

  if (!thread) return;

  await addReaction({
    messageId: thread.rootMessageId,
    memberId: args.memberId,
    emoji: COMPLETE_EMOJI,
  });

  await archiveEphemeralAgentsFor(args.threadId);

  await publishThread(args.threadId);
}

export async function retryThread(args: {
  threadId: string;
}): Promise<boolean> {
  await ensureStarted();

  const session = await mainSession(args.threadId);
  if (!session) return false;
  if (!session.supersetWorkspaceId || session.workspaceReapedAt) {
    await recordSessionError(
      session.id,
      "That session has no worktree left to retry.",
    );
    return false;
  }

  stopWatch(session.id);

  const revived = await patch(session.id, {
    status: "running",
    endedAt: null,
    error: null,
  });
  if (revived) await publishThread(revived.threadId);

  void reattach(revived ?? session).catch(() => {});

  return true;
}

export function ensureStarted(): Promise<void> {
  if (started) return Promise.resolve();
  if (starting) return starting;

  starting = (async () => {
    const rows = await db
      .select(sessionViewColumns)
      .from(threadSessions)
      .innerJoin(threads, eq(threadSessions.threadId, threads.id))
      .where(inArray(threadSessions.status, ["starting", "running"]));
    started = true;
    for (const row of rows) {
      if (
        !row.supersetTerminalId ||
        !row.supersetWorkspaceId ||
        !row.supersetHostKey
      ) {
        continue;
      }

      if (!row.runAsMemberId) {
        await finish({ sessionId: row.id, status: "failed", error: NO_MEMBER });
        continue;
      }

      startWatch({
        sessionId: row.id,
        threadId: row.threadId,
        hostKey: row.supersetHostKey,
        memberId: row.runAsMemberId,
        workspaceId: row.supersetWorkspaceId,
        terminalId: row.supersetTerminalId,
      });
    }
  })().catch(() => {
    started = true;
  });

  return starting;
}

export async function createThread(args: {
  organizationId: string;
  projectId: string;
  rootMessageId: string;
  runAsMemberId?: string | null;
  agentMemberId?: string;
}): Promise<SelectThread | null> {
  const agentMemberId =
    args.agentMemberId ?? (await mainAgentFor(args.projectId))?.id;
  if (!agentMemberId) {
    throw new Error("That channel has no agent to open a thread with.");
  }

  const [row] = await db
    .insert(threads)
    .values({
      organizationId: args.organizationId,
      projectId: args.projectId,
      rootMessageId: args.rootMessageId,
    })
    .onConflictDoNothing({ target: threads.rootMessageId })
    .returning();

  if (!row) return null;

  await db
    .insert(threadSessions)
    .values({
      threadId: row.id,
      projectId: args.projectId,
      agentMemberId,
      role: "main",
      runAsMemberId: args.runAsMemberId ?? null,
      status: "starting",
    })
    .onConflictDoNothing({
      target: [threadSessions.threadId, threadSessions.agentMemberId],
    });

  await db
    .update(messages)
    .set({ threadId: row.id })
    .where(and(eq(messages.id, args.rootMessageId), isNull(messages.threadId)));

  await subscribeThreadAuthor({
    threadId: row.id,
    memberId: args.runAsMemberId,
  });

  await publishThread(row.id);

  return row;
}
