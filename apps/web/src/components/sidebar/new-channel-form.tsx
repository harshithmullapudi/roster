"use client";

import { Button, Input } from "@roster/ui";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { errorMessage, trpc } from "~/utils/trpc";

interface AgentChoice {
  id: string;
  handle: string;
  folderName: string;
}

export function NewChannelForm({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [agents, setAgents] = useState<AgentChoice[] | null>(null);
  const [agentId, setAgentId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || agents !== null) return;
    trpc.agents.list
      .query()
      .then((found) => {
        setAgents(
          found.map((agent) => ({
            id: agent.id,
            handle: agent.handle,
            folderName: agent.folderName,
          })),
        );
        setAgentId((current) => current || (found[0]?.id ?? ""));
      })
      .catch((cause) => {
        setError(errorMessage(cause, "Couldn't load your agents."));
      });
  }, [open, agents]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !agentId || pending) return;

    setPending(true);
    setError(null);
    try {
      const made = await trpc.channels.create.mutate({
        name: name.trim(),
        defaultAgentId: agentId,
      });
      setOpen(false);
      setName("");
      router.push(`/${orgSlug}/${made.slug}`);
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause, "Couldn't create that channel."));
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground mx-2 mt-1 justify-start gap-1"
        onClick={() => setOpen(true)}
      >
        <Plus size={14} />
        New channel
      </Button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="border-border mx-2 mt-1 flex flex-col gap-2 rounded-lg border border-dashed p-2"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">New channel</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          <X size={14} />
        </Button>
      </div>

      <Input
        placeholder="bugs"
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label="Channel name"
        autoFocus
      />

      <select
        aria-label="Default agent"
        value={agentId}
        onChange={(event) => setAgentId(event.target.value)}
        className="border-border bg-background focus-visible:ring-ring rounded-md border px-2 py-1.5 text-sm outline-none focus-visible:ring-1"
      >
        {agents === null ? (
          <option value="">Loading agents…</option>
        ) : agents.length === 0 ? (
          <option value="">No agents yet — connect a folder first</option>
        ) : (
          agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              @{agent.handle} — {agent.folderName}
            </option>
          ))
        )}
      </select>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}

      <div>
        <Button
          type="submit"
          size="sm"
          disabled={pending || !name.trim() || !agentId}
        >
          {pending ? "Creating…" : "Create channel"}
        </Button>
      </div>
    </form>
  );
}
