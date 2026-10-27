"use client";

import { Flag, FolderKanban } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useReviewAll } from "@/hooks/queries";
import { useHydrated } from "@/hooks/use-hydrated";
import { cn } from "@/lib/utils";

/** Projects | Coach review, in the header of the pages that span every project. */
export function DashboardNav() {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const reviewQ = useReviewAll();
  // Match the server HTML during hydration.
  const flagged = hydrated ? reviewQ.data?.reduce((n, p) => n + p.videos.length, 0) : undefined;

  const tabs = [
    { href: "/", label: "Projects", icon: FolderKanban, count: undefined },
    { href: "/review", label: "Coach review", icon: Flag, count: flagged },
  ];

  return (
    <nav className="flex shrink-0 items-center gap-1">
      {tabs.map(({ href, label, icon: Icon, count }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "flex h-10 items-center gap-2 rounded-lg px-3.5 text-[15px] transition-colors",
            pathname === href ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-[18px]" />
          <span className="hidden sm:inline">{label}</span>
          {count != null && count > 0 && (
            <span className="rounded-md bg-violet-500/15 px-1.5 text-xs font-medium text-violet-700 tabular-nums dark:text-violet-300">
              {count}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
