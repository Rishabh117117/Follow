/* §4.1 — Follow accent (burnt orange #C2410C, overriding Persian Blue) +
   derived shades. Shared by /work/follow and its /prototype route so the
   sandbox renders identically in both mounts; set at the page root,
   everything inherits. (--navy stays declared in follow.module.css .page —
   the prototype css declares its own copy.) */
export const FOLLOW_ROOT_STYLE = {
  "--accent": "#C2410C",
  "--accent-deep": "#9E340A",
  "--accent-wash": "#F7E0D4",
  "--accent-tint": "#FBEFE7",
} as React.CSSProperties;
