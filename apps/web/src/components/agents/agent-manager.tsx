"use client";

import { Badge, Button, cn, Input } from "@roster/ui";
import { Check, ChevronRight, Plus, X } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import { errorMessage, trpc } from "~/utils/trpc";

export interface AgentRow {
  id: string;
  handle: string;
  brief: string | null;
  folderId: string;
  folderName: string;
  main: boolean;
}

export interface FolderOption {
  id: string;
  name: string;
}

export interface AgentManagerProps {
  agents: AgentRow[];
  folders: FolderOption[];
}

export function AgentManager({ agents, folders }: AgentManagerProps) {
  const [rows, setRows] = useState(agents);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const byFolder = useMemo(() => {
    const grouped = new Map<string, AgentRow[]>();
    for (const agent of rows) {
      grouped.set(agent.folderId, [
        ...(grouped.get(agent.folderId) ?? []),
        agent,
      ]);
    }
    return grouped;
  }, [rows]);

  async function created(agent: AgentRow) {
    setRows((current) =>
      current.some((row) => row.id === agent.id)
        ? current
        : [...current, agent],
    );
    setAdding(null);
  }

  async function archive(agent: AgentRow) {
    setError(null);
    try {
      await trpc.agents.archive.mutate({ agentId: agent.id });
      setRows((current) => current.filter((row) => row.id !== agent.id));
    } catch (cause) {
      setError(errorMessage(cause, "Couldn't archive that agent."));
    }
  }

  async function moved(agent: AgentRow, folderId: string) {
    setError(null);
    const folder = folders.find((row) => row.id === folderId);
    if (!folder || agent.folderId === folderId) return;

    const previous = rows;
    setRows((current) =>
      current.map((row) =>
        row.id === agent.id
          ? { ...row, folderId, folderName: folder.name }
          : row,
      ),
    );
    try {
      await trpc.agents.update.mutate({ agentId: agent.id, folderId });
    } catch (cause) {
      setRows(previous);
      setError(errorMessage(cause, "Couldn't move that agent."));
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-foreground text-base font-medium">Agents</h2>
        <p className="text-muted-foreground text-sm">
          Every agent works in one folder. Agents on the same folder share a
          worktree when they end up in the same thread; anyone can reach one
          with <code className="font-mono">@handle</code>, and an agent can
          hand work to another with{" "}
          <code className="font-mono">roster ask</code>.
        </p>
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      {folders.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No folders yet. Connect one under Hosts &amp; folders and its agent
          appears here.
        </p>
      ) : null}

      {folders.map((folder) => {
        const theirs = byFolder.get(folder.id) ?? [];

        return (
          <div key={folder.id} className="flex flex-col gap-2">
            <div className="flex items-end justify-between gap-3">
              <h3 className="text-sm font-medium">{folder.name}</h3>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={() =>
                  setAdding(adding === folder.id ? null : folder.id)
                }
              >
                {adding === folder.id ? <X size={14} /> : <Plus size={14} />}
                {adding === folder.id ? "Cancel" : "Add agent"}
              </Button>
            </div>

            {theirs.length > 0 ? (
              <ul className="bg-background-3 flex flex-col divide-y rounded-lg">
                {theirs.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    folders={folders}
                    onArchive={() => archive(agent)}
                    onMove={(folderId) => moved(agent, folderId)}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">
                Nobody works in this folder yet.
              </p>
            )}

            {adding === folder.id ? (
              <NewAgentForm
                folderId={folder.id}
                onCreated={created}
                onError={setError}
              />
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function AgentCard({
  agent,
  folders,
  onArchive,
  onMove,
}: {
  agent: AgentRow;
  folders: FolderOption[];
  onArchive: () => void;
  onMove: (folderId: string) => void;
}) {
  const [brief, setBrief] = useState(agent.brief ?? "");
  const [saved, setSaved] = useState(agent.brief ?? "");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = brief.trim() !== saved.trim();
  const summary = saved.split("\n")[0]?.trim() ?? "";

  async function save() {
    setPending(true);
    setError(null);
    setJustSaved(false);

    const next = brief.trim();
    try {
      await trpc.agents.setBrief.mutate({
        agentId: agent.id,
        brief: next.length > 0 ? next : null,
      });
      setSaved(next);
      setJustSaved(true);
    } catch (cause) {
      setError(errorMessage(cause, "Couldn't save that brief."));
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="flex flex-col px-4 py-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          <ChevronRight
            size={14}
            className={cn(
              "text-muted-foreground shrink-0 transition-transform",
              open && "rotate-90",
            )}
          />
          <code className="text-foreground shrink-0 font-mono text-sm">
            @{agent.handle}
          </code>
          {agent.main ? (
            <Badge variant="secondary" className="shrink-0">
              default
            </Badge>
          ) : null}
          {!open ? (
            <span className="text-muted-foreground min-w-0 truncate text-xs">
              {summary || "no brief"}
            </span>
          ) : null}
        </button>

        {justSaved && !dirty ? (
          <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
            <Check size={12} />
            saved
          </span>
        ) : null}
        {!agent.main ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground shrink-0"
            onClick={onArchive}
          >
            Archive
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-2 flex flex-col gap-2 pl-6">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Folder</span>
            <select
              aria-label={`Folder for @${agent.handle}`}
              value={agent.folderId}
              onChange={(event) => onMove(event.target.value)}
              className="border-border bg-background focus-visible:ring-ring rounded-md border px-2 py-1 text-sm outline-none focus-visible:ring-1"
            >
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>

          <textarea
            aria-label={`Brief for @${agent.handle}`}
            value={brief}
            onChange={(event) => {
              setBrief(event.target.value);
              setJustSaved(false);
            }}
            rows={4}
            placeholder="What this one is here to do. It is read at the top of every session."
            className="border-border bg-background focus-visible:ring-ring min-h-20 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-1"
          />

          {error ? <p className="text-destructive text-xs">{error}</p> : null}

          {dirty ? (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save brief"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setBrief(saved)}
                disabled={pending}
              >
                Revert
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function NewAgentForm({
  folderId,
  onCreated,
  onError,
}: {
  folderId: string;
  onCreated: (agent: AgentRow) => void;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || pending) return;

    setPending(true);
    onError(null);
    try {
      const made = await trpc.agents.create.mutate({
        folderId,
        name: name.trim(),
        brief: brief.trim() || undefined,
      });
      onCreated(made);
      setName("");
      setBrief("");
    } catch (cause) {
      onError(errorMessage(cause, "Couldn't create that agent."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="border-border flex flex-col gap-2 rounded-lg border border-dashed p-3"
    >
      <Input
        placeholder="pm"
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="max-w-xs"
        aria-label="Agent name"
      />
      <p className="text-muted-foreground text-xs">
        Lowercase letters, numbers and dashes. The handle is exactly what you
        type: <code className="font-mono">pm</code> answers to{" "}
        <code className="font-mono">@pm</code>.
      </p>
      <textarea
        placeholder="Own the spec. Ask about scope, not syntax."
        value={brief}
        onChange={(event) => setBrief(event.target.value)}
        rows={2}
        aria-label="Brief"
        className="border-border bg-background focus-visible:ring-ring min-h-12 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-1"
      />
      <div>
        <Button type="submit" size="sm" disabled={pending || !name.trim()}>
          {pending ? "Creating…" : "Create agent"}
        </Button>
      </div>
    </form>
  );
}
