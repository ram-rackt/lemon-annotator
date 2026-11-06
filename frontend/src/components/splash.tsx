"use client";

import { useEffect, useState } from "react";

import { APP_NAME, LogoMark } from "@/components/app-header";

// Set once the splash has played in this page load, so moving around the app and back to the home
// page doesn't replay it; a reload starts a fresh page load and plays it again.
let played = false;

/** The 3-second logo fade shown over the home page when Lemon is opened or reloaded. */
export function Splash() {
  const [visible, setVisible] = useState(() => !played);

  useEffect(() => {
    played = true;
  }, []);

  if (!visible) return null;
  return (
    <div
      aria-hidden
      onClick={() => setVisible(false)}
      onAnimationEnd={(e) => e.target === e.currentTarget && setVisible(false)}
      className="splash-backdrop fixed inset-0 z-[100] grid cursor-default place-items-center bg-background"
    >
      <div className="splash-logo flex items-center gap-6 font-semibold tracking-tight">
        <LogoMark className="size-24 rounded-3xl shadow-[0_18px_60px_-18px_rgb(250_204_21/0.7)]" />
        <span className="text-[3.5rem] leading-none">{APP_NAME}</span>
      </div>
    </div>
  );
}
