import type { ReactNode } from "react";
import { surfaces } from "./surfaces";

type WorkspacePanelProps = {
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
  variant?: "default" | "inset";
};

export function WorkspacePanel({
  title,
  description,
  children,
  className = "",
  variant = "default",
}: WorkspacePanelProps) {
  const surface =
    variant === "inset" ? surfaces.panelInset : "bg-white";

  return (
    <section
      className={[
        "flex flex-col overflow-hidden rounded-xl border border-slate-200 shadow-sm",
        surface,
        className,
      ].join(" ")}
    >
      <header className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-[14px] font-semibold text-slate-900">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
            {description}
          </p>
        ) : null}
      </header>
      <div className="flex flex-1 flex-col px-5 py-5">{children}</div>
    </section>
  );
}
