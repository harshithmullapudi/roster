"use client";

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@roster/ui";
import { Plus, X } from "lucide-react";
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
  const [editing, setEditing] = useState<AgentRow | null>(null);

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

  function saved(agent: AgentRow) {
    setRows((current) =>
      current.map((row) => (row.id === agent.id ? agent : row)),
    );
    setEditing(null);
  }

  function archived(agent: AgentRow) {
    setRows((current) => current.filter((row) => row.id !== agent.id));
    setEditing(null);
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
                  <li key={agent.id}>
                    <button
                      type="button"
                      onClick={() => setEditing(agent)}
                      className="hover:bg-grayAlpha-100 flex w-full items-center gap-2 px-4 py-3 text-left"
                    >
                      <code className="text-foreground shrink-0 font-mono text-sm">
                        @{agent.handle}
                      </code>
                      {agent.main ? (
                        <Badge variant="secondary" className="shrink-0">
                          default
                        </Badge>
                      ) : null}
                      <span className="text-muted-foreground min-w-0 truncate text-xs">
                        {agent.brief?.split("\n")[0]?.trim() || "no brief"}
                      </span>
                    </button>
                  </li>
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

      {editing ? (
        <AgentEditDialog
          agent={editing}
          folders={folders}
          onClose={() => setEditing(null)}
          onSaved={saved}
          onArchived={archived}
        />
      ) : null}
    </section>
  );
}

function AgentEditDialog({
  agent,
  folders,
  onClose,
  onSaved,
  onArchived,
}: {
  agent: AgentRow;
  folders: FolderOption[];
  onClose: () => void;
  onSaved: (agent: AgentRow) => void;
  onArchived: (agent: AgentRow) => void;
}) {
  const [name, setName] = useState(agent.handle);
  const [brief, setBrief] = useState(agent.brief ?? "");
  const [folderId, setFolderId] = useState(agent.folderId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name.trim() !== agent.handle ||
    brief.trim() !== (agent.brief ?? "").trim() ||
    folderId !== agent.folderId;

  async function save() {
    if (pending) return;
    setPending(true);
    setError(null);

    const next = brief.trim();
    try {
      const updated = await trpc.agents.update.mutate({
        agentId: agent.id,
        name: name.trim() || undefined,
        brief: next.length > 0 ? next : null,
        folderId,
      });
      onSaved({
        id: updated.id,
        handle: updated.handle,
        brief: updated.brief,
        folderId: updated.folderId,
        folderName: updated.folderName,
        main: updated.main,
      });
    } catch (cause) {
      setError(errorMessage(cause, "Couldn't save that agent."));
      setPending(false);
    }
  }

  async function archive() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await trpc.agents.archive.mutate({ agentId: agent.id });
      onArchived(agent);
    } catch (cause) {
      setError(errorMessage(cause, "Couldn't archive that agent."));
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="font-mono text-base">
            @{agent.handle}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">Name</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Agent name"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">Folder</span>
            <Select value={folderId} onValueChange={setFolderId}>
              <SelectTrigger showIcon aria-label="Folder" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {folders.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>
                    {folder.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">Brief</span>
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              rows={5}
              placeholder="What this one is here to do. It is read at the top of every session."
              aria-label={`Brief for @${agent.handle}`}
              className="border-border bg-background focus-visible:ring-ring min-h-24 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-1"
            />
          </label>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>

        <DialogFooter className="bg-transparent sm:justify-between">
          {!agent.main ? (
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={archive}
              disabled={pending}
            >
              Archive
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !dirty}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
