/** Shared surface and border tokens for the dashboard shell. */
export const surfaces = {
  canvas: "bg-[#09090b]",
  sidebar: "bg-[#0c0c0e]",
  main: "bg-[#0a0a0c]",
  panel: "bg-[#111113]",
  panelMuted: "bg-[#0e0e10]",
  panelInset: "bg-[#0d0d0f]",
} as const;

export const borders = {
  subtle: "border-white/[0.06]",
  default: "border-white/[0.08]",
  strong: "border-white/[0.10]",
} as const;

export const text = {
  primary: "text-zinc-50",
  secondary: "text-zinc-400",
  muted: "text-zinc-500",
  faint: "text-zinc-600",
} as const;
