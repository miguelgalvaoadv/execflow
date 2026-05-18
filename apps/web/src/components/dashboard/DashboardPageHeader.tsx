import { borders, text } from "./surfaces";

type DashboardPageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
};

export function DashboardPageHeader({
  eyebrow,
  title,
  description,
}: DashboardPageHeaderProps) {
  return (
    <header className={`mb-6 border-b ${borders.subtle} pb-6`}>
      {eyebrow ? (
        <p
          className={`mb-2 text-[11px] font-medium uppercase tracking-[0.14em] ${text.muted}`}
        >
          {eyebrow}
        </p>
      ) : null}
      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-zinc-50 sm:text-[32px]">
        {title}
      </h1>
      {description ? (
        <p className={`mt-2.5 max-w-2xl text-[13px] leading-relaxed ${text.secondary}`}>
          {description}
        </p>
      ) : null}
    </header>
  );
}
