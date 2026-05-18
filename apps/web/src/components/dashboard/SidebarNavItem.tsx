import { NavIcon } from "./NavIcon";
import type { NavItem } from "./nav-items";
import { borders, text } from "./surfaces";

type SidebarNavItemProps = {
  item: NavItem;
  active?: boolean;
  onNavigate?: () => void;
};

export function SidebarNavItem({
  item,
  active = false,
  onNavigate,
}: SidebarNavItemProps) {
  return (
    <button
      type="button"
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={[
        "group relative flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left",
        active
          ? `bg-white/[0.06] ${text.primary} shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]`
          : `${text.muted} hover:bg-white/[0.03] hover:text-zinc-300`,
      ].join(" ")}
    >
      {active ? (
        <span
          className="absolute top-1/2 left-0 h-4 w-[2px] -translate-y-1/2 rounded-full bg-zinc-200"
          aria-hidden
        />
      ) : null}
      <span
        className={[
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border",
          active
            ? `${borders.default} bg-white/[0.04] text-zinc-100`
            : `border-transparent bg-transparent text-zinc-500 group-hover:border-white/[0.06] group-hover:bg-white/[0.02] group-hover:text-zinc-400`,
        ].join(" ")}
      >
        <NavIcon name={item.icon} className="h-4 w-4" />
      </span>
      <span className="truncate text-[13px] font-medium tracking-[-0.01em]">
        {item.label}
      </span>
    </button>
  );
}
