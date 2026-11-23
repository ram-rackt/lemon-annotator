"use client";

import { Plus } from "lucide-react";
import { useRef, useState } from "react";

import { frameAt } from "@/lib/format";
import { type TimeStore, useCurrentTime } from "@/lib/time-store";
import type { AnnotationEvent, BoundingBox } from "@/lib/types";
import { cn } from "@/lib/utils";

/** A box being drawn for the next capture (or the event being edited), and the time it belongs to. */
export interface DraftBox {
  box: BoundingBox;
  time: number;
}

/** True when `time` falls on the frame the playhead is showing. */
export const onFrame = (playhead: number, time: number, fps: number) => Math.abs(playhead - time) < 0.5 / fps;

// Bright enough to stand out on video; boxes on one frame take them in turn.
const BOX_COLORS = ["#facc15", "#22d3ee", "#f472b6", "#4ade80", "#fb923c", "#60a5fa", "#f87171", "#e879f9"];

/** Each box's colour: boxes on the same frame get different ones, in timeline order. */
export function boxColors(events: AnnotationEvent[], fps: number): Map<string, string> {
  const perFrame = new Map<number, number>();
  const colors = new Map<string, string>();
  for (const ev of events) {
    if (!ev.box) continue;
    const frame = frameAt(ev.timestamp, fps);
    const n = perFrame.get(frame) ?? 0;
    perFrame.set(frame, n + 1);
    colors.set(ev.id, BOX_COLORS[n % BOX_COLORS.length]);
  }
  return colors;
}

/** The colour a new box at `time` gets: the next one after the boxes already on that frame. */
function nextBoxColor(events: AnnotationEvent[], time: number, fps: number): string {
  const frame = frameAt(time, fps);
  const n = events.filter((e) => e.box && frameAt(e.timestamp, fps) === frame).length;
  return BOX_COLORS[n % BOX_COLORS.length];
}

/** The draft box's colour: the edited event keeps its own, a new box takes the next free one. */
export function draftBoxColor(events: AnnotationEvent[], time: number, editingId: string | null, fps: number): string {
  return (editingId && boxColors(events, fps).get(editingId)) || nextBoxColor(events, time, fps);
}

type Corner = "nw" | "ne" | "sw" | "se";
type Point = { x: number; y: number };
type Drag = { kind: "new"; start: Point } | { kind: "move"; start: Point } | { kind: "resize"; fixed: Point };

// Smaller than this (a fraction of the frame) is a stray click, not a box.
const MIN_SIZE = 0.005;
const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const boxFrom = (a: Point, b: Point): BoundingBox => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

/** The corner opposite `corner`, which stays put while `corner` is dragged. */
const oppositeOf = (b: BoundingBox, corner: Corner): Point => ({
  x: corner.includes("w") ? b.x + b.width : b.x,
  y: corner.includes("n") ? b.y + b.height : b.y,
});

interface Props {
  timeStore: TimeStore;
  fps: number;
  /** Box mode: drag to draw, drag the box to move it, drag a corner to resize it. */
  drawing: boolean;
  draft: DraftBox | null;
  onDraw: (box: BoundingBox) => void;
  /** All events (boxes show on their own frame); the one being edited is shown as the draft. */
  events: AnnotationEvent[];
  editingId: string | null;
  onSelect: (ev: AnnotationEvent) => void;
  /** "+ Add box": save the box being drawn (if any) and start another on this frame. */
  onAddBox: () => void;
}

/** Boxes over the video picture. Positioned by the player exactly over the frame (not the letterbox). */
export function BoxLayer({ timeStore, fps, drawing, draft, onDraw, events, editingId, onSelect, onAddBox }: Props) {
  const t = useCurrentTime(timeStore);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [live, setLive] = useState<BoundingBox | null>(null);

  const draftHere = draft && onFrame(t, draft.time, fps) ? draft.box : null;
  const shown = live ?? draftHere;
  const colors = boxColors(events, fps);
  const shownColor = draftBoxColor(events, draftHere ? draft!.time : t, editingId, fps);
  const saved = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.box && event.id !== editingId && onFrame(t, event.timestamp, fps));

  const pointAt = (e: React.PointerEvent): Point => {
    const r = ref.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!drawing || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointAt(e);
    const target = (e.target as HTMLElement).dataset;
    if (draftHere && target.corner)
      drag.current = { kind: "resize", fixed: oppositeOf(draftHere, target.corner as Corner) };
    else if (draftHere && target.box) drag.current = { kind: "move", start: p };
    else drag.current = { kind: "new", start: p };
    if (drag.current.kind === "new") setLive(boxFrom(p, p));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = pointAt(e);
    if (d.kind === "new") setLive(boxFrom(d.start, p));
    else if (d.kind === "resize") setLive(boxFrom(d.fixed, p));
    else if (draftHere) {
      setLive({
        ...draftHere,
        x: clamp(draftHere.x + p.x - d.start.x, 0, 1 - draftHere.width),
        y: clamp(draftHere.y + p.y - d.start.y, 0, 1 - draftHere.height),
      });
    }
  };

  const onPointerUp = () => {
    if (live && live.width >= MIN_SIZE && live.height >= MIN_SIZE) onDraw(live);
    drag.current = null;
    setLive(null);
  };

  return (
    <div
      ref={ref}
      className={cn("absolute inset-0 touch-none select-none", drawing ? "cursor-crosshair" : "pointer-events-none")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {saved.map(({ event, index }) => {
        const color = colors.get(event.id);
        return (
          <div
            key={event.id}
            className={cn("absolute border-2", drawing && "opacity-60")}
            style={{ ...place(event.box!), borderColor: color }}
          >
            <button
              type="button"
              onClick={() => onSelect(event)}
              className={cn(
                "absolute -top-px left-0 max-w-48 -translate-y-full truncate rounded-t px-1.5 py-0.5 text-[11px] font-medium text-black",
                drawing ? "pointer-events-none" : "pointer-events-auto",
              )}
              style={{ backgroundColor: color }}
              title="Edit this event"
            >
              #{index + 1}
              {event.event_name ? ` ${event.event_name}` : ""}
            </button>
          </div>
        );
      })}

      {shown && (
        <div
          data-box="1"
          className={cn("absolute border-2 shadow-[0_0_0_1px_rgb(0_0_0/0.5)]", drawing && "cursor-move")}
          // The fill is the border colour at ~10% opacity (#rrggbb + alpha).
          style={{ ...place(shown), borderColor: shownColor, backgroundColor: `${shownColor}1a` }}
        >
          {drawing &&
            CORNERS.map((c) => (
              <span
                key={c}
                data-corner={c}
                className={cn(
                  "absolute size-2.5 rounded-[2px] border border-black/60",
                  c.includes("n") ? "-top-1.5" : "-bottom-1.5",
                  c.includes("w") ? "-left-1.5" : "-right-1.5",
                  c === "nw" || c === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize",
                )}
                style={{ backgroundColor: shownColor }}
              />
            ))}
        </div>
      )}

      {drawing && !shown && (
        <p className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs whitespace-nowrap text-white">
          {saved.length ? "Drag to draw another box" : "Drag to draw a box"} · Esc to stop
        </p>
      )}

      {/* On a frame that already has a box: add the next one (not while editing one). */}
      {!editingId && (saved.length > 0 || (drawing && draftHere)) && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()} // not the start of a new box
          onClick={onAddBox}
          title={draftHere ? "Save this box and draw another (B)" : "Draw another box on this frame (B)"}
          className="pointer-events-auto absolute right-2 bottom-2 flex cursor-pointer items-center gap-1 rounded-md bg-black/75 px-2 py-1 text-xs font-medium text-white ring-1 ring-white/25 hover:bg-black/90"
        >
          <Plus className="size-3.5" /> Add box
        </button>
      )}
    </div>
  );
}

const place = (b: BoundingBox): React.CSSProperties => ({
  left: `${b.x * 100}%`,
  top: `${b.y * 100}%`,
  width: `${b.width * 100}%`,
  height: `${b.height * 100}%`,
});
