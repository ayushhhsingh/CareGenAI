import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CardListSkeleton } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { MedicineSearchView } from "@/components/medicine/medicine-search-view";

export const metadata: Metadata = {
  title: "Medicine search",
  description: "Find generic medicines with the identical salt, strength and dosage form, ranked by cost per unit.",
};

export default function MedicinePage() {
  return (
    <>
      <PageHeader
        title="Medicine search"
        description="Enter a branded medicine to see its active salt and every product with the identical composition, strength and dosage form — ranked by what one unit actually costs."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/medicine/verified">Sourced generics &amp; pharmacy links</Link>
          </Button>
        }
      />
      <Suspense fallback={<CardListSkeleton />}>
        <MedicineSearchView />
      </Suspense>
    </>
  );
}
