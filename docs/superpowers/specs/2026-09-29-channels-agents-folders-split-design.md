# Channels, agents, and folders become three things

Today `roster.projects` is one row playing two parts: it is the channel
(slug, visibility, watch, message sequence) and it is the folder (the
Superset project, host, and repo it maps to). A unique index on
`(org, superset_project_id)` makes the marriage permanent: one folder is
exactly one channel, forever (`packages/db/src/schema/roster.ts:54-57`).
Agents own nothing — they are `auth.members` rows pointing at a channel,
and every folder-shaped fact about an agent is borrowed through that
pointer.

This design splits them:

1. **Folder** — a Superset project on a host, connected by a member.
2. **Agent** — a worker. Every agent links to one folder, chosen from a
   dropdown in settings.
3. **Channel** — a conversation space. Freely creatable. Every channel
   names a **default agent**.

## Settled decisions

These were agreed in the design conversation and are not open:

- A message in a channel triggers the channel's default agent, which
  creates a worktree from *its* folder and responds in the thread —
  the trigger flow itself is unchanged.
- Mentioning another agent brings that agent into the **same thread**
  with its own session.
- Worktrees are scoped to the thread. When an agent enters a thread and
  its folder matches an agent already working there, it **joins that
  worktree** (preserving today's turn-about collaboration). Different
  folder → its own fresh worktree.
- Sessions run on the credentials of **whoever owns the folder** — the
  member whose Superset connection materialized it.
- Multiplayer (humans in the thread, steering, join window) is unchanged.

## Data model

### New table: `roster.folders`

| column | notes |
|---|---|
| `id` | pk |
| `organization_id` | FK, as on projects today |
| `superset_project_id` | unique with org — one folder row per Superset project |
| `superset_host_id`, `superset_org_id` | moved from `projects` |
| `owner_member_id` | FK → `auth.members`; whose Superset key runs sessions here |
| `repo_owner`, `repo_name`, `repo_url`, `repo_path` | moved from `projects`, display |
| `name` | display name, from the Superset project |
| timestamps | |

`owner_member_id` replaces `channelOwner()`
(`packages/api/src/services/delegations.ts:255-270`) as the credential
source, and is set to the connecting member in `saveProjects`.

### `roster.projects` (the channel) loses its folder half

- **Drop**: `superset_project_id`, `superset_host_id`, `superset_org_id`,
  `repo_*`, and the unique index on `(org, superset_project_id)`.
- **Keep**: `slug`, `name`, `visibility`, `watch_enabled`,
  `watch_paused_at`, `last_seq` — the per-channel message sequence
  (`channels.ts:321-330`) stays channel-scoped.
- **Add**: `default_agent_id` FK → `auth.members`, not null. The implicit
  "main agent = oldest in channel" rule (`agents.ts:123-139`, duplicated
  as raw SQL in `channels.ts:8-14`) is deleted in favor of this column.

### `auth.members` (agents)

- **Add**: `folder_id` FK → `roster.folders`, required for
  `type='agent'` rows.
- **Drop**: `project_id`. Agents are org-level, not channel property.
  With it goes the ON DELETE CASCADE that today deletes a channel's
  agents with the channel (migration `0012:6`), and the channel-derived
  handle prefix (`agentHandleFor`, `agents.ts:143-146`) — handles stay
  unique per org, but are free-form.

Every agent read that inner-joins `projects` for `channelSlug`/
`channelName` (`agents.ts:68, 98, 116, 129`) joins `folders` instead and
exposes folder name + repo.

### Lifecycle rules

- Creating a channel requires choosing (or creating) its default agent.
- Archiving an agent that is any channel's default is blocked until the
  channel is reassigned — the generalization of today's "main agent
  cannot be archived" (`agents.ts:225-232`).
- Deleting a folder with live agents is blocked.
- Deleting a channel no longer touches agents.
- `ensureChannelAgent` (`agents.ts:348-385`) becomes folder bootstrap:
  connecting a Superset project creates the folder and offers to create
  a channel + default agent named after it, which keeps onboarding
  one-step (`onboarding.ts:8-16` gates on "org has any project"; it
  gates on "org has any folder" instead).

## Message routing

`sendMessage` (`packages/api/src/services/messages.ts:258-345`) keeps
its gate (watch or mention) and join window, with one upgrade:
`mentionsAnyAgent` (`messages.ts:359-385`) currently returns a boolean
and throws away *which* agent was named — `@foo-pm` in chat starts
`@foo`. Now it resolves the mentioned agents:

- No mention, channel watching → default agent, exactly as today.
- Mention of agent X in a channel message → X runs the thread (even if X
  is not the default), because the author named who they wanted.
- Mention of agent Y inside an existing thread → Y joins that thread
  with its own session (`thread_sessions` already allows one session per
  agent per thread, `roster.ts:315-318`).

`roster ask` keeps its guards (depth 3, cycle detection, one open
delegation) and drops only its routing predicate — see next section.

## Sessions and worktrees

The tightest knot in the current code is that the folder is derived from
the channel everywhere a session touches a host:

- `hostConnection({ projectId })`
  (`packages/api/src/services/sessions/connection.ts:62-93`) resolves
  folder + routing key from the channel row, called from ~11 supervisor
  sites and the terminal service.
- `createWorkspace({ projectId: connection.project.supersetProjectId })`
  (`supervisor.ts:1257`) is where worktrees are born.
- `sameWorktree = target.projectId === parent.projectId`
  (`delegations.ts:147`) is the entire share-vs-fresh decision.

The re-keying:

- `hostConnection` takes the **agent** (or its `folder_id`) and resolves
  host, routing key, and credentials from `folders` +
  `owner_member_id`'s Superset key.
- `thread_sessions.project_id` stays (it still records which channel the
  thread lives in) but stops being a folder source.
- The share-vs-fresh predicate becomes **folder equality within the
  thread**: entering a thread, if a live session in this thread has an
  agent with the same `folder_id`, join its workspace
  (`shareWorkspace`, `supervisor.ts:1229-1232` / `joinThread`,
  `1184-1236`); otherwise `createWorkspace` from the entering agent's
  folder. This preserves the existing failure mode — join with no live
  workspace fails cleanly (`supervisor.ts:1194-1195`,
  `delegations.ts:230-236`).

The prompt envelope (`packages/api/src/utils/roster-envelope.ts:50-54`)
rewords its contract from "an agent on this channel works in this same
worktree" to "an agent on the same folder joins your worktree; an agent
on a different folder works in a fresh one of its own."

## Settings and UI

- **Agent settings** (`apps/web/src/components/agents/agent-manager.tsx`)
  stops grouping agents under channel headings; each agent row gains a
  **folder dropdown** (the org's `folders`). Create-agent takes a folder,
  not a `channelId` (`packages/api/src/routers/agents.ts:57-74`).
- **Channel settings** (`channel-settings.tsx`) swaps the read-only repo
  row for a **default agent picker**; `channels.update`
  (`routers/channels.ts:177-183`) accepts `defaultAgentId` alongside
  `visibility`.
- **Channel creation** becomes a first-class action (name + default
  agent), no longer only a side effect of `saveProjects`
  (`superset-connection.ts:213-272`).
- **Hosts & channels** settings page becomes **Hosts & folders**: the
  picker (`channel-picker.tsx`, `host-rows.ts:58-59`) creates folder
  rows.
- The terminal dock keys on the session's folder rather than
  `projectId` (`dock-hierarchy.tsx:78, 172, 319-341`).
- `channels.mentionable` (`routers/channels.ts:76-85`) returns agent
  member ids, not the agent's channel id — the composer mentions agents,
  and the routing upgrade above consumes them.

## Migration

Handwritten, as all migrations here are (drizzle-kit generate is
broken). Backfill in one transaction:

1. Create `folders`; insert one row per existing `projects` row, copying
   the Superset and repo columns; `owner_member_id` = the member whose
   Superset connection covers that host (today's `channelOwner`).
2. Set `members.folder_id` for every agent from its channel's new folder.
3. Set `projects.default_agent_id` = the channel's main agent (oldest
   non-archived, the current implicit rule).
4. Drop the moved columns, the `(org, superset_project_id)` unique index,
   and `members.project_id`.

Every existing channel behaves identically after backfill: same folder,
same default agent, same watch settings.

## Testing

- `same-worktree-ask.db.test.ts` re-targets its predicate: same folder
  across *different* channels shares; different folders in the *same*
  channel (newly possible) forks.
- New db tests: mention routing to a non-default agent; second agent
  joining a thread on folder match; folder-owner credential resolution.
- Fixtures (`test/fixtures.ts:82-83, 167`) and `mock-superset.ts:51`
  grow folder rows.
- Requires `DATABASE_URL` as usual for the db suites.

## Delivery order

1. **Schema + backfill** — `folders`, `default_agent_id`,
   `members.folder_id`, migration. App still reads through the old
   accessors, now folder-backed; behavior unchanged.
2. **Session re-keying** — `hostConnection` by agent/folder, credential
   source `owner_member_id`, share-on-folder-match predicate. The
   envelope wording changes here.
3. **Routing** — mention resolution to specific agents, in-thread joins.
4. **UI** — folder dropdown on agents, default-agent picker on channels,
   first-class channel creation, Hosts & folders.

Each step ships alone and leaves the app working.

## Out of scope

- Agent-persistent workspaces ("the agent has a desk") — rejected;
  worktrees stay thread-scoped.
- Channels without a default agent.
- Multiple folders per agent.
- Any change to human multiplayer, steering, or the join window.
