import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

// Each person keeps the same colour everywhere (header, queue, presence badges).
const GRADIENTS = [
  "from-amber-300 to-orange-500",
  "from-emerald-300 to-teal-600",
  "from-sky-300 to-blue-600",
  "from-violet-300 to-purple-600",
  "from-rose-300 to-pink-600",
  "from-lime-300 to-green-600",
  "from-cyan-300 to-sky-600",
  "from-fuchsia-300 to-violet-600",
];

function gradientFor(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0;
  return GRADIENTS[Math.abs(h) % GRADIENTS.length];
}

export function UserAvatar({
  name,
  seed,
  online,
  className,
}: {
  name: string;
  /** Stable id for the colour (defaults to the name). */
  seed?: string;
  /** Shows a green "online" dot. */
  online?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br text-xs font-semibold text-white shadow-sm ring-1 ring-black/10 [text-shadow:0_1px_1px_rgb(0_0_0/0.25)] dark:ring-white/15",
        gradientFor(seed ?? name),
        className,
      )}
    >
      {initials(name)}
      {online && (
        <span className="absolute -right-0.5 -bottom-0.5 size-[30%] min-h-2 min-w-2 rounded-full bg-emerald-500 ring-2 ring-background" />
      )}
    </span>
  );
}
