import type { Metadata } from "next";
import { Suspense } from "react";

import { CardListSkeleton } from "@/components/common/states";
import { PageHeader } from "@/components/layout/page-header";
import { VerifiedGenericsView } from "@/components/medicine/verified-generics-view";

export const metadata: Metadata = {
  title: "Sourced generic medicines",
  description:
    "Generic medicines from official lists with the source, verification status and pharmacy links for each record.",
};

export default function VerifiedGenericsPage() {
  return (
    <>
      <PageHeader
        title="Sourced generic medicines"
        description="Every record shows where it came from and whether it is verified. Matches are checked on ingredient, strength, dosage form, route and release type — never on name similarity alone."
      />
      <Suspense fallback={<CardListSkeleton />}>
        <VerifiedGenericsView />
      </Suspense>
    </>
  );
}
