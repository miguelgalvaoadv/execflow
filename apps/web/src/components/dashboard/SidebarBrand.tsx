import { borders, surfaces, text } from "./surfaces";

type SidebarBrandProps = {
  compact?: boolean;
};

export function SidebarBrand({ compact = false }: SidebarBrandProps) {
  return (
    <div className={`flex items-center gap-3 ${compact ? "" : "px-1"}`}>
      <span
        className={`flex shrink-0 items-center justify-center rounded-[10px] border ${borders.default} ${surfaces.panel} text-[11px] font-semibold tracking-[0.08em] text-zinc-100 ${compact ? "h-8 w-8" : "h-9 w-9"}`}
      >
        EF
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold tracking-[-0.01em] text-zinc-100">
          EXECFLOW
        </p>
        <p className={`truncate text-[11px] ${text.muted}`}>Execução penal</p>
      </div>
    </div>
  );
}
