# Deploying

Roster runs as **two tiers**: the web app, and a worker that owns every agent
session. They share Postgres and Redis, and they ship in the same image — so
they can run in one container or as two services.

The split exists because the supervisor — the thing that holds a WebSocket to
each machine, watches every running session, and drives the agent — used to
live inside the Next process. A deploy dropped every live watch, nothing
recurring could be scheduled, and the process could never be replicated. The
worker owns all of that now, and the web tier only reads and enqueues.

**One image, two tiers.** The build bundles the worker into a single
self-contained file that ships in the same image, so the topology is a
deployment choice rather than a build one.

```bash
docker build -t roster --build-arg NEXT_PUBLIC_APP_URL=https://roster.example.com .
```

**Together, in one container** — the simplest thing that works:

```bash
docker run -p 3000:3000 -e ROSTER_RUN_WORKER=1 --env-file .env roster
```

`ROSTER_RUN_WORKER=1` makes the container run the worker beside the web
server. They share a restart: a deploy bounces both, and if the worker dies
the container exits non-zero so the platform restarts it rather than leaving
a web server with no agent sessions.

**Apart, as two services** — what to move to when either tier needs to scale
or restart on its own:

```bash
docker run -p 3000:3000 --env-file .env roster
docker run --env-file .env roster node apps/worker/dist/worker.mjs
```

| | Web | Worker |
| --- | --- | --- |
| Start command | the image default | `node apps/worker/dist/worker.mjs` |
| Serves HTTP | yes, on `$PORT` | no |
| Uploads volume | **required** | **must not have one** |
| Redis | required | required |
| Runs migrations | yes, before it serves | no |

Either way something has to run the worker. It is what starts agent sessions,
holds the socket to each machine, watches every running session and writes its
progress into the thread. Without it, threads open and nothing happens.

## On Railway

Point a service at this repo — `railway.json` already selects the Dockerfile
builder — then:

1. **Add a Postgres database**, and set `DATABASE_URL` to its connection
   string.
2. **Add a Redis database**, and set `REDIS_URL`. This is not optional the way
   Centrifugo is: Redis carries the queues the worker runs on and the lease
   that decides which worker is active, so without it no session starts.

   Railway's Redis plugin is close to what Roster needs but not exactly it. It
   runs `redis-server --save 60 1` on a volume and sets no `maxmemory`, so
   eviction is already off — Redis defaults to `noeviction` — which is the
   part that matters, since eviction here means silently dropped jobs and a
   lease key two workers can both acquire.

   What it does *not* do is append-only persistence. `--save 60 1` snapshots
   at most once a minute, so a hard crash can lose up to a minute of queue
   state: a queued steer could vanish. Lease keys do not matter, they expire
   anyway. To close that, add `--appendonly yes` to the Redis service's start
   command.
3. **Set the rest** from `.env.example`: `BETTER_AUTH_SECRET`,
   `SUPERSET_KEY_SECRET`, and, once the service has a domain,
   `NEXT_PUBLIC_APP_URL` and `BETTER_AUTH_URL`. The first of those is baked
   into the browser bundle at build time, so **changing it needs a rebuild,
   not a restart.**
4. **Nothing, for the schema.** The web container applies migrations before it
   starts the server, and exits non-zero if they fail, so a bad migration stops
   the deploy rather than serving a build the schema cannot answer. A database
   from before migrations existed is adopted in that same step. `pnpm dev`
   applies them the same way, before it starts anything. The
   worker never migrates; on a cold deploy it may start against an unmigrated
   schema, fail, and be restarted by the `ON_FAILURE` policy until the web
   service has caught up.
5. **Mount a volume at `/app/uploads`** on the **web** service — where the
   image points `UPLOADS_DIR`. Without one, a redeploy throws the files away
   and leaves the rows, so every preview 404s. `docker-entrypoint.sh` re-owns
   the mount before dropping to `nextjs`, so this needs no `RAILWAY_RUN_UID=0`.

   A volume costs something: **it rules out replicas for the web service**, a
   redeploy blips while the mount changes hands, and a service gets exactly
   one — 0.5 GB on Free, 5 GB on Hobby, 50 GB on Pro. Outgrowing that means
   object storage; `packages/api/src/services/attachments.ts` is the only
   module touching disk.
6. **Run the worker.** Start with it in the web service — set
   `ROSTER_RUN_WORKER=1` on that service and nothing else changes. One
   service, one bill, and agent sessions work.

   Split it out when either tier needs to scale or restart independently.
   Add a second service on the same repo with:
   - **Custom start command** `node apps/worker/dist/worker.mjs`. This is
     Railway's documented way to run a second tier out of a shared monorepo,
     and it is why there is no second Dockerfile: the builder can only pick a
     file, not a stage, so a worker stage would have become the default target
     and quietly replaced the web image.
   - **No volume, no domain.** It serves no HTTP.
   - Then remove `ROSTER_RUN_WORKER` from the web service, or both will run
     one — harmless, since only the lease holder does any work, but it wastes
     a process and muddies the logs.
   - The same variables as web, minus the web-only ones:
     `DATABASE_URL`, `REDIS_URL`, `SUPERSET_KEY_SECRET`, `SUPERSET_API_URL`,
     `SUPERSET_RELAY_URL`, `CENTRIFUGO_*`, and `NEXT_PUBLIC_APP_URL`.

   Two of those are easy to get wrong:

   **`NEXT_PUBLIC_APP_URL` must be a runtime variable here, not just a build
   argument.** Next inlines it at build time; the worker reads it live, and
   `absoluteAttachmentUrl` falls back to `http://localhost:3000` without
   complaining. Get it wrong and every retry prompt hands the agent a download
   URL that does not resolve.

   **`SUPERSET_KEY_SECRET` must match the web service byte for byte.** It
   decrypts the stored Superset key; a mismatch fails every session start with
   an unreadable-key error rather than anything that names the cause.

   Leaving `CENTRIFUGO_*` unset on the worker is silent — `publish` returns
   false and logs nothing — so the app keeps working while every thread stops
   updating live.
7. **Centrifugo is still optional.** Leave `CENTRIFUGO_*` empty and realtime
   turns itself off, falling back to plain tRPC. To wire it up, run it as a
   third service with `CENTRIFUGO_URL` set to its private URL and declare all
   three namespaces — a publish to one Centrifugo does not know is rejected,
   and a missing `user` makes the unread dot lag by a poll:

   ```
   CENTRIFUGO_CHANNEL_NAMESPACES=[{"name":"channel","presence":true,"history_size":300,"history_ttl":"30m","force_recovery":true},{"name":"thread","presence":false,"history_size":300,"history_ttl":"30m","force_recovery":true},{"name":"user","presence":false,"history_size":100,"history_ttl":"30m","force_recovery":true}]
   ```

`PORT` comes from the environment, which is how Railway routes to the web
container.

## How many workers

One is active at a time. Each worker takes a lease in Redis
(`roster:supervisor:owner`, 30s, renewed every 10s) and only the holder runs
the session queue and the watches. Others stand by and poll for the lease.

So running two is worth it — not for throughput, but because a crash or a
deploy hands over in about a lease period instead of leaving sessions
unattended until something restarts. Sharding sessions *across* active workers
needs per-host-link leases and is not built yet.

The worker tier has no volume, so replicas are allowed here even though the
web tier's volume forbids them.

## Config as Code is going away

`railway.json` in this repo is Railway's deprecated Config as Code. Railway
keeps existing files working **until 2026-12-01** and points at Infrastructure
as Code instead. Nothing here depends on it — it only selects the Dockerfile
builder, which is also a checkbox — but the two-service setup above is worth
moving to Infrastructure as Code before that date rather than after.

## The Railway template

The template lives in Railway's dashboard, not in this repository, and there is
no CLI for it — `railway deploy` provisions a template, it does not publish
one. So it has to be edited there by hand, and it does **not** update itself
when this repo changes.

Three services, matching what the production project runs:

| Service | Notes |
| --- | --- |
| Web | This repo's Dockerfile, a volume at `/app/uploads`, a domain, and `ROSTER_RUN_WORKER=1` |
| Postgres | |
| Redis | The stock plugin is fine; add `--appendonly yes` to its start command if losing a minute of queued work on a hard crash matters |

Centrifugo is a fourth service if realtime is wanted; leave `CENTRIFUGO_*`
empty and the app falls back to plain tRPC.

`ROSTER_RUN_WORKER=1` is the line that matters most. Without it the template
produces a deployment where threads open and no agent ever runs, which looks
like a broken app rather than a missing setting.

Variables the template must set, beyond the database URLs:
`BETTER_AUTH_SECRET`, `SUPERSET_KEY_SECRET`, `EMAIL_FROM`, and — once the
service has a domain — `NEXT_PUBLIC_APP_URL` and `BETTER_AUTH_URL`. Both
secrets should be generated per deployment rather than copied from this
project.

If the worker is later split into its own service, that service needs
`SUPERSET_KEY_SECRET` **referenced from** the web service rather than
generated again: two different values mean the worker cannot decrypt the key
the web service stored, and every session start fails with an unreadable-key
error that does not name the cause.
