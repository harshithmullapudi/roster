"use client";

import type { ChannelGroups, Task, TaskStatus } from "@roster/api";
import { AvatarText, Button, cn } from "@roster/ui";
import { CircleCheck, Folder, Inbox, Repeat } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  List,
  type Index,
  type ListRowProps,
} from "react-virtualized";

import { describeRecurrence } from "@roster/api/client";

import { relativeTime } from "~/utils/relative-time";
import {
  buildRows,
  channelKey,
  filterTasks,
  type TaskFilters,
  type TaskGroupBy,
} from "~/utils/task-rows";
import { errorMessage, trpc } from "~/utils/trpc";

import { ChannelPicker } from "./channel-picker";
import { StatusPicker } from "./status-picker";
import { TASK_STATUS_META, taskStatusColor } from "./task-status";
import { TaskToolbar } from "./task-toolbar";

export interface TaskListProps {
  tasks: Task[];
  channels: ChannelGroups;
  orgSlug: string;
}

function parseList(value: string | null): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

function recurrenceLabel(task: Task): string | null {
  if (!task.rrule) return null;

  let rule: string;
  try {
    rule = describeRecurrence(task.rrule);
  } catch {
    rule = task.rrule;
  }

  if (!task.nextRunAt) return rule;
  return `${rule} · next ${new Date(task.nextRunAt).toLocaleString()}`;
}

export function TaskList({ tasks, channels, orgSlug }: TaskListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, TaskStatus>>({});
  const [assigning, setAssigning] = useState<string | null>(null);

  useEffect(() => setOverrides({}), [tasks]);

  const groupBy: TaskGroupBy =
    searchParams.get("group") === "channel" ? "channel" : "status";

  const filters: TaskFilters = useMemo(
    () => ({
      statuses: parseList(searchParams.get("status")) as TaskStatus[],
      channels: parseList(searchParams.get("channel")),
    }),
    [searchParams],
  );

  const updateParams = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const resolved = useMemo(
    () =>
      tasks.map((task) =>
        overrides[task.id] ? { ...task, status: overrides[task.id]! } : task,
      ),
    [tasks, overrides],
  );

  const rows = useMemo(
    () => buildRows(filterTasks(resolved, filters), groupBy),
    [resolved, filters, groupBy],
  );

  const channelKeys = useMemo(
    () => [...new Set(tasks.map(channelKey))].sort(),
    [tasks],
  );

  const cacheRef = useRef(
    new CellMeasurerCache({ defaultHeight: 44, fixedWidth: true }),
  );
  const cache = cacheRef.current;

  useEffect(() => {
    cache.clearAll();
  }, [cache, rows.length, groupBy]);

  const setStatus = useCallback(
    async (taskId: string, status: TaskStatus) => {
      setOverrides((current) => ({ ...current, [taskId]: status }));
      setError(null);
      try {
        await trpc.tasks.setStatus.mutate({ taskId, status });
        router.refresh();
      } catch (cause) {
        setOverrides((current) => {
          const next = { ...current };
          delete next[taskId];
          return next;
        });
        setError(errorMessage(cause, "Could not update the task."));
      }
    },
    [router],
  );

  const assign = useCallback(
    async (taskId: string, projectId: string) => {
      setAssigning(taskId);
      setError(null);
      try {
        await trpc.tasks.assign.mutate({ taskId, projectId });
        router.refresh();
      } catch (cause) {
        setError(errorMessage(cause, "Could not assign the task."));
      } finally {
        setAssigning(null);
      }
    },
    [router],
  );

  const rowHeight = useCallback(
    ({ index }: Index) =>
      Math.max(
        cache.getHeight(index, 0),
        rows[index]?.type === "header" ? 36 : 44,
      ),
    [cache, rows],
  );

  const rowRenderer = useCallback(
    ({ index, key, style, parent }: ListRowProps) => {
      const row = rows[index];
      if (!row) return null;

      return (
        <CellMeasurer
          key={key}
          cache={cache}
          columnIndex={0}
          parent={parent}
          rowIndex={index}
        >
          <div style={style}>
            {row.type === "header" ? (
              <div className="flex items-center gap-2 px-3 pb-1 pt-3">
                <span
                  className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-medium"
                  style={
                    row.status
                      ? {
                          backgroundColor: taskStatusColor(row.status)
                            .background,
                          color: taskStatusColor(row.status).color,
                        }
                      : undefined
                  }
                >
                  {row.status ? (
                    TASK_STATUS_META[row.status].label
                  ) : (
                    <>
                      {row.backlog ? <Inbox size={12} /> : <Folder size={12} />}
                      {row.label}
                    </>
                  )}
                </span>
                <span className="text-muted-foreground text-xs">
                  {row.count}
                </span>
              </div>
            ) : (
              <div className="group hover:bg-accent/50 mx-2 flex items-center gap-2 rounded-lg px-2 py-2">
                <StatusPicker
                  value={row.task.status}
                  onChange={(status) => void setStatus(row.task.id, status)}
                  variant="bare"
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      "truncate text-sm",
                      row.task.status === "done" &&
                        "text-muted-foreground line-through",
                    )}
                  >
                    {row.task.title}
                  </span>
                  {recurrenceLabel(row.task) && (
                    <span className="text-muted-foreground flex items-center gap-1 truncate text-xs">
                      <Repeat size={11} className="shrink-0" />
                      {recurrenceLabel(row.task)}
                    </span>
                  )}
                  {row.task.recurrenceDisabledReason && (
                    <span className="text-warning truncate text-xs">
                      {row.task.recurrenceDisabledReason}
                    </span>
                  )}
                </span>
                {row.task.channelSlug ? (
                  groupBy !== "channel" && (
                    <Link
                      href={
                        row.task.threadId
                          ? `/${orgSlug}/${row.task.channelSlug}?thread=${row.task.threadId}`
                          : `/${orgSlug}/${row.task.channelSlug}`
                      }
                      className="text-muted-foreground hover:text-foreground hidden shrink-0 items-center gap-0.5 text-xs sm:flex"
                    >
                      <Folder size={11} />
                      {row.task.channelSlug}
                    </Link>
                  )
                ) : (
                  <ChannelPicker
                    channels={channels}
                    value={null}
                    disabled={assigning === row.task.id}
                    onChange={(projectId) => {
                      if (projectId) void assign(row.task.id, projectId);
                    }}
                  />
                )}
                {row.task.createdBy && (
                  <span
                    className="hidden shrink-0 sm:flex"
                    title={`Filed by ${row.task.createdBy.name}`}
                  >
                    <AvatarText
                      text={row.task.createdBy.name}
                      className="h-5 w-5 rounded-md text-[10px]"
                    />
                  </span>
                )}
                <span className="text-muted-foreground w-16 shrink-0 text-right text-xs">
                  {relativeTime(row.task.createdAt)}
                </span>
              </div>
            )}
          </div>
        </CellMeasurer>
      );
    },
    [rows, cache, setStatus, groupBy, channels, orgSlug, assign, assigning],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TaskToolbar
        filters={filters}
        onFiltersChange={(next) =>
          updateParams({
            status: next.statuses.join(",") || null,
            channel: next.channels.join(",") || null,
          })
        }
        groupBy={groupBy}
        onGroupByChange={(next) =>
          updateParams({ group: next === "status" ? null : next })
        }
        channelKeys={channelKeys}
      />

      {error && (
        <p className="text-destructive px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <CircleCheck className="text-muted-foreground size-7" />
          <p className="text-muted-foreground text-sm">
            {tasks.length === 0
              ? "No tasks yet"
              : "No tasks match these filters"}
          </p>
          {tasks.length === 0 && (
            <p className="text-muted-foreground max-w-xs text-center text-xs">
              An agent files these with{" "}
              <code className="font-mono">roster tasks create</code> from inside
              a channel.
            </p>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <AutoSizer>
            {({ width, height }) => (
              <List
                height={height}
                width={width}
                rowCount={rows.length}
                rowHeight={rowHeight}
                rowRenderer={rowRenderer}
                deferredMeasurementCache={cache}
                overscanRowCount={8}
              />
            )}
          </AutoSizer>
        </div>
      )}
    </div>
  );
}
