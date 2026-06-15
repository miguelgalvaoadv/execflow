import { borders, text } from "./surfaces";

type DashboardPageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
};

export function DashboardPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: DashboardPageHeaderProps) {
  return (
    <header className={`mb-6 border-b ${borders.subtle} pb-6`}>
      {eyebrow ? (
        <p
          className={`mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${text.muted}`}
        >
          {eyebrow}
        </p>
      ) : null}
      <div className="flex items-start justify-between gap-4">
        <h1
          className={`text-[32px] font-semibold leading-[1.2] tracking-[-0.02em] ${text.primary}`}
        >
          {title}
        </h1>
        {actions ? <div>{actions}</div> : null}
      </div>
      {description ? (
        <p className={`mt-2 max-w-2xl text-[13px] leading-relaxed ${text.secondary}`}>
          {description}
        </p>
      ) : null}
    </header>
  );
}
