"use client";

import {
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
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { errorMessage, trpc } from "~/utils/trpc";

interface AgentChoice {
  id: string;
  handle: string;
  folderName: string;
}

export function NewChannelDialog({ orgSlug }: { orgSlug: string }) {
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
      setAgentId("");
      router.push(`/${orgSlug}/${made.slug}`);
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause, "Couldn't create that channel."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        aria-label="New channel"
        className="text-muted-foreground hover:text-foreground h-5 w-5 shrink-0 !rounded-md p-0"
        onClick={() => setOpen(true)}
      >
        <Plus size={13} />
      </Button>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New channel</DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">Name</span>
            <Input
              placeholder="e.g. bugs"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Channel name"
              autoFocus
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">Default agent</span>
            <Select
              value={agentId || undefined}
              onValueChange={setAgentId}
              disabled={agents === null || agents.length === 0}
            >
              <SelectTrigger
                showIcon
                aria-label="Default agent"
                className="w-full"
              >
                <SelectValue
                  placeholder={
                    agents === null
                      ? "Loading agents…"
                      : agents.length === 0
                        ? "No agents yet — connect a folder first"
                        : "Pick who answers here"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {(agents ?? []).map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    @{agent.handle} — {agent.folderName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <DialogFooter className="bg-transparent">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || !name.trim() || !agentId}
            >
              {pending ? "Creating…" : "Create channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
