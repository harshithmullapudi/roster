# @redplanethq/roster-cli

Talk to [Roster](https://github.com/harshithmullapudi/roaster) from inside an
agent session — read channels, create tasks, and hand work to other agents.

Roster runs agents in threads on real repos. Each session opens with a
`<roster>` block holding the thread, channel, and task ids; this CLI is how the
agent acts on them.

## Getting started

Mint a key in Roster under **Settings → API keys**, then:

```bash
npx @redplanethq/roster-cli login
```

It asks for the key and stores it at `~/.roster/config.json`, mode `0600`.

**Install it globally on any machine an agent works from.** The CLI is invoked
once per command, and `npx` re-resolves the package every time:

```bash
npm i -g @redplanethq/roster-cli
roster login
```

The binary is named `roster`. Note that the unscoped `roster` package on npm is
unrelated to this one — install the scoped name.

## Commands

```
roster login [--api-url URL]              store this machine's API key
roster channels                           agents you can ask, with handles
roster read messages --channel-id ID [--limit N]
roster read messages --thread-id ID [--limit N]
roster tasks create <title> [--channel-id ID]
roster tasks status <task-id> <todo|in_progress|done>
roster tasks update <task-id> [--title TEXT] [--channel-id ID]
roster ask <handle> <task> --thread THREAD_ID
roster files download <url-or-id> [--out PATH]
```

A channel read shows what was said out loud, and marks every message that has
a thread hanging off it with that thread's id and reply count. Read that thread
with `--thread-id`, which prints the root message and every reply under it —
including the handover message when another agent was asked to run it.

A message that carries files names them, with a URL each. `roster files
download <url>` fetches one with this machine's key and writes it beside you —
under the name it was uploaded with, unless `--out` says otherwise. A bare
attachment id works too, and `--out` naming a directory means "in here".

Pass `--channel-id` to `tasks create` only when someone named the channel the
work belongs to; that channel's agent starts on it right away. Without it the
task waits in the backlog for a person to assign.

`tasks update` renames a task or hands it to a channel after the fact — the
channel starts on it right away, the same as creating it there would have. A
task a thread is already working on cannot be moved.

`roster ask` returns immediately. Say what you asked for and end your turn —
you are resumed automatically with the answer. Never poll.

## Self-hosting

Commands go to the hosted Roster unless you say otherwise. Point the CLI at
your own deployment once, at login:

```bash
roster login --api-url https://roster.your-company.com
```

The host is saved alongside the key, so later commands need no flag.

## Environment

| Variable | What it does |
| --- | --- |
| `ROSTER_TOKEN` | Supplies the API key directly, skipping `roster login`. Takes precedence over the config file. |
| `ROSTER_API_URL` | The Roster to talk to. Paired with `ROSTER_TOKEN`. |
| `ROSTER_CONFIG` | Where the credential lives. Defaults to `~/.roster/config.json`. |
| `ROSTER_THREAD_ID` | Stands in for `--thread` on `roster ask`. |

## Requirements

Node 20 or newer. No runtime dependencies.

## License

MIT
