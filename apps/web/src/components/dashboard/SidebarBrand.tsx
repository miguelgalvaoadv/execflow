import { text } from "./surfaces";

type SidebarBrandProps = {
  compact?: boolean;
};

export function SidebarBrand({ compact = false }: SidebarBrandProps) {
  return (
    <div className={`flex items-center gap-3 ${compact ? "" : "px-1"}`}>
      {/* Wordmark mark — "E" geométrico estilo Linear/Raycast */}
      <svg
        width={compact ? 28 : 32}
        height={compact ? 28 : 32}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        {/* Barra vertical */}
        <rect x="7" y="7" width="3" height="18" rx="1.5" fill="#0f172a" />
        {/* Barra superior */}
        <rect x="7" y="7" width="14" height="3" rx="1.5" fill="#0f172a" />
        {/* Barra central */}
        <rect x="7" y="14.5" width="11" height="3" rx="1.5" fill="#0f172a" />
        {/* Barra inferior */}
        <rect x="7" y="22" width="14" height="3" rx="1.5" fill="#0f172a" />
        {/* Ponto de acento — detalhe premium */}
        <rect x="22" y="7" width="3" height="3" rx="1.5" fill="#4f46e5" />
      </svg>

      {!compact && (
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold tracking-[-0.02em] text-slate-900">
            EXECFLOW
          </p>
          <p className={`truncate text-[11px] ${text.faint}`}>
            Execução penal
          </p>
        </div>
      )}
    </div>
  );
}
