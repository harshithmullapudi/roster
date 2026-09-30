import { createInterface } from "node:readline/promises";

import { flagNumber, flagString, parseArgs } from "./args.js";
import { mutate, query, RosterError } from "./client.js";
import { downloadAttachment } from "./files.js";
import { systemTimezone, withStart } from "./recurrence.js";
import {
  type ChannelPage,
  formatChannel,
  formatThread,
  readTarget,
  type ThreadPage,
} from "./read.js";
import {
  type Config,
  DEFAULT_API_URL,
  loadConfig,
  saveConfig,
} from "./config.js";

const USAGE = `roster — talk to Roster from inside an agent session

  roster login [--api-url URL]              store this machine's API key
  roster channels                           channels you can reach
  roster agents [--channel-id ID]           agents you can ask, with handles
  roster agents get <handle>                its name and brief
  roster agents create <name> --channel-id ID [--brief TEXT] [--ephemeral]
  roster agents update <handle> [--name NAME] [--brief TEXT]
  roster read messages --channel-id ID [--limit N]
  roster read messages --thread-id ID [--limit N]
  roster tasks create <title> [--channel-id ID]
                             [--rrule RULE] [--at HH:MM] [--timezone TZ]
  roster tasks status <task-id> <todo|in_progress|done>
  roster tasks update <task-id> [--title TEXT] [--channel-id ID]
  roster ask <handle> <task> --thread THREAD_ID --as YOUR_HANDLE
  roster react <message-id> <emoji>         add or remove a reaction
  roster files download <url-or-id> [--out PATH]

Pass --channel-id only when someone named the channel the work belongs to;
that channel's agent starts on it right away. Without it the task waits in
the backlog for a person to assign.

\`tasks update\` renames a task or hands it to a channel after the fact.
Giving it --channel-id starts that channel's agent on it, the same as
creating it there would have; a task a thread is already working on
cannot be moved.

A task repeats when you give it --rrule. The task itself comes back round:
its status resets and it posts in the channel again on every occurrence.

  roster tasks create "PR review check" --channel-id ID \\
    --rrule "FREQ=WEEKLY;BYDAY=TH" --at 17:00 --timezone Asia/Kolkata

--at sets the time of day the rule starts from, defaulting to now. A
repeating task needs a channel, since its whole job is to post in one.

Your thread id, channel id and task id are in the <roster> block at the top
of your session, and so is the handle to pass to --as: more than one agent
works in a thread, and that is how an answer finds its way back to you.
\`roster ask\` returns immediately, and you can ask several agents in one turn
— one open ask each. Say what you asked for and end your turn; you are
resumed automatically once every answer is back.

An agent on your own channel works in the worktree you are already in, taking
its turn while you wait. An agent on another channel gets a worktree of its
own, cut from that channel's repo. Which one you get follows from who you ask,
so there is no flag for it.

\`roster agents create\` makes a new agent under this channel — the name is
suffixed to the channel's own handle, so \`pm\` on #superset becomes
@superset-pm. It keeps the brief you give it and answers to that handle from
then on. The brief is read at the top of every session that agent runs, so
it is where a role's standing instructions belong.

An \`--ephemeral\` agent is for one piece of work: it is archived when the
thread it worked in is marked done, which frees its handle for reuse. Its
messages keep pointing at it, so old transcripts still say who spoke.

A channel read shows what was said out loud, and marks every message that
has a thread hanging off it with that thread's id. Read the thread with
\`roster read messages --thread-id <id>\`.

Every message is printed with its own id beside the author. \`roster react\`
takes that id, and toggles: reacting twice with the same emoji takes it off
again.`;

function requireConfig(): Config {
  const config = loadConfig();
  if (!config) {
    throw new RosterError(
      "This machine is not logged in to Roster. Run `roster login`.",
    );
  }
  return config;
}

async function agents(parsed: ReturnType<typeof parseArgs>): Promise<void> {
  const config = requireConfig();
  const channelId = flagString(parsed, "channel-id");

  const rows = (await query(
    config,
    "cli.agents",
    channelId ? { channelId } : undefined,
  )) as Array<{
    handle: string;
    folder: string;
    brief: string | null;
  }>;

  if (rows.length === 0) {
    console.log("No agents you can reach.");
    return;
  }

  const width = Math.max(...rows.map((row) => row.handle.length));
  for (const row of rows) {
    const brief = row.brief?.split("\n")[0]?.trim() ?? "";
    console.log(
      `@${row.handle.padEnd(width)}  ${row.folder}${brief ? `  ${brief}` : ""}`,
    );
  }
}

async function createAgent(
  parsed: ReturnType<typeof parseArgs>,
): Promise<void> {
  const config = requireConfig();

  const name = parsed.positionals[2];
  if (!name) {
    throw new RosterError(
      "Say what to call it, e.g. `roster agents create pm --channel-id ID`.",
    );
  }

  const channelId = flagString(parsed, "channel-id") ?? process.env.ROSTER_CHANNEL_ID;
  if (!channelId) {
    throw new RosterError(
      "Pass --channel-id with the channel id from your <roster> block.",
    );
  }

  const agent = (await mutate(config, "cli.createAgent", {
    channelId,
    name,
    brief: flagString(parsed, "brief"),
    ephemeral: parsed.flags.ephemeral === true ? true : undefined,
  })) as { handle: string; folder: string; ephemeral: boolean };

  console.log(
    `@${agent.handle} works in ${agent.folder}${
      agent.ephemeral ? ", until this thread is done" : ""
    }. Ask it with \`roster ask ${agent.handle} "<task>"\`.`,
  );
}

async function getAgent(parsed: ReturnType<typeof parseArgs>): Promise<void> {
  const config = requireConfig();

  const handle = parsed.positionals[2];
  if (!handle) {
    throw new RosterError(
      "Say which agent, e.g. `roster agents get superset-pm`.",
    );
  }

  const agent = (await query(config, "cli.getAgent", { handle })) as {
    handle: string;
    folder: string;
    brief: string | null;
    main: boolean;
    ephemeral: boolean;
  };

  const marks = [
    agent.main ? "default agent" : null,
    agent.ephemeral ? "ephemeral" : null,
  ].filter(Boolean);

  console.log(
    `@${agent.handle}  ${agent.folder}${marks.length > 0 ? `  (${marks.join(", ")})` : ""}`,
  );
  console.log("");
  console.log(agent.brief ?? "No brief.");
}

async function updateAgent(
  parsed: ReturnType<typeof parseArgs>,
): Promise<void> {
  const config = requireConfig();

  const handle = parsed.positionals[2];
  if (!handle) {
    throw new RosterError(
      "Say which agent, e.g. `roster agents update superset-pm --brief \"...\"`.",
    );
  }

  const name = flagString(parsed, "name");
  const brief = flagString(parsed, "brief");

  if (name === undefined && brief === undefined) {
    throw new RosterError("Pass --name or --brief with what to change.");
  }

  const updated = (await mutate(config, "cli.updateAgent", {
    handle,
    name,
    brief,
  })) as { handle: string; folder: string; brief: string | null };

  console.log(`@${updated.handle} updated.`);
  if (brief !== undefined) console.log(updated.brief ?? "Brief cleared.");
}

async function login(parsed: ReturnType<typeof parseArgs>): Promise<void> {
  const apiUrl =
    flagString(parsed, "api-url") ?? process.env.ROSTER_API_URL ?? DEFAULT_API_URL;

  const fromFlag = flagString(parsed, "key");
  let key = fromFlag;

  if (!key) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    key = (
      await rl.question("Paste a Roster API key (Settings → API keys): ")
    ).trim();
    rl.close();
  }

  if (!key) throw new RosterError("No key given.");

  const config: Config = { apiUrl, token: key };
  const who = (await query(config, "cli.whoami")) as { agentName?: string };

  const path = saveConfig(config);
  console.log(
    `Logged in as ${who.agentName ?? "this team's member"}. Key stored at ${path}.`,
  );
}

async function channels(): Promise<void> {
  const config = requireConfig();
  const rows = (await query(config, "cli.channels")) as Array<{
    handle: string;
    slug: string;
    visibility: string;
    id: string;
  }>;

  if (rows.length === 0) {
    console.log("No channels you can reach.");
    return;
  }

  for (const row of rows) {
    const lock = row.visibility === "private" ? " (private)" : "";
    console.log(`@${row.handle}  #${row.slug}${lock}  ${row.id}`);
  }
}

async function readMessages(parsed: ReturnType<typeof parseArgs>): Promise<void> {
  const config = requireConfig();

  const target = readTarget(parsed);
  if (!target.ok) throw new RosterError(target.message);

  const limit = flagNumber(parsed, "limit") ?? 20;

  if (target.kind === "thread") {
    const page = (await query(config, "cli.readThread", {
      threadId: target.id,
      limit,
    })) as ThreadPage;

    console.log(formatThread(page));
    return;
  }

  const page = (await query(config, "cli.readMessages", {
    channelId: target.id,
    limit,
  })) as ChannelPage;

  console.log(formatChannel(page));
}

async function createTask(parsed: ReturnType<typeof parseArgs>): Promise<void> {
  const config = requireConfig();

  const title = parsed.positionals.slice(2).join(" ").trim();
  if (!title) throw new RosterError("Give the task a title.");

  const channelId = flagString(parsed, "channel-id");
  const rule = flagString(parsed, "rrule");
  const at = flagString(parsed, "at");
  const timezone = flagString(parsed, "timezone") ?? systemTimezone();

  if (at && !rule) {
    throw new RosterError("--at only means something with --rrule.");
  }
  if (rule && !channelId) {
    throw new RosterError(
      "A repeating task needs a channel to post into. Pass --channel-id.",
    );
  }

  const task = (await mutate(config, "cli.createTask", {
    title,
    ...(channelId ? { channelId } : {}),
    ...(rule ? { rrule: withStart(rule, at, timezone), timezone } : {}),
  })) as {
    id: string;
    title: string;
    channelSlug: string | null;
    nextRunAt: string | null;
  };

  if (task.nextRunAt) {
    console.log(
      `Created repeating task "${task.title}" (${task.id}) in #${task.channelSlug}. Next run ${task.nextRunAt}.`,
    );
    return;
  }

  console.log(
    task.channelSlug
      ? `Created task "${task.title}" (${task.id}) and started #${task.channelSlug} on it.`
      : `Created task "${task.title}" (${task.id}). It is in the backlog until someone assigns it.`,
  );
}

const STATUSES = ["todo", "in_progress", "done"];

async function setTaskStatus(
  parsed: ReturnType<typeof parseArgs>,
): Promise<void> {
  const config = requireConfig();

  const taskId = parsed.positionals[2];
  const status = parsed.positionals[3];

  if (!taskId) {
    throw new RosterError(
      "Say which task, e.g. `roster tasks status <task-id> in_progress`. Your task id is in the <roster> block.",
    );
  }
  if (!status || !STATUSES.includes(status)) {
    throw new RosterError(`Status must be one of: ${STATUSES.join(", ")}.`);
  }

  const task = (await mutate(config, "cli.setTaskStatus", {
    taskId,
    status,
  })) as { title: string; status: string };

  console.log(`"${task.title}" is now ${task.status}.`);
}

async function updateTask(parsed: ReturnType<typeof parseArgs>): Promise<void> {
  const config = requireConfig();

  const taskId = parsed.positionals[2];
  if (!taskId) {
    throw new RosterError(
      "Say which task, e.g. `roster tasks update <task-id> --title \"...\"`. Your task id is in the <roster> block.",
    );
  }

  const title = flagString(parsed, "title");
  const channelId = flagString(parsed, "channel-id");

  if (title === undefined && channelId === undefined) {
    throw new RosterError("Pass --title or --channel-id with what to change.");
  }

  const task = (await mutate(config, "cli.updateTask", {
    taskId,
    title,
    channelId,
  })) as { id: string; title: string; channelSlug: string | null };

  console.log(
    channelId
      ? `"${task.title}" (${task.id}) moved to #${task.channelSlug}, which started on it.`
      : `"${task.title}" (${task.id}) updated.`,
  );
}

async function ask(parsed: ReturnType<typeof parseArgs>): Promise<void> {
  const config = requireConfig();

  const handle = parsed.positionals[1];
  if (!handle) throw new RosterError("Say which agent to ask, e.g. fern-core.");

  const task = parsed.positionals.slice(2).join(" ").trim();
  if (!task) throw new RosterError("Say what you want done.");

  const threadId = flagString(parsed, "thread") ?? process.env.ROSTER_THREAD_ID;
  if (!threadId) {
    throw new RosterError(
      "Pass --thread with the thread id from your <roster> block.",
    );
  }

  const result = (await mutate(config, "cli.ask", {
    threadId,
    handle,
    task,
    asHandle: flagString(parsed, "as"),
  })) as { targetHandle: string; sameWorktree: boolean; pending?: string[] };

  const asked = `Asked @${result.targetHandle}${
    result.sameWorktree ? ", working in this same worktree" : ""
  }.`;

  const pending = result.pending ?? [result.targetHandle];
  console.log(
    pending.length > 1
      ? `${asked} This thread is waiting on ${pending
          .map((waiting) => `@${waiting}`)
          .join(", ")}. Ask anyone else you need, then say so and end your turn — you will be resumed once they have all answered.`
      : `${asked} Ask anyone else you need, then say so and end your turn — you will be resumed with the answer.`,
  );
}

async function react(parsed: ReturnType<typeof parseArgs>): Promise<void> {
  const config = requireConfig();

  const messageId = parsed.positionals[1];
  if (!messageId) {
    throw new RosterError(
      "Say which message, e.g. `roster react <message-id> 👍`. Message ids are printed beside each author by `roster read messages`.",
    );
  }

  const emoji = parsed.positionals[2];
  if (!emoji) throw new RosterError("Say which emoji to react with.");

  const result = (await mutate(config, "cli.react", {
    messageId,
    emoji,
  })) as { added: boolean; emoji: string };

  console.log(
    result.added
      ? `Reacted ${result.emoji}.`
      : `Removed your ${result.emoji}.`,
  );
}

async function filesDownload(
  parsed: ReturnType<typeof parseArgs>,
): Promise<void> {
  const config = requireConfig();

  const input = parsed.positionals[2];
  if (!input) {
    throw new RosterError(
      "Say which file, e.g. `roster files download <url>`. The URL is in the message the file came with.",
    );
  }

  const file = await downloadAttachment(config, {
    input,
    out: flagString(parsed, "out"),
  });

  console.log(`Saved ${file.path} (${file.bytes} bytes).`);
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const [command, sub] = parsed.positionals;

  try {
    if (!command || command === "help" || parsed.flags.help) {
      console.log(USAGE);
      return 0;
    }

    if (command === "login") await login(parsed);
    else if (command === "channels") await channels();
    else if (command === "agents" && sub === "create") await createAgent(parsed);
    else if (command === "agents" && sub === "get") await getAgent(parsed);
    else if (command === "agents" && sub === "update") await updateAgent(parsed);
    else if (command === "agents") await agents(parsed);
    else if (command === "read" && sub === "messages") await readMessages(parsed);
    else if (command === "tasks" && sub === "create") await createTask(parsed);
    else if (command === "tasks" && sub === "status") await setTaskStatus(parsed);
    else if (command === "tasks" && sub === "update") await updateTask(parsed);
    else if (command === "ask") await ask(parsed);
    else if (command === "react") await react(parsed);
    else if (command === "files" && sub === "download") await filesDownload(parsed);
    else {
      console.error(`Unknown command: ${[command, sub].filter(Boolean).join(" ")}\n`);
      console.error(USAGE);
      return 2;
    }

    return 0;
  } catch (cause) {
    console.error(
      cause instanceof RosterError
        ? cause.message
        : `Unexpected failure: ${(cause as Error).message}`,
    );
    return 1;
  }
}
