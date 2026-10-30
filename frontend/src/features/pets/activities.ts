import type { PetKind } from "./api";
import type { Point, Size } from "./geometry";

/** A pet's poses (each a sticker from the sheet); the cat has no "run" or "ball", the dog no "heart". */
export type Pose = "idle" | "jump" | "run" | "heart" | "ball" | "sleep" | "roll" | "bow";
export type Overlay = "shuttle" | "ball" | "hug" | "costume" | "cuddle";

/** What an activity can do with the two pets sitting side by side. Everything is undone when it ends. */
export interface Ctx {
  /** Top-left corner and size of each pet where it sits. */
  pos: Record<PetKind, Point>;
  size: Record<PetKind, Size>;
  overlaySize: Record<Overlay, Size>;
  /** Up the screen, or down when the pets sit at the very top (so nothing leaves the window). */
  up: Point;
  pose(kind: PetKind, pose: Pose): void;
  /** Face left (< 0), right (> 0), or the sticker's own way (0). */
  face(kind: PetKind, direction: number): void;
  /** Jump `height` px up and back down. */
  hop(kind: PetKind, height: number, ms: number): Promise<void>;
  /** Move a pet through offsets from where it sits (it stays at the last one until the end). */
  path(kind: PetKind, frames: { x: number; y: number; opacity?: number }[], ms: number, easing?: string): Promise<void>;
  /** Animate the pet itself in place (spin, wiggle, breathe). */
  body(kind: PetKind, frames: Keyframe[], ms: number): Promise<void>;
  /** Show an overlay centred on a point (kept inside the window), animated with `frames`. */
  overlay(name: Overlay, center: Point, frames: Keyframe[], ms: number, easing?: string): Promise<void>;
  /** A small heart floating up from a point. */
  heart(at: Point, delay?: number): void;
  wait(ms: number): Promise<void>;
  /** True once the activity has been interrupted (a drag, a move, a newer activity). */
  stopped(): boolean;
}

const KINDS: PetKind[] = ["cat", "dog"];
const centerOf = (ctx: Ctx, kind: PetKind): Point => ({
  x: ctx.pos[kind].x + ctx.size[kind].width / 2,
  y: ctx.pos[kind].y + ctx.size[kind].height / 2,
});
const middle = (ctx: Ctx): Point => {
  const c = centerOf(ctx, "cat");
  const d = centerOf(ctx, "dog");
  return { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
};
const faceEachOther = (ctx: Ctx) => {
  const c = centerOf(ctx, "cat");
  const d = centerOf(ctx, "dog");
  ctx.face("cat", d.x - c.x);
  ctx.face("dog", c.x - d.x);
};
const both = (fn: (kind: PetKind) => Promise<void>) => Promise.all(KINDS.map(fn)).then(() => undefined);
const above = (ctx: Ctx, p: Point, by: number): Point => ({ x: p.x + ctx.up.x * by, y: p.y + ctx.up.y * by });

/**
 * Both run into the middle and become one sticker (hug, costume, cuddle) for `holdMs`, then come back.
 * `during` runs while the sticker shows.
 */
async function together(ctx: Ctx, overlay: Overlay, holdMs: number, during?: (at: Point) => Promise<void>) {
  const mid = middle(ctx);
  KINDS.forEach((k) => ctx.pose(k, k === "dog" ? "run" : "jump"));
  const toMiddle = (k: PetKind) => {
    const c = centerOf(ctx, k);
    return ctx.path(
      k,
      [
        { x: 0, y: 0 },
        { x: (mid.x - c.x) * 0.8, y: (mid.y - c.y) * 0.8, opacity: 0 },
      ],
      450,
    );
  };
  // The sticker pops in as they arrive (450 ms), stays for holdMs, and fades as they go back (350 ms).
  const total = 450 + holdMs + 350;
  const shown = ctx.overlay(
    overlay,
    mid,
    [
      { opacity: 0, transform: "scale(0.6)", offset: 0 },
      { opacity: 0, transform: "scale(0.6)", offset: 180 / total },
      { opacity: 1, transform: "scale(1.12)", offset: 360 / total },
      { opacity: 1, transform: "scale(1)", offset: 450 / total },
      { opacity: 1, transform: "scale(1)", offset: (450 + holdMs) / total },
      { opacity: 0, transform: "scale(1)", offset: 1 },
    ],
    total,
  );
  await both(toMiddle);
  if (ctx.stopped()) return;
  KINDS.forEach((k) => ctx.pose(k, "idle"));
  await Promise.all([during ? during(mid) : ctx.wait(holdMs), ctx.wait(holdMs)]);
  if (ctx.stopped()) return;
  // Back to their places as the sticker fades.
  await both((k) =>
    ctx.path(
      k,
      [
        { x: 0, y: 0, opacity: 0 },
        { x: 0, y: 0, opacity: 1 },
      ],
      350,
    ),
  );
  await shown;
}

/* -------------------------------------------------------------------------- */
/* The activities: about 5 seconds each                                       */
/* -------------------------------------------------------------------------- */

/** Badminton: four shots, the shuttle arcing between their paws, then a happy bounce. */
async function rally(ctx: Ctx) {
  faceEachOther(ctx);
  await both((k) => ctx.hop(k, 12, 350));
  if (ctx.stopped()) return;
  const c = centerOf(ctx, "cat");
  const d = centerOf(ctx, "dog");
  const len = Math.hypot(d.x - c.x, d.y - c.y) || 1;
  const toDog = { x: (d.x - c.x) / len, y: (d.y - c.y) / len };
  const paw = (p: Point, dir: Point) => ({ x: p.x + dir.x * 14 + ctx.up.x * 14, y: p.y + dir.y * 14 + ctx.up.y * 14 });
  const paws = { cat: paw(c, toDog), dog: paw(d, { x: -toDog.x, y: -toDog.y }) };
  const shot = (from: Point, to: Point): Keyframe[] =>
    Array.from({ length: 13 }, (_, i) => {
      const t = i / 12;
      const lift = 4 * 60 * t * (1 - t); // 60 px high at the top of the arc
      const climb = 4 * 60 * (1 - 2 * t);
      const vx = to.x - from.x + ctx.up.x * climb;
      const vy = to.y - from.y + ctx.up.y * climb;
      // Cork first: the shuttle sticker's cork points down-right (about 40 degrees).
      const angle = (Math.atan2(vy, vx) * 180) / Math.PI - 40;
      const x = from.x + (to.x - from.x) * t + ctx.up.x * lift;
      const y = from.y + (to.y - from.y) * t + ctx.up.y * lift;
      return { transform: `translate(${x - c.x}px, ${y - c.y}px) rotate(${angle}deg)`, opacity: 1 };
    });
  for (let i = 0; i < 4; i++) {
    const hitter: PetKind = i % 2 ? "dog" : "cat";
    const other: PetKind = i % 2 ? "cat" : "dog";
    ctx.pose(hitter, "jump");
    const flight = ctx.overlay("shuttle", c, shot(paws[hitter], paws[other]), 650, "linear");
    await ctx.hop(hitter, 10, 320);
    if (ctx.stopped()) return;
    ctx.pose(hitter, "idle");
    await flight;
    if (ctx.stopped()) return;
  }
  KINDS.forEach((k) => ctx.pose(k, "jump"));
  ctx.heart(above(ctx, middle(ctx), 20));
  await both((k) => ctx.hop(k, 14, 400).then(() => ctx.hop(k, 8, 300)));
}

/** A big hug, hearts floating up. */
async function hug(ctx: Ctx) {
  faceEachOther(ctx);
  await both((k) => ctx.hop(k, 10, 300));
  if (ctx.stopped()) return;
  await together(ctx, "hug", 3200, async (at) => {
    for (let i = 0; i < 4; i++) ctx.heart(above(ctx, { x: at.x + (i % 2 ? 14 : -10), y: at.y }, 26), i * 700);
    await ctx.wait(3200);
  });
}

/** Dress-up: a spin, then the frog and pink hoodies, bouncing. */
async function dressUp(ctx: Ctx) {
  KINDS.forEach((k) => ctx.pose(k, "jump"));
  await both((k) => ctx.body(k, [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], 600));
  if (ctx.stopped()) return;
  await together(ctx, "costume", 3000, async (at) => {
    for (let i = 0; i < 3; i++) {
      await ctx.overlay(
        "costume",
        at,
        [
          { transform: "translate(0, 0)" },
          { transform: `translate(${ctx.up.x * 10}px, ${ctx.up.y * 10}px)` },
          { transform: "translate(0, 0)" },
        ],
        1000,
      );
      if (ctx.stopped()) return;
    }
  });
}

/** Nap: each curls up asleep, then they cuddle on the cushion, then wake with a stretch. */
async function nap(ctx: Ctx) {
  KINDS.forEach((k) => ctx.pose(k, "sleep"));
  const breathe: Keyframe[] = [
    { transform: "scale(1)" },
    { transform: "scale(1.04, 0.97)" },
    { transform: "scale(1)" },
  ];
  await both((k) => ctx.body(k, breathe, 900).then(() => ctx.body(k, breathe, 900)));
  if (ctx.stopped()) return;
  await together(ctx, "cuddle", 1600, async (at) => {
    ctx.heart(above(ctx, at, 24), 300);
    await ctx.wait(1600);
  });
  if (ctx.stopped()) return;
  KINDS.forEach((k) => ctx.pose(k, "bow"));
  await ctx.wait(500);
}

/** Fetch: the dog rolls its tennis ball to the cat, the cat bats it back, twice. */
async function playFetch(ctx: Ctx) {
  faceEachOther(ctx);
  const c = centerOf(ctx, "cat");
  const d = centerOf(ctx, "dog");
  const ground = (p: Point, kind: PetKind) => ({ x: p.x, y: ctx.pos[kind].y + ctx.size[kind].height - 8 });
  const roll = (from: Point, to: Point): Keyframe[] =>
    Array.from({ length: 9 }, (_, i) => {
      const t = i / 8;
      const bounce = Math.abs(Math.sin(t * Math.PI * 2)) * 14;
      return {
        transform: `translate(${from.x + (to.x - from.x) * t - c.x + ctx.up.x * bounce}px, ${from.y + (to.y - from.y) * t - c.y + ctx.up.y * bounce}px) rotate(${t * 540}deg)`,
        opacity: 1,
      };
    });
  for (let i = 0; i < 2; i++) {
    ctx.pose("dog", "ball");
    await ctx.hop("dog", 8, 400);
    if (ctx.stopped()) return;
    ctx.pose("dog", "run");
    ctx.face("dog", c.x - d.x);
    await ctx.overlay("ball", c, roll(ground(d, "dog"), ground(c, "cat")), 600, "ease-out");
    if (ctx.stopped()) return;
    ctx.pose("cat", "bow");
    await ctx.wait(250);
    ctx.pose("cat", "jump");
    const back = ctx.overlay("ball", c, roll(ground(c, "cat"), ground(d, "dog")), 600, "ease-out");
    await ctx.hop("cat", 10, 300);
    ctx.pose("cat", "idle");
    await back;
    if (ctx.stopped()) return;
  }
  ctx.pose("dog", "ball");
  await ctx.hop("dog", 12, 400);
}

/** Belly rolls: both on their backs, wiggling, hearts. */
async function rolls(ctx: Ctx) {
  KINDS.forEach((k) => ctx.pose(k, "roll"));
  const wiggle: Keyframe[] = Array.from({ length: 9 }, (_, i) => ({
    transform: `rotate(${i === 0 || i === 8 ? 0 : i % 2 ? -10 : 10}deg)`,
  }));
  ctx.heart(above(ctx, centerOf(ctx, "cat"), 20), 500);
  ctx.heart(above(ctx, centerOf(ctx, "dog"), 20), 1600);
  await both((k) => ctx.body(k, wiggle, 3400));
  if (ctx.stopped()) return;
  KINDS.forEach((k) => ctx.pose(k, "jump"));
  await both((k) => ctx.hop(k, 14, 450));
}

/** Love note: the cat brings its heart over, the dog jumps for joy. */
async function loveNote(ctx: Ctx) {
  faceEachOther(ctx);
  const c = centerOf(ctx, "cat");
  const d = centerOf(ctx, "dog");
  const step = { x: (d.x - c.x) * 0.3, y: (d.y - c.y) * 0.3 };
  ctx.pose("cat", "heart");
  await ctx.path("cat", [{ x: 0, y: 0 }, step], 600);
  if (ctx.stopped()) return;
  for (let i = 0; i < 5; i++) ctx.heart(above(ctx, middle(ctx), 10 + i * 4), i * 250);
  ctx.pose("dog", "jump");
  for (let i = 0; i < 3; i++) {
    await ctx.hop("dog", 16, 500);
    if (ctx.stopped()) return;
  }
  ctx.pose("dog", "idle");
  await ctx.path("cat", [step, { x: 0, y: 0 }], 600);
  ctx.pose("cat", "idle");
  await ctx.wait(400);
}

/** Chase: the dog leaps over the cat to its far side and runs back, twice, while the cat hops. */
async function chase(ctx: Ctx) {
  const c = centerOf(ctx, "cat");
  const d = centerOf(ctx, "dog");
  // The far side of the cat, as far from it as the dog sits now. (Always over the cat, never below:
  // at home the pets are on the bottom edge.)
  const far = { x: 2 * (c.x - d.x), y: 2 * (c.y - d.y) };
  ctx.pose("dog", "run");
  ctx.pose("cat", "jump");
  for (let half = 0; half < 4; half++) {
    const [from, to] = half % 2 ? [far, { x: 0, y: 0 }] : [{ x: 0, y: 0 }, far];
    const arc = half % 2 ? 0 : 40; // over the cat going, along the ground coming back
    const frames = Array.from({ length: 9 }, (_, i) => {
      const t = i / 8;
      const lift = Math.sin(t * Math.PI) * arc;
      return { x: from.x + (to.x - from.x) * t + ctx.up.x * lift, y: from.y + (to.y - from.y) * t + ctx.up.y * lift };
    });
    // Facing the way it runs.
    const dx = to.x - from.x;
    ctx.face("dog", dx);
    ctx.face("cat", -dx);
    const lap = ctx.path("dog", frames, 800, "linear");
    await ctx.hop("cat", 8, 400);
    await lap;
    if (ctx.stopped()) return;
  }
  ctx.pose("dog", "idle");
  ctx.pose("cat", "idle");
  faceEachOther(ctx);
  ctx.heart(above(ctx, middle(ctx), 20));
  await ctx.wait(500);
}

export const ACTIVITIES: { name: string; run: (ctx: Ctx) => Promise<void> }[] = [
  { name: "badminton", run: rally },
  { name: "hug", run: hug },
  { name: "dress-up", run: dressUp },
  { name: "nap", run: nap },
  { name: "fetch", run: playFetch },
  { name: "belly rolls", run: rolls },
  { name: "love note", run: loveNote },
  { name: "chase", run: chase },
];

/** The same pick on both screens: a number from the shared seed and how many activities came before. */
export function pickActivity(seed: number, round: number): number {
  let h = (seed ^ Math.imul(round + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) % ACTIVITIES.length;
}
