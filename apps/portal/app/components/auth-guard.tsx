"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/auth-context";
import { Skeleton } from "./skeleton";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, token, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && (!token || !user)) {
      router.push("/login");
    }
  }, [isLoading, token, user, router]);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto py-16 px-6 space-y-6">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-6 w-1/2" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!token || !user) {
    return null;
  }

  return <>{children}</>;
}
