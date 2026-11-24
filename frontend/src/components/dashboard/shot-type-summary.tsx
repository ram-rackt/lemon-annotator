"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useShotTypeStats } from "@/hooks/queries";
import { useHydrated } from "@/hooks/use-hydrated";

/**
 * Home page: how many completed videos there are of each shot type across the workspace, as ranked bars
 * (largest first, one hue). Shown only to the workspaces it's offered to (`available`), and only once
 * loaded, so nobody else sees it flash in and out.
 */
export function ShotTypeSummary() {
  const hydrated = useHydrated();
  const { data } = useShotTypeStats();
  if (!hydrated || !data?.available) return null;

  const max = Math.max(1, ...data.shot_types.map((s) => s.count));
  const counted = data.completed - data.without_shot_type;

  return (
    <section aria-labelledby="shot-types-title" className="mt-10 rounded-xl border bg-card p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="shot-types-title" className="font-medium">
          Completed videos by shot type
        </h2>
        <p className="text-xs text-muted-foreground tabular-nums">
          {counted.toLocaleString()} video{counted === 1 ? "" : "s"} · {data.shot_types.length} shot type
          {data.shot_types.length === 1 ? "" : "s"}
          {data.without_shot_type > 0 && ` · ${data.without_shot_type} completed without a shot type`}
        </p>
      </div>

      {data.shot_types.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No completed videos with a shot type yet. They appear here once a video with its Shot Type set is saved as
          completed.
        </p>
      ) : (
        // The list is its own table view: every shot type's name and count are written out.
        <ul className="grid gap-x-10 gap-y-1 lg:grid-cols-2">
          {data.shot_types.map((s) => (
            <li key={s.shot_type}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    tabIndex={0}
                    className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_2.5rem] items-center gap-3 rounded-md px-1.5 py-1.5 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span className="truncate text-sm">{s.label}</span>
                    <span aria-hidden className="h-2.5">
                      {/* Square at the baseline, 4px rounded at the data end. */}
                      <span
                        className="block h-full rounded-r-[4px] bg-[#2a78d6] dark:bg-[#3987e5]"
                        style={{ width: `${(s.count / max) * 100}%` }}
                      />
                    </span>
                    <span className="text-right text-sm font-medium tabular-nums">{s.count}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" align="start">
                  <p className="font-medium">
                    {s.label}: {s.count} completed
                  </p>
                  {s.projects.map((p) => (
                    <p key={p.project_id} className="tabular-nums opacity-80">
                      {p.project_name} · {p.count}
                    </p>
                  ))}
                </TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
