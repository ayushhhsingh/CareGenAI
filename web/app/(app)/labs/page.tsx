import { FileText, FlaskConical, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Lab locator",
  description: "Find nearby diagnostic laboratories and compare test prices.",
};

/**
 * Placeholder. The backend already exposes /api/v1/labs/{nearby,geocode,tests}
 * (Google Places + indicative chain prices); the UI is scheduled for a later phase.
 */
export default function LabsPage() {
  return (
    <>
      <PageHeader
        title="Lab locator"
        description="Find nearby diagnostic laboratories, distances and test prices."
        actions={<Badge variant="outline">Coming soon</Badge>}
      />
      <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-16 text-center">
        <div className="mb-4 grid size-12 place-items-center rounded-full bg-accent">
          <MapPin className="size-6 text-accent-foreground" aria-hidden />
        </div>
        <h2 className="text-lg font-medium">Nearby lab search is on its way</h2>
        <p className="mt-1 max-w-lg text-sm text-muted-foreground">
          You&apos;ll be able to search by location, see laboratories on a map with distance and estimated
          travel time, compare test prices where available and get directions.
        </p>
        <p className="mt-4 max-w-lg text-sm text-muted-foreground">
          In the meantime, diagnostic tests on an uploaded prescription are already recognised and listed.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href="/prescription">
              <FileText /> Upload a prescription
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/medicine">
              <FlaskConical /> Search medicines
            </Link>
          </Button>
        </div>
      </div>
    </>
  );
}
