"use client";

import { createContext, useContext, useMemo, useState } from "react";

type SearchState = { query: string; setQuery: (next: string) => void };

const AdminSearchContext = createContext<SearchState>({ query: "", setQuery: () => {} });

/**
 * The header search box lives in the shell but filters the screen below it, so
 * the query is shared rather than duplicated per screen.
 */
export function useAdminSearch() {
  return useContext(AdminSearchContext);
}

export function AdminSearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const value = useMemo(() => ({ query, setQuery }), [query]);
  return <AdminSearchContext.Provider value={value}>{children}</AdminSearchContext.Provider>;
}
