/** Shared surface, border and text tokens for the dashboard shell.
 *
 * Derivados do plano visual EXECFLOW (visual_architecture §7).
 * Tokens intocáveis — qualquer adição requer revisão do plano.
 */
export const surfaces = {
  canvas:       "bg-slate-50",    // Fundo root — alinhado com globals.css
  sidebar:      "bg-white border-r border-slate-200",  // Sidebar branca com borda subtil
  main:         "bg-slate-50",    // Área main de scroll
  panel:        "bg-white border border-slate-200 shadow-sm", // Cards de lista, painéis brancos
  panelMuted:   "bg-slate-100",   // Wrapper de página (page container)
  panelInset:   "bg-slate-50 border border-slate-200",   // Tab bars, empty states, inputs
  panelRaised:  "bg-white shadow-md border border-slate-200",  // Cards hover, modais, overlays
} as const;

export const borders = {
  subtle:  "border-slate-100",    // Bordas secundárias, separadores
  default: "border-slate-200",    // Cards, inputs, contentor padrão
  strong:  "border-slate-300",    // Ênfase, hover states
  focus:   "border-indigo-500",   // Focus ring (acessibilidade)
} as const;

export const text = {
  primary:   "text-slate-900",    // Títulos, h1, texto de destaque
  secondary: "text-slate-600",    // Corpo, descriptions, summaries
  muted:     "text-slate-500",    // Labels, eyebrows, metadados
  faint:     "text-slate-400",    // Dados terciários, timestamps
  disabled:  "text-slate-300",    // Elementos desactivados
} as const;
