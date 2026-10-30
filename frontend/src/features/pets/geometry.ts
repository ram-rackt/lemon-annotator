import type { PetKind } from "./api";

/** Gap between a pet and the window edge. */
export const INSET = 10;
/** Gap between two pets sitting together. */
const GAP = 4;

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}

/** Where a pet's top-left corner may go so all of it stays in the window. */
function room(view: Size, pet: Size) {
  return {
    minX: INSET,
    minY: INSET,
    maxX: Math.max(INSET, view.width - pet.width - INSET),
    maxY: Math.max(INSET, view.height - pet.height - INSET),
  };
}

export function clampTo(view: Size, pet: Size, p: Point): Point {
  const r = room(view, pet);
  return { x: Math.min(Math.max(p.x, r.minX), r.maxX), y: Math.min(Math.max(p.y, r.minY), r.maxY) };
}

/** Cat: bottom-right corner. Dog: bottom-left corner. */
export function homeOf(kind: PetKind, view: Size, pet: Size): Point {
  const r = room(view, pet);
  return { x: kind === "cat" ? r.maxX : r.minX, y: r.maxY };
}

/** Fractions of the room (stored by the API, the same on every screen size) to a position, and back. */
export function fromFraction(view: Size, pet: Size, fx: number, fy: number): Point {
  const r = room(view, pet);
  return { x: r.minX + fx * (r.maxX - r.minX), y: r.minY + fy * (r.maxY - r.minY) };
}
export function toFraction(view: Size, pet: Size, p: Point): { x: number; y: number } {
  const r = room(view, pet);
  const f = (v: number, min: number, max: number) =>
    max > min ? Math.min(Math.max((v - min) / (max - min), 0), 1) : 0;
  return { x: f(p.x, r.minX, r.maxX), y: f(p.y, r.minY, r.maxY) };
}

/** Beside another pet, bottoms level, on its side that faces the middle of the window (so there's room). */
export function beside(anchor: Point, anchorSize: Size, pet: Size, view: Size): Point {
  const toRight = anchor.x + anchorSize.width / 2 < view.width / 2;
  const x = toRight ? anchor.x + anchorSize.width + GAP : anchor.x - pet.width - GAP;
  const y = anchor.y + anchorSize.height - pet.height;
  return clampTo(view, pet, { x, y });
}
