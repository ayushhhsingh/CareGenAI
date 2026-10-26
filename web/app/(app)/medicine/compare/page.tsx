import type { Metadata } from "next";
import { Suspense } from "react";

import { CardListSkeleton } from "@/components/common/states";
import { CompareView } from "@/components/medicine/compare-view";

export const metadata: Metadata = {
  title: "Compare medicines",
  description: "Side-by-side price comparison of branded and generic medicines.",
};

export default function ComparePage() {
  return (
    <Suspense fallback={<CardListSkeleton rows={4} />}>
      <CompareView />
    </Suspense>
  );
}
