"use client";

import type { Channel } from "@roster/api";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@roster/ui";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { errorMessage, trpc } from "~/utils/trpc";

export interface CreateChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: Channel[];
  orgSlug: string;
}

function repoLabel(channel: Channel): string {
  if (channel.repoOwner && channel.repoName) {
    return `${channel.repoOwner}/${channel.repoName}`;
  }
  if (channel.repoName) return channel.repoName;
  if (channel.repoPath) {
    return channel.repoPath.split("/").filter(Boolean).pop() ?? channel.repoPath;
  }
  return channel.name;
}

export function CreateChannelDialog({
  open,
  onOpenChange,
  channels,
  orgSlug,
}: CreateChannelDialogProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [repoChannelId, setRepoChannelId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repos = useMemo(() => {
    const seen = new Map<string, string>();
    for (const channel of channels) {
      const label = repoLabel(channel);
      if (!seen.has(label)) seen.set(label, channel.id);
    }
    return [...seen.entries()].map(([label, channelId]) => ({
      label,
      channelId,
    }));
  }, [channels]);

  const sourceChannelId = repoChannelId ?? repos[0]?.channelId ?? null;

  function close(next: boolean) {
    if (pending) return;
    setError(null);
    onOpenChange(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0 || !sourceChannelId || pending) return;

    setPending(true);
    setError(null);
    try {
      const created = await trpc.channels.create.mutate({
        name: trimmed,
        sourceChannelId,
      });
      setName("");
      onOpenChange(false);
      router.push(`/${orgSlug}/${created.slug}`);
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause, "The channel could not be created."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create a private channel</DialogTitle>
            <DialogDescription>
              The channel gets its own Superset workspace on the repo you pick,
              and its agent works there.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-channel-name">Name</Label>
            <Input
              id="new-channel-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="growth-experiments"
              maxLength={60}
              autoFocus
            />
          </div>

          {repos.length > 1 ? (
            <div className="flex flex-col gap-1.5">
              <Label>Repository</Label>
              <Select
                value={sourceChannelId ?? undefined}
                onValueChange={setRepoChannelId}
              >
                <SelectTrigger showIcon>
                  <SelectValue placeholder="Pick a repository" />
                </SelectTrigger>
                <SelectContent>
                  {repos.map((repo) => (
                    <SelectItem key={repo.channelId} value={repo.channelId}>
                      {repo.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {repos.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Add a project in settings first — a channel needs a repo to work
              in.
            </p>
          ) : null}

          {error ? <p className="text-sm text-red-500">{error}</p> : null}

          <DialogFooter>
            <Button
              type="submit"
              disabled={pending || name.trim().length === 0 || !sourceChannelId}
            >
              {pending ? "Creating…" : "Create channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
