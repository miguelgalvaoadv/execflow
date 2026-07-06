import { text } from "./surfaces";

type DashboardPageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
};

export function DashboardPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: DashboardPageHeaderProps) {
  return (
    <header className="sticky top-0 z-20 -mx-4 mb-6 border-b border-slate-200 bg-slate-50 px-4 pb-5 pt-5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 xl:-mx-12 xl:px-12">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? (
            <p className={`mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${text.muted}`}>
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] text-slate-900">
            {title}
          </h1>
          {description ? (
            <p className={`mt-1.5 max-w-2xl text-[14px] leading-relaxed ${text.secondary}`}>
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </header>
  );
}
