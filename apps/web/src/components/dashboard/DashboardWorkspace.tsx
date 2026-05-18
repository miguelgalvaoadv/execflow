import { DashboardPageHeader } from "./DashboardPageHeader";
import {
  WorkspacePanel,
  WorkspacePanelPlaceholder,
} from "./WorkspacePanel";

export function DashboardWorkspace() {
  return (
    <>
      <DashboardPageHeader
        eyebrow="Workspace"
        title="Dashboard"
        description="Centro operacional para coordenação de execução penal e rotinas do escritório."
      />

      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <WorkspacePanel
            title="Fila operacional"
            description="Priorização diária de tarefas e pendências."
            className="min-h-[168px] lg:col-span-1"
          >
            <WorkspacePanelPlaceholder message="Nenhuma fila configurada." />
          </WorkspacePanel>

          <WorkspacePanel
            title="Agenda processual"
            description="Marcos, audiências e checkpoints do fluxo."
            className="min-h-[168px] lg:col-span-1"
          >
            <WorkspacePanelPlaceholder message="Nenhum evento agendado." />
          </WorkspacePanel>

          <WorkspacePanel
            title="Documentos em curso"
            description="Peças e entregáveis em elaboração."
            className="min-h-[168px] lg:col-span-1"
          >
            <WorkspacePanelPlaceholder message="Nenhum documento em andamento." />
          </WorkspacePanel>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <WorkspacePanel
            title="Espaço de trabalho"
            description="Área principal para execução de rotinas e acompanhamento."
            className="min-h-[320px] xl:col-span-8"
          >
            <WorkspacePanelPlaceholder message="Selecione um módulo na barra lateral para iniciar." />
          </WorkspacePanel>

          <div className="flex flex-col gap-4 xl:col-span-4">
            <WorkspacePanel
              title="Notas operacionais"
              description="Registos internos da equipa."
              className="min-h-[152px]"
              variant="inset"
            >
              <WorkspacePanelPlaceholder message="Sem notas registadas." />
            </WorkspacePanel>

            <WorkspacePanel
              title="Configuração rápida"
              description="Preferências do ambiente de trabalho."
              className="min-h-[152px]"
              variant="inset"
            >
              <WorkspacePanelPlaceholder message="Preferências padrão ativas." />
            </WorkspacePanel>
          </div>
        </div>
      </div>
    </>
  );
}
