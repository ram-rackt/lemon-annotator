"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image, { type StaticImageData } from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { useHydrated } from "@/hooks/use-hydrated";

import { ACTIVITIES, type Ctx, type Overlay, pickActivity, type Pose } from "./activities";
import { type PetKind, type PetMove, type PetState, type PetsState, petsApi } from "./api";
import { HOVER_MS, hasPets, ownerOf, SYNC_MS } from "./config";
import { beside, clampTo, fromFraction, homeOf, type Point, type Size, toFraction } from "./geometry";
import catBow from "./sprites/cat-bow.png";
import catHeart from "./sprites/cat-heart.png";
import catIdle from "./sprites/cat-idle.png";
import catJump from "./sprites/cat-jump.png";
import catRoll from "./sprites/cat-roll.png";
import catSleep from "./sprites/cat-sleep.png";
import costume from "./sprites/costume.png";
import dogBall from "./sprites/dog-ball.png";
import dogBow from "./sprites/dog-bow.png";
import dogIdle from "./sprites/dog-idle.png";
import dogJump from "./sprites/dog-jump.png";
import dogRoll from "./sprites/dog-roll.png";
import dogRun from "./sprites/dog-run.png";
import dogSleep from "./sprites/dog-sleep.png";
import heart from "./sprites/heart.png";
import hug from "./sprites/hug.png";
import shuttle from "./sprites/shuttle.png";
import together from "./sprites/together.png";

/**
 * ankana's cat and ram's dog, for those two accounts only. Each owner controls only their own pet:
 * click it to send it to the other pet (they play, and it stays beside it), drag it anywhere in the
 * window, double-click to send it home (cat bottom-right, dog bottom-left). Hovering either pet makes it
 * wiggle on the spot for HOVER_MS. While together they start a new random activity every so often. Both
 * owners see the same thing (synced via the API). The pets float above the page without taking part in
 * its layout, so the app itself is unchanged.
 */
export function Pets() {
  const { user } = useAuth();
  // Browser only: positions depend on the window size.
  const hydrated = useHydrated();
  if (!hydrated || !hasPets(user?.email)) return null;
  return <PetWorld />;
}

/* -------------------------------------------------------------------------- */
/* Sprites and sizes                                                          */
/* -------------------------------------------------------------------------- */

const PETS_KEY = ["pets"] as const;
/** Height of a sitting pet on screen. Every sprite is drawn at the same scale as these. */
const PET_HEIGHT = 56;
/** Walking speed, px per second. */
const SPEED = 600;
/** While together, a new activity about this often (the same moment on both screens). */
const AUTO_MS = 30_000;
const KINDS: PetKind[] = ["cat", "dog"];

const SCALE = { cat: PET_HEIGHT / catIdle.height, dog: PET_HEIGHT / dogIdle.height };
const BOTH_SCALE = (SCALE.cat + SCALE.dog) / 2;
const sized = (img: StaticImageData, scale: number): Size => ({
  width: Math.round(img.width * scale),
  height: Math.round(img.height * scale),
});
const SIZE: Record<PetKind, Size> = { cat: sized(catIdle, SCALE.cat), dog: sized(dogIdle, SCALE.dog) };

const POSES: Record<PetKind, Partial<Record<Pose, StaticImageData>>> = {
  cat: { idle: catIdle, jump: catJump, heart: catHeart, sleep: catSleep, roll: catRoll, bow: catBow },
  dog: { idle: dogIdle, jump: dogJump, run: dogRun, ball: dogBall, sleep: dogSleep, roll: dogRoll, bow: dogBow },
};
/** Which way each sticker faces on screen: 1 right, -1 left, 0 straight at you (never flipped). */
const FACING: Record<PetKind, Partial<Record<Pose, number>>> = {
  cat: { idle: 1, jump: 1, heart: -1, bow: -1 },
  dog: { jump: -1, run: 1, bow: -1 },
};

const OVERLAY_IMAGES: Partial<Record<Overlay, StaticImageData>> = { shuttle, hug, costume, cuddle: together };
const BALL = 12;
const OVERLAY_SIZE: Record<Overlay, Size> = {
  shuttle: sized(shuttle, BOTH_SCALE),
  hug: sized(hug, BOTH_SCALE),
  costume: sized(costume, BOTH_SCALE),
  cuddle: sized(together, BOTH_SCALE),
  ball: { width: BALL, height: BALL },
};
const HEART = sized(heart, 0.7);
const HEARTS = 6;

const readView = (): Size => ({
  width: document.documentElement.clientWidth,
  height: document.documentElement.clientHeight,
});
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);
const other = (kind: PetKind): PetKind => (kind === "cat" ? "dog" : "cat");

function run(el: Element | null | undefined, frames: Keyframe[], duration: number, easing = "ease-in-out") {
  if (!el) return Promise.resolve();
  return el
    .animate(frames, { duration, easing, fill: "forwards" })
    .finished.then(() => undefined)
    .catch(() => undefined); // cancelled
}

/* -------------------------------------------------------------------------- */
/* Shared state                                                               */
/* -------------------------------------------------------------------------- */

function PetWorld() {
  const qc = useQueryClient();
  const petsQ = useQuery({
    queryKey: PETS_KEY,
    queryFn: petsApi.get,
    refetchInterval: SYNC_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: false,
  });
  // This account's latest confirmed move: a check that started before it can't put the pet back.
  const [confirmed, setConfirmed] = useState<PetState | null>(null);
  const move = useMutation({
    mutationFn: (body: PetMove) => petsApi.move(petsQ.data!.you, body),
    onMutate: () => qc.cancelQueries({ queryKey: PETS_KEY }),
    onSuccess: (state) => {
      setConfirmed(state[state.you]);
      qc.setQueryData<PetsState>(PETS_KEY, state);
    },
    onError: () => qc.invalidateQueries({ queryKey: PETS_KEY }),
  });

  const data = petsQ.data;
  if (!data) return null; // still loading, or this server has no pets for this account

  const you = data.you;
  const theirs = data[other(you)];
  const saved = confirmed && time(confirmed.moved_at) > time(data[you].moved_at) ? confirmed : data[you];
  const pending = move.isPending ? move.variables : undefined;
  // Shown at once, before the server answers. Going to a pet that already sits beside this one moves nobody.
  const own: PetState =
    pending && !(pending.spot === "with" && theirs.spot === "with")
      ? { spot: pending.spot, x: pending.x ?? null, y: pending.y ?? null, moved_at: null, moved_by: null }
      : saved;
  const states = { [you]: own, [other(you)]: theirs } as Record<PetKind, PetState>;
  return (
    <Stage
      you={you}
      states={states}
      play={data.play}
      clockOffset={time(data.now) - data.receivedAt}
      onMove={(body) => move.mutate(body)}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Stage: where the pets are drawn and animated                               */
/* -------------------------------------------------------------------------- */

/** Each pet is nested elements, so one animation never overwrites another's transform. */
type Part = "mover" | "hopper" | "fx" | "face" | Pose;
type Bind = (part: Part) => (el: HTMLElement | null) => void;

interface StageProps {
  you: PetKind;
  states: Record<PetKind, PetState>;
  play: PetsState["play"];
  /** Server clock minus this browser's clock. */
  clockOffset: number;
  onMove: (body: PetMove) => void;
}

function Stage({ you, states, play, clockOffset, onMove }: StageProps) {
  const [view, setView] = useState(readView);
  useEffect(() => {
    const onResize = () => setView(readView());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // Where this owner is dragging their pet (it follows the pointer; saved on drop).
  const [drag, setDrag] = useState<Point | null>(null);

  /* Where each pet belongs (pure: from the shared state and the window size). */
  const following = (kind: PetKind) => states[kind].spot === "with" && states[other(kind)].spot !== "with";
  const settled = (kind: PetKind): Point => {
    const s = states[kind];
    if (following(kind)) {
      const anchor = other(kind);
      return beside(settled(anchor), SIZE[anchor], SIZE[kind], view);
    }
    if (s.spot === "free" && s.x != null && s.y != null) return fromFraction(view, SIZE[kind], s.x, s.y);
    return homeOf(kind, view, SIZE[kind]);
  };
  // A pet beside one that is being dragged waits for the drop, then walks over.
  const target: Record<PetKind, Point> = {
    cat: you === "cat" && drag ? drag : settled("cat"),
    dog: you === "dog" && drag ? drag : settled("dog"),
  };
  const isTogether = following("cat") || following("dog");

  /* Elements, and animation state (refs: it changes many times a second and never needs a render). */
  const nodes = useRef(new Map<string, HTMLElement>());
  const node = (kind: PetKind, part: Part) => nodes.current.get(`${kind}:${part}`) ?? null;
  const bind =
    (kind: PetKind): Bind =>
    (part) =>
    (el) => {
      if (el) nodes.current.set(`${kind}:${part}`, el);
      else nodes.current.delete(`${kind}:${part}`);
    };
  const overlayNodes = useRef(new Map<string, HTMLElement>());
  const bindOverlay = (name: string) => (el: HTMLElement | null) => {
    if (el) overlayNodes.current.set(name, el);
    else overlayNodes.current.delete(name);
  };

  const latest = useRef({ target, view, isTogether, play, clockOffset });
  const shown = useRef<Record<PetKind, Point> | null>(null);
  const shownView = useRef(view);
  const walking = useRef<Record<PetKind, number>>({ cat: 0, dog: 0 }); // the walk under way, 0 = still
  const walkAnims = useRef<Record<PetKind, Animation[]>>({ cat: [], dog: [] });
  const walks = useRef(0);
  const facing = useRef<Record<PetKind, number>>({ cat: 0, dog: 0 });
  const poseNow = useRef<Record<PetKind, Pose>>({ cat: "idle", dog: "idle" });
  const hoverAnim = useRef<Record<PetKind, Animation | null>>({ cat: null, dog: null });
  const activityId = useRef(0);
  const active = useRef(false);
  const pendingPlay = useRef<number | null>(null); // seed of a play waiting for both pets to arrive
  const lastPlayAt = useRef<string | null | undefined>(undefined);
  const lastRound = useRef(0);
  const lastActivity = useRef(-1);
  const heartTurn = useRef(0);
  const press = useRef<{ x: number; y: number; from: Point; at: Point; dragging: boolean } | null>(null);
  const dragging = useRef(false);
  const justDragged = useRef(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ------------------------------ looks ------------------------------ */

  const applyFace = (kind: PetKind) => {
    const face = node(kind, "face");
    const natural = FACING[kind][poseNow.current[kind]] ?? 0;
    const want = Math.sign(facing.current[kind]);
    if (face) face.style.transform = natural && want && want !== natural ? "scaleX(-1)" : "";
  };
  const setPose = (kind: PetKind, pose: Pose) => {
    const shownPose = POSES[kind][pose] ? pose : pose === "run" ? "jump" : "idle";
    poseNow.current[kind] = shownPose;
    for (const p of Object.keys(POSES[kind]) as Pose[]) {
      const img = node(kind, p);
      if (img) img.style.opacity = p === shownPose ? "1" : "0";
    }
    applyFace(kind);
  };
  const setFace = (kind: PetKind, direction: number) => {
    facing.current[kind] = direction;
    applyFace(kind);
  };
  const stopHover = (kind: PetKind) => {
    hoverAnim.current[kind]?.cancel();
    hoverAnim.current[kind] = null;
  };
  const up = (): Point => {
    const { target: t } = latest.current;
    return Math.min(t.cat.y, t.dog.y) < 90 ? { x: 0, y: 1 } : { x: 0, y: -1 };
  };

  /* ---------------------------- activities --------------------------- */

  const resetActivity = () => {
    active.current = false;
    for (const kind of KINDS) {
      for (const part of ["mover", "hopper", "fx"] as const) {
        node(kind, part)
          ?.getAnimations()
          .forEach((a) => {
            if (!walkAnims.current[kind].includes(a) && a !== hoverAnim.current[kind]) a.cancel();
          });
      }
      if (!walking.current[kind]) {
        setPose(kind, "idle");
        setFace(kind, 0);
      }
    }
    overlayNodes.current.forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
  };
  const stopActivity = () => {
    activityId.current++;
    pendingPlay.current = null;
    if (active.current) resetActivity();
  };

  const startActivity = async (index: number) => {
    const id = ++activityId.current;
    const stopped = () => activityId.current !== id;
    active.current = true;
    lastActivity.current = index;
    KINDS.forEach(stopHover);
    const { target: pos, view: v } = latest.current;
    const placeOverlay = (el: HTMLElement, size: Size, center: Point) => {
      const p = clampTo(v, size, { x: center.x - size.width / 2, y: center.y - size.height / 2 });
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
    };
    const ctx: Ctx = {
      pos,
      size: SIZE,
      overlaySize: OVERLAY_SIZE,
      up: up(),
      pose: setPose,
      face: setFace,
      hop: (kind, height, ms) => {
        const u = up();
        return run(
          node(kind, "hopper"),
          [
            { transform: "translate(0, 0)" },
            { transform: `translate(${u.x * height}px, ${u.y * height}px)` },
            { transform: "translate(0, 0)" },
          ],
          ms,
        );
      },
      path: (kind, frames, ms, easing) =>
        run(
          node(kind, "mover"),
          frames.map((f) => {
            const p = clampTo(v, SIZE[kind], { x: pos[kind].x + f.x, y: pos[kind].y + f.y });
            return { transform: `translate(${p.x}px, ${p.y}px)`, opacity: f.opacity ?? 1 };
          }),
          ms,
          easing,
        ),
      body: (kind, frames, ms) => run(node(kind, "fx"), frames, ms),
      overlay: (name, center, frames, ms, easing) => {
        const el = overlayNodes.current.get(name);
        if (!el) return Promise.resolve();
        placeOverlay(el, OVERLAY_SIZE[name], center);
        return run(el, frames, ms, easing);
      },
      heart: (at, delay = 0) => {
        const el = overlayNodes.current.get(`heart-${heartTurn.current++ % HEARTS}`);
        if (!el) return;
        placeOverlay(el, HEART, at);
        const u = up();
        el.animate(
          [
            { opacity: 0, transform: "translate(0, 0) scale(0.6)" },
            { opacity: 1, transform: `translate(0, ${u.y * 8}px) scale(1)`, offset: 0.2 },
            { opacity: 0, transform: `translate(${(heartTurn.current % 3) - 1}px, ${u.y * 44}px) scale(1.1)` },
          ],
          { duration: 1300, delay, easing: "ease-out" },
        );
      },
      wait,
      stopped,
    };
    if (reducedMotion()) {
      // No running about: they just cuddle for a moment.
      const mid = { x: (pos.cat.x + pos.dog.x + SIZE.cat.width) / 2, y: pos.cat.y + SIZE.cat.height / 2 };
      await Promise.all([
        ctx.overlay(
          "cuddle",
          mid,
          [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }],
          3000,
        ),
        ...KINDS.map((k) =>
          ctx.path(
            k,
            [
              { x: 0, y: 0, opacity: 0 },
              { x: 0, y: 0, opacity: 0 },
            ],
            3000,
          ),
        ),
      ]);
    } else {
      await ACTIVITIES[index].run(ctx);
    }
    if (!stopped()) resetActivity();
  };

  /** Start the waiting play once both pets have arrived beside each other. */
  const maybePlay = () => {
    const seed = pendingPlay.current;
    if (seed == null || walking.current.cat || walking.current.dog || dragging.current || active.current) return;
    pendingPlay.current = null;
    if (!latest.current.isTogether) return;
    void startActivity(pickActivity(seed, 0));
  };

  /* ------------------------------ walking ---------------------------- */

  const walk = (kind: PetKind, from: Point, to: Point) => {
    walkAnims.current[kind].forEach((a) => a.cancel());
    walkAnims.current[kind] = [];
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const mover = node(kind, "mover");
    if (!mover || distance < 0.5 || reducedMotion()) {
      walking.current[kind] = 0;
      return; // the element's own style already puts it at `to`
    }
    stopHover(kind);
    const token = ++walks.current;
    walking.current[kind] = token;
    setPose(kind, "run");
    setFace(kind, Math.abs(to.x - from.x) > 1 ? to.x - from.x : 0);
    const duration = Math.min(Math.max((distance / SPEED) * 1000, 300), 2500);
    const walkAnim = mover.animate(
      [{ transform: `translate(${from.x}px, ${from.y}px)` }, { transform: `translate(${to.x}px, ${to.y}px)` }],
      { duration, easing: "ease-in-out" },
    );
    const hopAnim = node(kind, "hopper")?.animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(-5px)" }, { transform: "translateY(0)" }],
      { duration: 260, iterations: Infinity },
    );
    walkAnims.current[kind] = [walkAnim, ...(hopAnim ? [hopAnim] : [])];
    const done = () => {
      if (walking.current[kind] !== token) return; // replaced by a newer walk
      hopAnim?.cancel();
      walkAnims.current[kind] = [];
      walking.current[kind] = 0;
      setPose(kind, "idle");
      setFace(kind, 0);
      maybePlay();
    };
    walkAnim.finished.then(done, done);
  };

  // Follow every change: this owner's clicks and drags, the other owner's moves, new plays.
  useLayoutEffect(() => {
    latest.current = { target, view, isTogether, play, clockOffset };
    const resized = shownView.current.width !== view.width || shownView.current.height !== view.height;
    shownView.current = view;
    if (!shown.current || resized) {
      shown.current = { ...target }; // first appearance or a new window size: just be there
    } else {
      for (const kind of KINDS) {
        const from = shown.current[kind];
        const to = target[kind];
        if (Math.hypot(to.x - from.x, to.y - from.y) < 0.5) continue;
        shown.current[kind] = to;
        if (kind === you && dragging.current) continue; // the pointer moves it
        stopActivity();
        walk(kind, from, to);
      }
    }
    // A new play (someone just went to the other pet): once both are there. Not when the page opens.
    if (lastPlayAt.current === undefined) lastPlayAt.current = play.at;
    else if (play.at !== lastPlayAt.current) {
      lastPlayAt.current = play.at;
      lastRound.current = 0;
      stopActivity();
      pendingPlay.current = play.seed;
    }
    if (!isTogether) pendingPlay.current = null;
    maybePlay();
  });

  // While together and idle: another activity every AUTO_MS, the same one at the same time on both screens.
  useEffect(() => {
    const tick = setInterval(() => {
      const { isTogether: together_, play: p, clockOffset: offset } = latest.current;
      if (!together_ || !p.at || active.current || walking.current.cat || walking.current.dog || dragging.current)
        return;
      const round = Math.floor((Date.now() + offset - time(p.at)) / AUTO_MS);
      if (round < 1 || round <= lastRound.current) return;
      lastRound.current = round;
      let index = pickActivity(p.seed, round);
      if (index === lastActivity.current) index = (index + 1) % ACTIVITIES.length;
      void startActivity(index);
    }, 1000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads everything through refs
  }, []);

  // Stop everything when the pets go away (sign-out).
  useEffect(() => {
    const activities = activityId; // a counter, not a DOM node
    const timer = clickTimer;
    return () => {
      activities.current++;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  /* --------------------------------- input -------------------------------- */

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const from = shown.current?.[you] ?? latest.current.target[you];
    press.current = { x: e.clientX, y: e.clientY, from, at: from, dragging: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.dragging) {
      if (Math.hypot(dx, dy) < 5) return;
      p.dragging = true;
      dragging.current = true;
      if (clickTimer.current) clearTimeout(clickTimer.current);
      clickTimer.current = null;
      stopActivity();
      stopHover(you);
      walkAnims.current[you].forEach((a) => a.cancel());
      walking.current[you] = 0;
      setPose(you, "jump");
    }
    p.at = clampTo(latest.current.view, SIZE[you], { x: p.from.x + dx, y: p.from.y + dy });
    setDrag(p.at);
  };
  const onPointerUp = () => {
    const p = press.current;
    press.current = null;
    if (!p?.dragging) return;
    justDragged.current = true;
    dragging.current = false;
    setPose(you, "idle");
    onMove({ spot: "free", ...toFraction(latest.current.view, SIZE[you], p.at) });
    setDrag(null);
  };
  const onClick = () => {
    if (justDragged.current) {
      justDragged.current = false;
      return;
    }
    if (clickTimer.current) return;
    // Wait a moment: a double-click means "go home" instead.
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      onMove({ spot: "with" });
    }, 250);
  };
  const onDoubleClick = () => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = null;
    if (states[you].spot !== "home") onMove({ spot: "home" });
  };

  /** On the spot, while hovered: a happy wiggle for HOVER_MS (stops if the pointer leaves). */
  const onHover = (kind: PetKind) => {
    const fx = node(kind, "fx");
    if (
      !fx ||
      walking.current[kind] ||
      active.current ||
      dragging.current ||
      hoverAnim.current[kind] ||
      reducedMotion()
    )
      return;
    const u = up();
    const frames: Keyframe[] = Array.from({ length: 13 }, (_, i) => {
      const edge = i === 0 || i === 12;
      const tilt = edge ? 0 : i % 2 ? -9 : 9;
      const lift = edge ? 0 : i % 4 === 1 ? 6 : i % 4 === 3 ? 3 : 0;
      return { transform: `translate(${u.x * lift}px, ${u.y * lift}px) rotate(${tilt}deg) scale(${edge ? 1 : 1.06})` };
    });
    const anim = fx.animate(frames, { duration: HOVER_MS, easing: "ease-in-out" });
    hoverAnim.current[kind] = anim;
    const done = () => {
      if (hoverAnim.current[kind] === anim) hoverAnim.current[kind] = null;
    };
    anim.finished.then(done, done);
  };

  return (
    <>
      {KINDS.map((kind) => (
        <PetView
          key={kind}
          kind={kind}
          mine={kind === you}
          at={target[kind]}
          bind={bind(kind)}
          handlers={
            kind === you
              ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClick, onDoubleClick }
              : {}
          }
          onHover={() => onHover(kind)}
          onLeave={() => stopHover(kind)}
        />
      ))}
      {(Object.keys(OVERLAY_SIZE) as Overlay[]).map((name) => {
        const img = OVERLAY_IMAGES[name];
        return (
          <div
            key={name}
            ref={bindOverlay(name)}
            className="pointer-events-none fixed top-0 left-0 z-40 opacity-0 print:hidden"
            style={OVERLAY_SIZE[name]}
          >
            {img ? (
              <Image src={img} alt="" unoptimized draggable={false} {...OVERLAY_SIZE[name]} className="max-w-none" />
            ) : (
              // The tennis ball (the dog's ball is part of its sticker, so this one is drawn).
              <div className="size-full rounded-full bg-[radial-gradient(circle_at_35%_35%,#e8f56a,#b5d334_60%,#8fae1f)] shadow-sm ring-1 ring-black/10" />
            )}
          </div>
        );
      })}
      {Array.from({ length: HEARTS }, (_, i) => (
        <div
          key={i}
          ref={bindOverlay(`heart-${i}`)}
          className="pointer-events-none fixed top-0 left-0 z-40 opacity-0 print:hidden"
          style={HEART}
        >
          <Image src={heart} alt="" unoptimized draggable={false} {...HEART} className="max-w-none" />
        </div>
      ))}
    </>
  );
}

function PetView({
  kind,
  mine,
  at,
  bind,
  handlers,
  onHover,
  onLeave,
}: {
  kind: PetKind;
  mine: boolean;
  at: Point;
  bind: Bind;
  handlers: React.HTMLAttributes<HTMLElement>;
  onHover: () => void;
  onLeave: () => void;
}) {
  const size = SIZE[kind];
  const name = `${ownerOf(kind)}'s ${kind}`;
  const body = (
    <div ref={bind("face")} className="relative" style={size}>
      {(Object.entries(POSES[kind]) as [Pose, StaticImageData][]).map(([pose, img]) => (
        // Every pose is always rendered (one visible), so switching never waits for an image.
        <Image
          key={pose}
          ref={bind(pose)}
          src={img}
          alt=""
          unoptimized
          draggable={false}
          {...sized(img, SCALE[kind])}
          className="absolute bottom-0 left-1/2 max-w-none -translate-x-1/2 select-none"
          style={{ opacity: pose === "idle" ? 1 : 0 }}
        />
      ))}
    </div>
  );
  const hover = { onPointerEnter: onHover, onPointerLeave: onLeave };
  return (
    <div
      ref={bind("mover")}
      className="pointer-events-none fixed top-0 left-0 z-40 print:hidden"
      style={{ ...size, transform: `translate(${at.x}px, ${at.y}px)` }}
    >
      <div ref={bind("hopper")}>
        <div ref={bind("fx")} style={{ transformOrigin: "50% 100%" }}>
          {mine ? (
            <button
              type="button"
              {...hover}
              {...handlers}
              aria-label={`Your ${kind}: click to go to the other pet, drag to move, double-click to send it home`}
              title={`Your ${kind} · click: go play · drag: move · double-click: home`}
              className="pointer-events-auto block cursor-grab touch-none rounded-xl outline-none select-none active:cursor-grabbing focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {body}
            </button>
          ) : (
            <div
              {...hover}
              role="img"
              aria-label={name}
              title={`${name} (only ${ownerOf(kind)} can move it)`}
              className="pointer-events-auto select-none"
            >
              {body}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
