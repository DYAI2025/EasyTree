"use client";

import { useMemo, type ReactNode } from "react";

import { createApiClient } from "../lib/api-client";
import { ApiClientProvider } from "../lib/api-client-provider";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Kompositionswurzel der Web-Shell: die EINZIGE Stelle, an der ein
 * ApiClient konstruiert wird. Alle Komponenten erhalten ihn per
 * useApiClient() aus dem Kontext (ADR-001 §5).
 */
export function Providers({ children }: { children: ReactNode }) {
  const client = useMemo(() => createApiClient(API_BASE_URL), []);
  return <ApiClientProvider client={client}>{children}</ApiClientProvider>;
}
