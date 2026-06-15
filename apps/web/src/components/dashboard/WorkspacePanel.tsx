import type { ReactNode } from "react";
import { borders, surfaces, text } from "./surfaces";

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
    variant === "inset" ? surfaces.panelInset : surfaces.panel;

  return (
    <section
      className={[
        "flex flex-col overflow-hidden rounded-xl",
        surface,
        borders.subtle,
        "border",
        className,
      ].join(" ")}
    >
      <header className={`border-b ${borders.subtle} px-5 py-4`}>
        <h2
          className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${text.muted}`}
        >
          {title}
        </h2>
        {description ? (
          <p className={`mt-1 text-[12px] leading-relaxed ${text.faint}`}>
            {description}
          </p>
        ) : null}
      </header>
      <div className="flex flex-1 flex-col px-5 py-5">{children}</div>
    </section>
  );
}

function PanelPlaceholder({ message }: { message: string }) {
  return (
    <div
      className={`flex min-h-[120px] flex-1 items-center justify-center rounded-lg border border-dashed ${borders.subtle} ${surfaces.panelMuted} px-4 py-8`}
    >
      <p className={`text-center text-[12px] leading-relaxed ${text.faint}`}>
        {message}
      </p>
    </div>
  );
}

export function WorkspacePanelPlaceholder({ message }: { message: string }) {
  return <PanelPlaceholder message={message} />;
}
