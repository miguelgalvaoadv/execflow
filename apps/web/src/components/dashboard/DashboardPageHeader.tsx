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
      {/* flex-wrap + basis no título: se as ações não couberem ao lado (ex.:
          tela de caso com vários botões + textos de status), elas QUEBRAM pra
          uma linha abaixo em vez de espremer o título em uma palavra por linha
          e estourar pra fora da tela (achado 13/07/2026, relatado pelo Miguel).
          As ações podem encolher (min-w-0) pra o flex-wrap interno delas
          funcionar; nunca ultrapassam a largura da página (max-w-full). */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-[340px]">
          {eyebrow ? (
            <p className={`mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${text.muted}`}>
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] text-slate-900">
            {title}
          </h1>
          {description ? (
            <div className={`mt-1.5 max-w-2xl text-[14px] leading-relaxed ${text.secondary}`}>
              {description}
            </div>
          ) : null}
        </div>
        {actions ? <div className="min-w-0 max-w-full">{actions}</div> : null}
      </div>
    </header>
  );
}
