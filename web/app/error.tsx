"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function GlobalRouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-4 text-center" role="alert">
      <AlertTriangle className="size-8 text-destructive" aria-hidden />
      <div>
        <h1 className="text-xl font-semibold">This page failed to load</h1>
        <p className="mt-1 text-sm text-muted-foreground">An unexpected error occurred. Please try again.</p>
      </div>
      <div className="flex gap-2">
        <Button onClick={reset}>
          <RefreshCw /> Try again
        </Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
