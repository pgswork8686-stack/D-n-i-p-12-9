"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { Button } from "@nexus/ui";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error privately without leaking internal details or URLs into the client DOM
    console.error("Public Storefront Error:", error?.message);
  }, [error]);

  return (
    <main className="min-h-[60vh] flex flex-col items-center justify-center px-6 py-16 text-center font-sans">
      <div className="max-w-md space-y-4">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight">
          Temporarily Unavailable
        </h1>
        <p className="text-gray-600 leading-relaxed">
          We are experiencing a temporary service disruption. Please try refreshing the page or check back shortly.
        </p>
        <div className="flex justify-center gap-3 pt-4">
          <Button variant="primary" onClick={() => reset()}>
            Try Again
          </Button>
          <Link href="/">
            <Button variant="outline">Return Home</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
