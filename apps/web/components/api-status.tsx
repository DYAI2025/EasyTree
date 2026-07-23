"use client";

import { useEffect, useState } from "react";

import { useApiClient } from "../lib/api-client-provider";

type Status = "pruefend" | "erreichbar" | "nicht-erreichbar";

/**
 * Statusanzeige NIE nur über Farbe (EYT-41 A11y-Baseline): jeder Zustand
 * hat Text UND ein Symbol; Farbe ist nur zusätzliche Verstärkung.
 */
const STATUS_PRESENTATION: Record<Status, { icon: string; text: string }> = {
  pruefend: { icon: "…", text: "API-Status wird geprüft" },
  erreichbar: { icon: "✓", text: "API erreichbar" },
  "nicht-erreichbar": { icon: "✕", text: "API nicht erreichbar" },
};

export function ApiStatus() {
  // Der Client kommt ausschließlich injiziert aus dem Kontext —
  // diese Komponente konstruiert nie selbst einen Client (ADR-001 §5).
  const apiClient = useApiClient();
  const [status, setStatus] = useState<Status>("pruefend");

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getHealth()
      .then(() => {
        if (!cancelled) setStatus("erreichbar");
      })
      .catch(() => {
        if (!cancelled) setStatus("nicht-erreichbar");
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  const { icon, text } = STATUS_PRESENTATION[status];
  return (
    <p className={`api-status api-status--${status}`} role="status">
      <span aria-hidden="true" className="api-status__icon">
        {icon}
      </span>{" "}
      {text}
    </p>
  );
}
