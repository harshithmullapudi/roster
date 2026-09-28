"use client";

import { TASK_STATUS_ORDER, type TaskStatus } from "@roster/api/client";
import {
  Badge,
  Button,
  Checkbox,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@roster/ui";
import { Check, Folder, Inbox, ListFilter, X } from "lucide-react";
import { useState } from "react";

import {
  UNASSIGNED,
  UNASSIGNED_LABEL,
  type TaskFilters,
  type TaskGroupBy,
} from "~/utils/task-rows";

import { TASK_STATUS_META, TaskStatusIcon } from "./task-status";

export interface TaskToolbarProps {
  filters: TaskFilters;
  onFiltersChange: (filters: TaskFilters) => void;
  groupBy: TaskGroupBy;
  onGroupByChange: (groupBy: TaskGroupBy) => void;
  channelKeys: string[];
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

function channelLabel(key: string): string {
  return key === UNASSIGNED ? UNASSIGNED_LABEL : key;
}

function ChannelIcon({ channelKey }: { channelKey: string }) {
  return channelKey === UNASSIGNED ? (
    <Inbox size={13} className="text-muted-foreground" />
  ) : (
    <Folder size={13} className="text-muted-foreground" />
  );
}

export function TaskToolbar({
  filters,
  onFiltersChange,
  groupBy,
  onGroupByChange,
  channelKeys,
}: TaskToolbarProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);

  const activeCount = filters.statuses.length + filters.channels.length;

  return (
    <div className="border-border flex items-center gap-2 border-b px-3 py-1">
      <Popover open={filterOpen} onOpenChange={setFilterOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="gap-1.5 rounded-md px-2.5 text-sm"
          >
            <ListFilter size={14} />
            Filter
            {activeCount > 0 && (
              <Badge variant="secondary" className="ml-0.5 px-1.5 text-xs">
                {activeCount}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
        <PopoverContent className="w-60 p-0" align="start">
          <Command>
            <CommandInput placeholder="Filter by..." autoFocus />
            <CommandList>
              <CommandEmpty className="text-muted-foreground py-4 text-sm">
                Nothing to filter on.
              </CommandEmpty>

              <CommandGroup heading="Status">
                {TASK_STATUS_ORDER.map((status) => (
                  <CommandItem
                    key={status}
                    value={`status ${TASK_STATUS_META[status].label}`}
                    onSelect={() =>
                      onFiltersChange({
                        ...filters,
                        statuses: toggle(filters.statuses, status),
                      })
                    }
                  >
                    <Checkbox
                      checked={filters.statuses.includes(status)}
                      className="border-muted-foreground/50 pointer-events-none"
                    />
                    <TaskStatusIcon status={status} size={15} />
                    <span className="flex-1">
                      {TASK_STATUS_META[status].label}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>

              {channelKeys.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Channel">
                    {channelKeys.map((key) => (
                      <CommandItem
                        key={key}
                        value={`channel ${channelLabel(key)}`}
                        onSelect={() =>
                          onFiltersChange({
                            ...filters,
                            channels: toggle(filters.channels, key),
                          })
                        }
                      >
                        <Checkbox
                          checked={filters.channels.includes(key)}
                          className="border-muted-foreground/50 pointer-events-none"
                        />
                        <ChannelIcon channelKey={key} />
                        <span className="flex-1 truncate">
                          {channelLabel(key)}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
        </PopoverPortal>
      </Popover>

      {filters.statuses.map((status) => (
        <Badge
          key={status}
          variant="secondary"
          className="h-(--btn-h-default) items-center gap-1.5 rounded-md px-2.5 font-normal"
        >
          <TaskStatusIcon status={status} size={13} />
          {TASK_STATUS_META[status].label}
          <button
            type="button"
            aria-label={`Clear ${TASK_STATUS_META[status].label} filter`}
            onClick={() =>
              onFiltersChange({
                ...filters,
                statuses: toggle(filters.statuses, status),
              })
            }
          >
            <X className="hover:text-destructive size-3.5" />
          </button>
        </Badge>
      ))}

      {filters.channels.map((key) => (
        <Badge
          key={key}
          variant="secondary"
          className="h-(--btn-h-default) items-center gap-1.5 rounded-md px-2.5 font-normal"
        >
          {key === UNASSIGNED ? <Inbox size={12} /> : <Folder size={12} />}
          {channelLabel(key)}
          <button
            type="button"
            aria-label={`Clear ${channelLabel(key)} filter`}
            onClick={() =>
              onFiltersChange({
                ...filters,
                channels: toggle(filters.channels, key),
              })
            }
          >
            <X className="hover:text-destructive size-3.5" />
          </button>
        </Badge>
      ))}

      <Popover open={groupOpen} onOpenChange={setGroupOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="text-muted-foreground ml-auto gap-1.5 rounded-md px-2.5 text-sm"
          >
            Group by:
            <span className="text-foreground">
              {groupBy === "status" ? "Status" : "Channel"}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
        <PopoverContent className="w-44 p-0" align="end">
          <Command>
            <CommandList>
              <CommandGroup>
                {(["status", "channel"] as const).map((option) => (
                  <CommandItem
                    key={option}
                    value={option}
                    onSelect={() => {
                      onGroupByChange(option);
                      setGroupOpen(false);
                    }}
                  >
                    <span className="flex-1 capitalize">{option}</span>
                    {groupBy === option && <Check size={14} />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
        </PopoverPortal>
      </Popover>
    </div>
  );
}
