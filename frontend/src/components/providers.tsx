"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";

import { AuthGate } from "@/components/auth/auth-gate";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Pets } from "@/features/pets/pets";
import { ApiError } from "@/lib/api";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            staleTime: 30_000,
            retry: (failureCount, error) => {
              // Unreachable: a hosted server asleep on a free plan takes up to a minute to wake up.
              if (error instanceof ApiError && error.status === 0) return failureCount < 6;
              // Don't hammer S3 with retries for errors that won't fix themselves.
              return !(error instanceof ApiError && error.status < 500) && failureCount < 2;
            },
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
          },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <AuthGate>
            {children}
            <Pets />
          </AuthGate>
          <Toaster position="bottom-center" closeButton />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
