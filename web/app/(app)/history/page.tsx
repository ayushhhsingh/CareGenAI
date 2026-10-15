import type { Metadata } from "next";

import { RequireAuth } from "@/components/common/require-auth";
import { HistoryView } from "@/components/dashboard/history-view";

export const metadata: Metadata = { title: "History", robots: { index: false } };

export default function HistoryPage() {
  return (
    <RequireAuth>
      <HistoryView />
    </RequireAuth>
  );
}
