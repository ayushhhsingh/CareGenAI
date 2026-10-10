import type { Metadata } from "next";
import { Suspense } from "react";

import { RegisterForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Create account" };

export default function Page() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
