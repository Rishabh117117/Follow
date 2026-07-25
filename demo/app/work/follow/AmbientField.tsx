"use client";

import { useEffect, useRef } from "react";
import "./AmbientField.css";

/**
 * Follow — page-wide ambient backdrop (DESIGN-PHASE-1 motion; scroll-clocked
 * ROUND-2026-07-17).
 *
 * The single soft "background layer" behind the WHOLE page. Blue + orange
 * blurred orbs whose colour cross-fades by scroll position so the page's
 * colour arc matches its content:
 *   intro      → blue + orange both glowing
 *   problem    → orange-dominant (~70/30)
 *   Follow     → blue-dominant (~70/30)
 *
 *   • SCROLL is the clock — each orb traces a small Lissajous path whose
 *     phase rides the scroll position, so the orbs move while you scroll and
 *     hold still the moment you stop to read. Near the `[data-ambient-live]`
 *     sandbox band the free-running drift + pointer lean blend back in (the
 *     demo is the solid focus point; there the motion is ambience).
 *   • Orbs fade back over `[data-ambient-dim]` reading sections.
 * Decorative (`aria-hidden`), `position:fixed; z-index:0`. One rAF loop
 * (parked while the tab is hidden). Under `prefers-reduced-motion` no loop
 * attaches; the orbs sit still at a neutral balance (CSS).
 */

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export default function AmbientField() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const orbs = Array.from(el.querySelectorAll<HTMLElement>(".orb"));
    const factors = orbs.map((o) => parseFloat(o.dataset.f || "12"));
    const isBlue = orbs.map((o) => o.dataset.c === "blue");
    // per-orb path params — small amplitudes (the orbs are huge soft fields;
    // a little travel reads as a lot of glow movement)
    const P = orbs.map((_, i) => ({
      ampX: 80 + i * 22, // horizontal travel (px)
      ampY: 22 + i * 8, // vertical travel (px)
      fx: 0.5 + i * 0.13, // time frequency (only near the sandbox)
      fy: 0.42 + i * 0.11,
      sx: 1.2 + i * 0.5, // X oscillations across one full-page scroll
      sy: 1.6 + i * 0.4,
      ph: i * 1.6, // phase offset
    }));

    let px = 0,
      py = 0,
      tx = 0,
      ty = 0,
      t = 0,
      raf = 0,
      live = 0, // demo-proximity blend: 1 = the free-running mode
      lastY = window.scrollY,
      dim = 1; // eased fade factor over text-heavy zones
    let max = document.documentElement.scrollHeight - window.innerHeight || 1;
    let dimZones: { top: number; bottom: number }[] = [];
    let liveZones: { top: number; bottom: number }[] = [];
    // cache layout-dependent values; refresh on resize (+ once after fonts settle)
    const measure = () => {
      max = document.documentElement.scrollHeight - window.innerHeight || 1;
      dimZones = Array.from(
        document.querySelectorAll<HTMLElement>("[data-ambient-dim]")
      ).map((s) => {
        const r = s.getBoundingClientRect();
        const top = r.top + window.scrollY;
        return { top, bottom: top + r.height };
      });
      liveZones = Array.from(
        document.querySelectorAll<HTMLElement>("[data-ambient-live]")
      ).map((s) => {
        const r = s.getBoundingClientRect();
        const top = r.top + window.scrollY;
        return { top, bottom: top + r.height };
      });
    };
    measure();

    const onMove = (e: PointerEvent) => {
      tx = e.clientX / window.innerWidth - 0.5;
      ty = e.clientY / window.innerHeight - 0.5;
    };

    const TAU = Math.PI * 2;
    const loop = () => {
      // pause the work while the tab is hidden (matches the other ambient
      // engines + the page-wide convention)
      if (document.hidden) {
        raf = requestAnimationFrame(loop);
        return;
      }
      // scroll is the clock: idle = still; scroll delta advances the phase;
      // near the sandbox the free-running term + pointer lean blend in.
      const yNow = window.scrollY;
      const dy = Math.min(Math.abs(yNow - lastY), 160);
      lastY = yNow;
      const lm = window.innerHeight * 0.25;
      let inLive = false;
      for (let z = 0; z < liveZones.length; z++) {
        if (
          liveZones[z].top < yNow + window.innerHeight + lm &&
          liveZones[z].bottom > yNow - lm
        ) {
          inLive = true;
          break;
        }
      }
      live += ((inLive ? 1 : 0) - live) * 0.05;
      t += 0.005 * live + dy * 0.0005;
      px += (tx * live - px) * 0.04;
      py += (ty * live - py) * 0.04;

      // scroll progress → colour weighting (problem=orange, Follow=blue)
      const s = clamp01(yNow / max);
      const a = clamp01((s - 0.12) / 0.26); // ramps into the orange (problem) zone
      const b = clamp01((s - 0.5) / 0.28); // ramps into the blue (Follow) zone
      let orangeW = 0.7 + 0.3 * a;
      orangeW = orangeW * (1 - b) + 0.25 * b;
      let blueW = 0.55 - 0.37 * a;
      blueW = blueW + (1 - blueW) * b;

      // fade back over text-heavy sections (viewport-centre inside a dim zone)
      const center = yNow + window.innerHeight * 0.5;
      let inDim = false;
      for (let z = 0; z < dimZones.length; z++) {
        if (center > dimZones[z].top && center < dimZones[z].bottom) {
          inDim = true;
          break;
        }
      }
      dim += ((inDim ? 0.84 : 1) - dim) * 0.05;

      for (let i = 0; i < orbs.length; i++) {
        const p = P[i];
        // scroll advances the path phase → the orb travels as you scroll
        const driftX = Math.sin(t * p.fx + s * TAU * p.sx + p.ph) * p.ampX;
        const driftY = Math.cos(t * p.fy + s * TAU * p.sy + p.ph) * p.ampY;
        orbs[i].style.transform =
          "translate3d(" +
          (px * factors[i] + driftX).toFixed(1) +
          "px," +
          (py * factors[i] * 0.35 + driftY).toFixed(1) +
          "px,0)";
        orbs[i].style.opacity = ((isBlue[i] ? blueW : orangeW) * dim).toFixed(3);
      }
      raf = requestAnimationFrame(loop);
    };

    orbs.forEach((o) => (o.style.willChange = "transform, opacity"));
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", measure, { passive: true });
    const settle = window.setTimeout(measure, 700); // re-measure after font reflow
    raf = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", measure);
      window.clearTimeout(settle);
      cancelAnimationFrame(raf);
      orbs.forEach((o) => {
        o.style.willChange = "";
      });
    };
  }, []);

  return (
    <div className="ambient" ref={ref} aria-hidden="true">
      <span className="orb o1" data-c="orange" data-f="26" />
      <span className="orb b1" data-c="blue" data-f="-32" />
      <span className="orb o2" data-c="orange" data-f="20" />
      <span className="orb b2" data-c="blue" data-f="-22" />
    </div>
  );
}
