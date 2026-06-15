# EXECFLOW — SNAPSHOT IMPLEMENTATION PLAN (FASE 4A)

Este plano detalha o design técnico para implementar o gerenciamento operacional de `sentence_snapshots` (dados de sentenças judiciais) de ponta a ponta: do banco de dados até a aba correspondente na interface do usuário.

---

## 1. Auditoria e Arquitetura Atual

### Banco de Dados (Tabelas)
* **`sentence_snapshots`**: Armazena as parcelas aritméticas (pena total, pena cumprida, remição, detração, data-base e status do ciclo de vida: `proposed`, `confirmed`, `superseded`).
* **`audit_logs`** e **`domain_events`**: Gravam o histórico imutável das ações.

### APIs Existentes (`apps/api`)
* `POST /api/v1/cases/:caseId/sentence-snapshots` (propor novo cálculo)
* `POST /api/v1/sentence-snapshots/:id/confirm` (confirmar snapshot)
* `POST /api/v1/sentence-snapshots/:id/supersede` (substituir cálculo ativo)

### Gaps Identificados
1. **Falta Rota de Listagem**: Não existe endpoint `GET /api/v1/cases/:caseId/sentence-snapshots` para buscar todos os snapshots do caso de forma paginada ou histórica.
2. **Falta de Hooks no Frontend**: Não existem hooks de react-query para chamar as mutações ou a listagem de snapshots.
3. **Aba do Workspace Vazia**: O frontend do workspace de caso (`/cases/[caseId]`) possui abas para Resumo, Documentos, Timeline, Oportunidades, Prazos e Motor, mas não exibe a aba de **Snapshots/Cálculos de Sentença** nem permite controlá-los de forma interativa.

---

## 2. Mudanças Propostas

### 2.1. Backend API (`apps/api`)

#### [MODIFY] [sentence-snapshot repository](file:///c:/Users/Miguel%20Galv%C3%A3o/Documents/execflow/apps/api/src/repositories/sentence-snapshot.ts)
* Adicionar a função `listSentenceSnapshotsByCase` para buscar snapshots do caso por ordem decrescente de criação:
```typescript
export async function listSentenceSnapshotsByCase(
  db: AnyTx,
  organizationId: string,
  caseId: string,
  params: { limit: number; cursor?: string }
): Promise<RepositoryResult<PaginatedResult<SentenceSnapshot>>>
```

#### [MODIFY] [case-workspace-read service](file:///c:/Users/Miguel%20Galv%C3%A3o/Documents/execflow/apps/api/src/services/case-workspace-read.ts)
* Adicionar o serviço `listCaseSentenceSnapshots` integrando permissão de acesso e paginação.

#### [MODIFY] [case-workspace-read router](file:///c:/Users/Miguel%20Galv%C3%A3o/Documents/execflow/apps/api/src/routes/case-workspace-read.ts)
* Registrar a rota `GET /:caseId/sentence-snapshots`.

---

### 2.2. Frontend (`apps/web`)

#### [NEW] [use-case-snapshots hook](file:///c:/Users/Miguel%20Galv%C3%A3o/Documents/execflow/apps/web/src/lib/hooks/use-case-snapshots.ts)
* Criar hooks baseados em react-query:
  * `useCaseSentenceSnapshots(orgId, caseId, enabled)`
  * `useProposeSentenceSnapshotMutation`
  * `useConfirmSentenceSnapshotMutation`
  * `useSupersedeSentenceSnapshotMutation`

#### [MODIFY] [CaseTabBar component](file:///c:/Users/Miguel%20Galv%C3%A3o/Documents/execflow/apps/web/src/components/case-workspace/CaseTabBar.tsx)
* Adicionar uma nova aba chamada **"Cálculos"** ou **"Snapshots"** na barra de navegação principal do workspace do caso.

#### [MODIFY] [Workspace Page](file:///c:/Users/Miguel%20Galv%C3%A3o/Documents/execflow/apps/web/src/app/%28app%29/cases/%5BcaseId%5D/page.tsx)
* Integrar a nova aba na renderização.
* Implementar a aba **SnapshotsTab** contendo:
  * **Listagem do Histórico**: Identificação clara do snapshot ativo (`confirmed`), rascunhos em revisão (`proposed`) e anteriores (`superseded`).
  * **Painel de Detalhes Aritméticos**: Exibição elegante com penas (Pena Total, Cumprida, Restante), frações aplicadas, datas-base e método de cálculo.
  * **Ações Rápidas**:
    * Botão de "Confirmar" visível para snapshots com status `proposed` (restrito a advogados).
    * Botão de "Substituir" (para propor novo cálculo e marcar o atual como `superseded`).
    * Modal/Formulário para preencher os campos numéricos de dias de pena e justificativa da supersessão.

---

## 3. Plano de Verificação

### Testes Manuais
1. Entrar no workspace de um caso (Ex: José Antônio).
2. Acessar a nova aba **Cálculos**.
3. Verificar se o cálculo atual do banco de dados (exibido no seed como confirmando) aparece corretamente na tela com a data-base.
4. Simular o papel do Advogado e clicar em "Substituir" para preencher um novo cálculo retificando a pena (ex.: adicionando 10 dias de remição).
5. Salvar e conferir se o novo snapshot é inserido como `proposed` e o histórico reflete a alteração sem sobrescrever.
6. Clicar em "Confirmar" no rascunho proposto e atestar a alteração de status para `confirmed`.
