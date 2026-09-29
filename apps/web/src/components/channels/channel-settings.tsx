"use client";

import type { ChannelVisibility } from "@roster/api";
import {
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@roster/ui";
import { Check, Globe, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { errorMessage, trpc } from "~/utils/trpc";

export interface ChannelAgentOption {
  id: string;
  handle: string;
  folderName: string;
}

export interface ChannelSettingsProps {
  projectId: string;
  name: string;
  slug: string;
  defaultAgentId: string;
  agents: ChannelAgentOption[];
  visibility: ChannelVisibility;
  canManage: boolean;
}

const VISIBILITY_OPTIONS: {
  value: ChannelVisibility;
  label: string;
  description: string;
  icon: typeof Globe;
}[] = [
  {
    value: "public",
    label: "Public",
    description: "Everyone in the team can find and open this channel.",
    icon: Globe,
  },
  {
    value: "private",
    label: "Private",
    description:
      "Hidden from the team. Only the member who added it — and team admins — can see it.",
    icon: Lock,
  },
];

export function ChannelSettings({
  projectId,
  name,
  slug,
  defaultAgentId,
  agents,
  visibility,
  canManage,
}: ChannelSettingsProps) {
  const router = useRouter();
  const [current, setCurrent] = useState<ChannelVisibility>(visibility);
  const [pending, setPending] = useState<ChannelVisibility | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState(defaultAgentId);
  const [agentPending, setAgentPending] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);

  const chosen = agents.find((agent) => agent.id === agentId);

  async function chooseAgent(next: string) {
    if (!canManage || next === agentId || agentPending) return;

    const previous = agentId;
    setAgentId(next);
    setAgentPending(true);
    setAgentError(null);

    try {
      await trpc.channels.update.mutate({ projectId, defaultAgentId: next });
      router.refresh();
    } catch (cause) {
      setAgentId(previous);
      setAgentError(
        errorMessage(cause, "Couldn't change who answers this channel."),
      );
    } finally {
      setAgentPending(false);
    }
  }

  async function choose(next: ChannelVisibility) {
    if (!canManage || next === current || pending) return;

    const previous = current;
    setCurrent(next);
    setPending(next);
    setError(null);

    try {
      await trpc.channels.update.mutate({ projectId, visibility: next });
      router.refresh();
    } catch (cause) {
      setCurrent(previous);
      setError(errorMessage(cause, "Couldn't change who can see this channel."));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-sm font-medium">About</h2>
        <dl className="bg-background-3 text-foreground mt-2 flex flex-col divide-y rounded text-sm">
          <Row label="Name" value={name} />
          <Row label="Channel" value={`#${slug}`} />
          {chosen ? <Row label="Folder" value={chosen.folderName} /> : null}
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-medium">Default agent</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">
          {canManage
            ? "Who answers when a message lands in this channel. Its folder is where the work happens."
            : "Only team owners and admins can change this."}
        </p>

        <div className="mt-2">
          <Select
            value={agentId}
            disabled={!canManage || agentPending}
            onValueChange={chooseAgent}
          >
            <SelectTrigger showIcon aria-label="Default agent" className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  @{agent.handle} — {agent.folderName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {agentError ? (
          <p className="text-destructive mt-2 text-sm">{agentError}</p>
        ) : null}
      </section>

      <section>
        <h2 className="text-sm font-medium">Visibility</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">
          {canManage
            ? "Who can see this channel in the sidebar."
            : "Only team owners and admins can change this."}
        </p>

        <div className="mt-2 flex flex-col gap-2">
          {VISIBILITY_OPTIONS.map((option) => {
            const selected = current === option.value;
            const Icon = option.icon;

            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                disabled={!canManage || pending !== null}
                onClick={() => choose(option.value)}
                className={cn(
                  "bg-background-3 flex items-start gap-3 rounded p-3 text-left transition-colors",
                  canManage && "hover:bg-grayAlpha-100 cursor-pointer",
                  selected && "ring-primary ring-1",
                  !canManage && "opacity-70",
                )}
              >
                <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {option.label}
                  </span>
                  <span className="text-muted-foreground block text-sm">
                    {option.description}
                  </span>
                </span>
                {selected ? (
                  <Check className="text-primary mt-0.5 size-4 shrink-0" />
                ) : null}
              </button>
            );
          })}
        </div>

        {error ? <p className="text-destructive mt-2 text-sm">{error}</p> : null}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 truncate text-right">{value}</dd>
    </div>
  );
}
