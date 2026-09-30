export const ENVELOPE_OPEN = "<roster>";
export const ENVELOPE_CLOSE = "</roster>";

export interface DelegationContext {
  askedBy: string;
  originChannelId: string;
}

export interface TaskContext {
  id: string;
  title: string;
  status: string;
}

export interface EnvelopeArgs {
  threadId: string;
  channelId: string;
  handle: string;
  brief?: string | null;
  delegation?: DelegationContext;
  task?: TaskContext;
}

export function rosterEnvelope(args: EnvelopeArgs): string {
  const brief = (args.brief ?? "").trim();

  const lines = [
    ENVELOPE_OPEN,
    `You are @${args.handle}, an agent for this channel in Roster.`,
    `thread-id: ${args.threadId}`,
    `channel-id: ${args.channelId}`,
    ...(brief.length > 0 ? ["", "What you are here to do:", brief] : []),
    "",
    "The `roster` CLI is available:",
    "  roster channels",
    "  roster agents [--channel-id <id>]",
    "  roster agents create <name> --channel-id <id> [--brief TEXT]",
    "  roster agents brief <handle> <text>",
    "  roster read messages --channel-id <id> [--limit N]",
    "  roster read messages --thread-id <id> [--limit N]",
    "  roster react <message-id> <emoji>",
    "  roster tasks create <title> [--channel-id <id>]",
    "  roster tasks status <task-id> <todo|in_progress|done>",
    `  roster ask <handle> <task> --thread ${args.threadId} --as ${args.handle}`,
    "",
    "Pass --channel-id only when someone named the channel the work belongs",
    "to. Without it the task waits in the backlog for a person to assign it.",
    "Assigning a task starts that channel's agent on it straight away.",
    "",
    "`roster agents` lists who you can ask. An agent on your folder joins",
    "this same worktree, turn about with you; an agent on another folder works",
    "in a fresh worktree of its own, in this same thread. Keep `--as` on every",
    "ask: more than one agent works in a thread, and that is how the answer",
    "finds its way back to you. `roster ask` returns straight away, and you can",
    "ask several agents in one turn — one ask at a time per agent. Then say what",
    "you asked for and end your turn: you are resumed once every answer is back.",
    "Never poll or wait.",
    "",
    "A channel read marks every message that has a thread with that thread's",
    "id. Read one with --thread-id to see the replies underneath it; your own",
    "thread-id is above.",
  ];

  if (args.task) {
    lines.push(
      "",
      `You are working on this task: ${args.task.title}`,
      `task-id: ${args.task.id}`,
      `status: ${args.task.status}`,
      "Keep it honest as you go — nobody else moves it for you:",
      `  roster tasks status ${args.task.id} in_progress`,
      `  roster tasks status ${args.task.id} done`,
    );
  }

  if (args.delegation) {
    lines.push(
      "",
      `This work was handed to you by @${args.delegation.askedBy}.`,
      "For the conversation behind it:",
      `  roster read messages --channel-id ${args.delegation.originChannelId} --limit 20`,
      "Answer in your final message — it is sent back to them verbatim.",
    );
  }

  lines.push(ENVELOPE_CLOSE);
  return lines.join("\n");
}

const ENVELOPE_BLOCK = /<roster>[\s\S]*?<\/roster>\s*/g;

export function stripEnvelope(text: string): string {
  return text.replace(ENVELOPE_BLOCK, "").trim();
}
