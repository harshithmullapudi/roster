"use client";

import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@roster/ui";
import { Clock } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { trpc } from "~/utils/trpc";

const REFETCH_MS = 60_000;
const TICK_MS = 15_000;

export interface UpcomingTask {
  id: string;
  title: string;
  nextRunAt: string;
}

export interface UpcomingTaskChipProps {
  projectId: string;
  tasksHref: string;
  initial: UpcomingTask[];
}

function countdown(nextRunAt: string, now: number): string {
  const minutes = Math.ceil((new Date(nextRunAt).getTime() - now) / 60_000);
  return minutes <= 1 ? "in <1m" : `in ${minutes}m`;
}

export function UpcomingTaskChip({
  projectId,
  tasksHref,
  initial,
}: UpcomingTaskChipProps) {
  const [upcoming, setUpcoming] = useState(initial);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);

    const refetch = setInterval(() => {
      trpc.tasks.upcoming
        .query({ projectId })
        .then((tasks) => {
          setUpcoming(
            tasks
              .filter((task) => task.nextRunAt)
              .map((task) => ({
                id: task.id,
                title: task.title,
                nextRunAt: new Date(task.nextRunAt as Date).toISOString(),
              })),
          );
          setNow(Date.now());
        })
        .catch(() => console.warn("[tasks] upcoming refetch failed"));
    }, REFETCH_MS);

    return () => {
      clearInterval(tick);
      clearInterval(refetch);
    };
  }, [projectId]);

  const visible = upcoming.filter(
    (task) => new Date(task.nextRunAt).getTime() > now,
  );
  if (visible.length === 0) return null;

  const soonest = visible[0]!;
  const extra = visible.length - 1;

  const chip = (
    <span className="text-warning bg-warning/10 flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium">
      <span className="bg-warning h-1.5 w-1.5 shrink-0 animate-pulse rounded-full" />
      <span className="max-w-[20ch] truncate">{soonest.title}</span>
      <span className="shrink-0">
        {extra > 0 ? `+${extra} · ` : "· "}
        {countdown(soonest.nextRunAt, now)}
      </span>
    </span>
  );

  return (
    <span className="flex shrink-0 items-center">
      <span className="bg-border mx-1.5 h-3.5 w-px shrink-0" />
      {extra === 0 ? (
        <Link href={tasksHref} aria-label={`${soonest.title} runs soon`}>
          {chip}
        </Link>
      ) : (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`${visible.length} tasks run soon`}
            >
              {chip}
            </button>
          </PopoverTrigger>
          <PopoverPortal>
            <PopoverContent align="start" sideOffset={6} className="w-64 p-1">
              {visible.map((task, index) => (
                <Link
                  key={task.id}
                  href={tasksHref}
                  className="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                >
                  <Clock size={12} className="text-muted-foreground shrink-0" />
                  <span className="min-w-0 truncate">{task.title}</span>
                  <span
                    className={
                      index === 0
                        ? "text-warning ml-auto shrink-0 text-xs font-medium"
                        : "text-muted-foreground ml-auto shrink-0 text-xs"
                    }
                  >
                    {countdown(task.nextRunAt, now)}
                  </span>
                </Link>
              ))}
            </PopoverContent>
          </PopoverPortal>
        </Popover>
      )}
    </span>
  );
}
