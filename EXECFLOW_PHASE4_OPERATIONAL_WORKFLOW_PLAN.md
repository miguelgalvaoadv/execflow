# EXECFLOW — FASE 4 OPERATIONAL WORKFLOW PLAN

Este plano descreve como transformar o EXECFLOW de um painel de leitura em um sistema operacional ativo gerenciado por humanos, focando na integração completa entre banco de dados, APIs, hooks de mutação e telas interativas do frontend.

---

## 1. Snapshot Management (Gestão de Cálculo Penal)

Este módulo gerencia a criação, confirmação e supersessão de `sentence_snapshots` (dados de sentenças) e `custody_snapshots` (dados de prisão).

* **Tabelas do Banco Envolvidas**: `sentence_snapshots`, `custody_snapshots`, `recalculation_runs`, `audit_logs` e `domain_events`.
* **APIs Necessárias**:
  * `POST /api/v1/cases/:caseId/sentence-snapshots` (cria um snapshot provisório rascunho).
  * `POST /api/v1/cases/:caseId/sentence-snapshots/:snapshotId/confirm` (promove o snapshot para `confirmed` e gera auditoria).
  * `POST /api/v1/cases/:caseId/sentence-snapshots/:snapshotId/supersede` (marca o snapshot anterior como substituído por um novo).
* **Mutations Necessárias**:
  * `useCreateSentenceSnapshot`: Envia dados estruturados de frações, data-base e interrupções.
  * `useConfirmSentenceSnapshot`: Dispara a confirmação manual.
* **Hooks Frontend Necessários**: `useCaseSnapshots` (leitura dos snapshots históricos).
* **Componentes Frontend Necessários**:
  * **Painel de Snapshots**: Exibe o histórico de cálculos do caso.
  * **Formulário de Snapshot**: Interface com campos de data-base de cálculo, fração aplicável e crimes cometidos (hediondo/comum).
* **Fluxo Operacional**:
  1. Advogado preenche os dados criminais no formulário do frontend.
  2. Frontend envia os dados via `POST` e cria um snapshot com status `draft`.
  3. Advogado valida o cálculo e clica em "Confirmar".
  4. Backend valida os dados, altera o status para `confirmed`, escreve na tabela de eventos outbox (`domain_events`) e inicia uma execução do motor de recalculabilidade de forma transacional.
* **Critérios de Aceite**:
  * É possível criar e salvar um cálculo de pena sem quebrar constraints.
  * A confirmação gera um registro de auditoria imutável detalhando o autor.
  * A confirmação atualiza os prazos e oportunidades sugeridas do caso.

---

## 2. Opportunity Review Workflow (Qualificação de Benefícios)

Este módulo controla o ciclo de vida das oportunidades de progresso processual levantadas pelo motor.

* **Tabelas do Banco Envolvidas**: `opportunities`, `opportunity_reviews` e `queue_projections`.
* **APIs Necessárias**:
  * `POST /api/v1/opportunities/:opportunityId/review` (registra a decisão do advogado e atualiza o estado da oportunidade).
* **Mutations Necessárias**:
  * `useReviewOpportunity`: Envia o payload contendo o parecer (`qualified` ou `rejected`) e a justificativa técnica imutável.
* **Hooks Frontend Necessários**: `useOpportunityReviews` (exibe o histórico de quem aprovou/rejeitou aquela hipótese).
* **Componentes Frontend Necessários**:
  * **Painel de Decisão da Oportunidade**: Cards com botões de "Qualificar" (Promover a `qualified`), "Descartar" (Mover para `dismissed` exigindo justificativa) e "Deferir" (Mover para `deferred`).
* **Fluxo Operacional**:
  1. Advogado clica no card de oportunidade sugerida pelo motor.
  2. Interface abre o painel lateral com a fundamentação legal sugerida.
  3. Advogado opta por "Qualificar" e insere a fundamentação real.
  4. Backend atualiza a oportunidade de `suggested` para `qualified`, cria o registro histórico em `opportunity_reviews` e remove a oportunidade da fila operacional ativa.
* **Critérios de Aceite**:
  * A oportunidade qualificada muda de status de forma síncrona na tela.
  * Descartar uma oportunidade obriga a digitação de uma justificativa textual.
  * A fila operacional do Dashboard atualiza imediatamente após a decisão do advogado.

---

## 3. Deadline Workflow (Gestão de Obrigações e Prazos)

Este módulo permite ao escritório acompanhar, assinar e dar baixa em prazos legais e tarefas internas.

* **Tabelas do Banco Envolvidas**: `deadlines`, `deadline_history` e `queue_projections`.
* **APIs Necessárias**:
  * `POST /api/v1/deadlines` (criação manual de prazo).
  * `PUT /api/v1/deadlines/:deadlineId` (edição ou alteração de data limite).
  * `POST /api/v1/deadlines/:deadlineId/complete` (encerra o prazo e anexa a evidência de conclusão).
* **Mutations Necessárias**:
  * `useCreateDeadline`, `useUpdateDeadline` e `useCompleteDeadline`.
* **Hooks Frontend Necessários**: `useCaseDeadlines`.
* **Componentes Frontend Necessários**:
  * **Modal de Criação/Edição de Prazo**: Campo para classe (legal, interna, etc.), prioridade e data limite.
  * **Ação de Baixa de Prazo**: Botão no Workspace com formulário para anexar evento ou id da peça anexada como evidência de cumprimento.
* **Fluxo Operacional**:
  1. Advogado cria um prazo associado ao caso.
  2. O prazo é indexado na fila operacional do Dashboard.
  3. Ao cumprir, o advogado clica em "Marcar como Concluído".
  4. Backend grava a data de conclusão, usuário executor e remove o item da fila prioritária.
* **Critérios de Aceite**:
  * Prazos vencidos alertam visualmente o painel com badges vermelhos.
  * Concluir o prazo retira a tarefa da aba "Resumo" instantaneamente.

---

## 4. Document Workflow (Gestão de Arquivos)

Gerenciamento de entrada e upload direto de peças processuais na pasta do caso.

* **Tabelas do Banco Envolvidas**: `documents`.
* **APIs Necessárias**:
  * `POST /api/v1/cases/:caseId/documents/upload-url` (assina URL temporária para o S3/R2).
  * `POST /api/v1/cases/:caseId/documents` (confirma a criação do metadado do documento após upload de sucesso).
* **Mutations Necessárias**:
  * `useUploadDocument`: Faz o upload físico e salva os metadados.
* **Hooks Frontend Necessários**: `useCaseDocuments`.
* **Componentes Frontend Necessários**:
  * **Área de Drag-and-Drop**: Input de arquivos na aba de documentos do Workspace.
  * **Formulário de Metadados**: Campo para definir a classe de documento (Guia de Execução, Atestado, etc.) antes da confirmação.
* **Fluxo Operacional**:
  1. Assistente arrasta o arquivo PDF para a área de upload.
  2. Frontend requisita a URL assinada ao backend e envia o binário direto para a storage.
  3. Frontend chama a rota de confirmação de metadados.
  4. O documento é listado imediatamente na aba de Peças do workspace do caso.
* **Critérios de Aceite**:
  * É possível fazer upload de múltiplos arquivos de forma sequencial.
  * O tamanho e formato (PDF) são validados no client-side antes de disparar o upload.

---

## Módulo Recomendado para Início Imediato

O módulo com maior ganho operacional imediato a ser implementado primeiro é:

**Snapshot Management (Gestão de Cálculo Penal)**

### Justificativa:
O motor de regras e os prazos dependem inteiramente de dados históricos estruturados de execução (data-base de progressão, tempo de condenação e faltas disciplinares). Sem a possibilidade de o advogado inserir e confirmar snapshots de cálculo diretamente na interface do caso, todo o sistema fica "refém" de seeds estáticos. Implementar esta gestão dá autonomia para que o escritório utilize o EXECFLOW com casos reais do início ao fim.
