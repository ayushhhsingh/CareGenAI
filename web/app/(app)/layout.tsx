import { Suspense } from "react";

import { AppHeader } from "@/components/layout/app-header";
import { Logo } from "@/components/layout/logo";
import { MobileNav } from "@/components/layout/mobile-nav";

/** Static shell shown while the pathname-aware header streams in on dynamic routes. */
function HeaderFallback() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90">
      <div className="mx-auto flex h-14 max-w-7xl items-center px-4 sm:px-6">
        <Logo href="/dashboard" />
      </div>
    </header>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <Suspense fallback={<HeaderFallback />}>
        <AppHeader />
      </Suspense>
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pt-6 pb-28 sm:px-6 lg:pb-12">
        {children}
      </main>
      <Suspense fallback={null}>
        <MobileNav />
      </Suspense>
    </div>
  );
}
