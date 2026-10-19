import React from "react";
import { Badge } from "@nexus/ui";
import { statusPresentation, type StatusKind } from "../lib/status-labels";

interface StatusBadgeProps {
  status: string;
  /** Disambiguates codes that read differently per module (e.g. entitlement ACTIVE). */
  kind?: StatusKind;
}

export function StatusBadge({ status, kind }: StatusBadgeProps) {
  const { label, tone, glyph } = statusPresentation(status, kind);
  return (
    <Badge variant={tone}>
      <span aria-hidden="true" className="mr-1">{glyph}</span>
      {label}
    </Badge>
  );
}
