import React from "react";
import { Badge } from "@nexus/ui";

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  switch (status) {
    case "PAID":
    case "ACTIVE":
    case "PUBLISHED":
      return <Badge variant="success">{status}</Badge>;

    case "PENDING":
    case "PENDING_PAYMENT":
    case "PROCESSING":
    case "DRAFT":
    case "DEACTIVATION_REQUESTED":
      return <Badge variant="warning">{status}</Badge>;

    case "CANCELLED":
    case "FAILED":
    case "REVOKED":
    case "REJECTED":
    case "EXPIRED":
    case "ARCHIVED":
    case "DEACTIVATED":
      return <Badge variant="error">{status}</Badge>;

    default:
      return <Badge variant="info">{status}</Badge>;
  }
}
