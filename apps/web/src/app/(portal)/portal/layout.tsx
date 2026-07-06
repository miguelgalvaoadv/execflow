/**
 * Layout do PORTAL DO CLIENTE — deliberadamente separado do shell interno.
 * Sem sidebar operacional, sem navegação para telas internas.
 */

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <div>
            <p className="text-[15px] font-semibold tracking-tight text-slate-900">EXECFLOW</p>
            <p className="text-[11px] text-slate-500">Acompanhamento do seu processo</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-3xl px-4 pb-8">
        <p className="text-[11px] text-slate-400">
          Dúvidas? Fale diretamente com o escritório. As informações aqui são um resumo
          simplificado do andamento — não substituem a orientação do seu advogado.
        </p>
      </footer>
    </div>
  )
}
