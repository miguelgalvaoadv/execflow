/** Shared surface, border and text tokens for the dashboard shell.
 *
 * Tema: claro e profissional (estilo Linear/Stripe), destaque azul.
 * Estes tokens cascateiam para todos os componentes — alterar com cuidado.
 */
export const surfaces = {
  canvas:       "bg-slate-50",                                    // page background
  sidebar:      "bg-white border-r border-slate-200",            // sidebar
  main:         "bg-slate-50",                                    // main area
  panel:        "bg-white border border-slate-200 shadow-sm",    // cards / panels
  panelMuted:   "bg-slate-50",                                    // subtle wrapper
  panelInset:   "bg-slate-50 border border-slate-200",           // inputs / inset areas
  panelRaised:  "bg-white border border-slate-200 shadow-xl",    // modals / popovers
} as const;

export const borders = {
  subtle:  "border-slate-100",                                   // faint separators
  default: "border-slate-200",                                   // standard
  strong:  "border-slate-300",                                   // hover / focused
  focus:   "border-blue-500 ring-1 ring-blue-500/30",            // focus glow
} as const;

export const text = {
  primary:   "text-slate-900",
  secondary: "text-slate-600",
  muted:     "text-slate-500",
  faint:     "text-slate-700",
  disabled:  "text-slate-700",
} as const;

/** Accent (azul confiança) — botões, links, itens ativos. */
export const accent = {
  solid:  "bg-blue-600 text-white hover:bg-blue-700",
  soft:   "bg-blue-50 text-blue-700",
  text:   "text-blue-600",
  border: "border-blue-200",
} as const;
