"use client";

import type { SearchResults } from "@roster/api";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { searchable, searchKey } from "~/utils/search";
import { trpc } from "~/utils/trpc";

const DEBOUNCE_MS = 150;

const EMPTY: SearchResults = { messages: [], tasks: [] };

export function useSearch(args: {
  query: string;
  projectId?: string;
  enabled?: boolean;
}): { results: SearchResults; pending: boolean } {
  const [settled, setSettled] = useState(args.query);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(args.query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [args.query]);

  const enabled = (args.enabled ?? true) && searchable(settled);

  const { data, isFetching } = useQuery({
    queryKey: searchKey(settled, args.projectId),
    queryFn: () =>
      trpc.search.all.query({ query: settled, projectId: args.projectId }),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  return {
    results: enabled ? (data ?? EMPTY) : EMPTY,
    pending: enabled && (isFetching || settled !== args.query),
  };
}
