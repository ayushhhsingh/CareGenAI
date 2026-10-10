import type { Metadata } from "next";

import { RequireAuth } from "@/components/common/require-auth";
import { AdminView } from "@/components/dashboard/admin-view";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

export default function AdminPage() {
  return (
    <RequireAuth admin>
      <AdminView />
    </RequireAuth>
  );
}
