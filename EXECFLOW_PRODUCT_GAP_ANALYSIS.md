# EXECFLOW — PRODUCT GAP ANALYSIS

Este documento apresenta uma análise detalhada dos descompassos (gaps) do EXECFLOW, comparando o Documento-Mestre, o contexto do sistema, a arquitetura desejada e o estado atual real do repositório.

---

# STATUS GERAL

Abaixo está o percentual estimado de conclusão por disciplina/módulo com base nas implementações reais (código-fonte, APIs e banco) vs. especificação do Documento-Mestre:

* **Arquitetura**: **85%**
  * O design de microsserviços/monorepo, padrão de eventos outbox, e o princípio dos dois relógios estão muito bem implementados e estruturados no código.
* **Banco de dados**: **80%**
  * O schema Drizzle modela quase todas as entidades de forma íntegra. Há 3 pequenos bugs/divergências em migrations corrigíveis.
* **Backend (API)**: **35%**
  * Existem rotas de mutações e endpoints específicos de execução penal, porém a maioria das rotas GET de listagem, paginação por cursor refinada e operações de admin estão incompletas ou ausentes.
* **Frontend**: **25%**
  * A casca visual e o mapeamento de leitura nas páginas principais e Case Workspace estão prontos, mas faltam praticamente todas as interações de mutação de estado (aprovar oportunidade, revisar snapshot, etc.).
* **Motor (Engine)**: **30%**
  * A infraestrutura de EngineRuns e traces de execução de playbooks está arquitetada, mas os avaliadores de frações reais da LEP ainda são stubs e placeholders aritiméticos (falta a profundidade legal brasileira).
* **OCR**: **5%**
  * Apenas esquemas de tipos definidos. Faltam workers de leitura assíncrona (Mastra/Azure), persistência e hooks de frontend.
* **IA**: **5%**
  * Há definições teóricas para o assistente de triagem de peças e rascunhos automáticos, mas nada implementado de maneira funcional.
* **Produto operacional**: **20%**
  * O EXECFLOW opera atualmente como um excelente protótipo interativo visual, mas está distante de ser utilizado em produção devido à ausência das rotas e das telas administrativas de snapshot de pena.

---

# MÓDULOS IMPLEMENTADOS

* **Dashboard**
  * **Status**: Parcialmente Funcional (MVP Visual com leitura real).
  * **Dependências**: `useQueueProjections`, `useDeadlines`, `useDocuments`, `useCases`, `useEngineRuns`.
  * **Limitações**: Permite visualizar o panorama geral da organização, mas as ações rápidas e cliques nos itens direcionam para telas sem ações operacionais.
* **Clientes**
  * **Status**: Funcional.
  * **Dependências**: `useClients`, `useClient`.
  * **Limitações**: Leitura e exibição funcionando, mas não há tela de criação/editação de clientes ou histórico de vinculações.
* **Casos (Execuções)**
  * **Status**: Funcional.
  * **Dependências**: `useCases`, `useCase`.
  * **Limitações**: Listagem e filtros estão ok. A criação ou suspensão de casos depende de comandos de banco ou seeds.
* **Workspace (Resumo, Timeline, Documentos, Oportunidades, Prazos, Motor)**
  * **Status**: Funcional (Visualização).
  * **Dependências**: Todos os hooks específicos de caso (`useCaseTimeline`, etc.).
  * **Limitações**: Apenas leitura. Não há possibilidade de mutar nenhum dado a partir da interface.

---

# FUNCIONALIDADES VISUALMENTE PRESENTES MAS NÃO OPERACIONAIS

Estas funcionalidades aparecem nos layouts do frontend, mas não possuem integração com a cadeia completa (Banco → API → Hooks → Ação):

* **Aprovar/Rejeitar Oportunidade**: A aba de oportunidades renderiza as sugestões com os badges, porém não há botões ou modais para assinar a `opportunity_reviews` e disparar a transição de estado no banco.
* **Gerar Peça Processual**: O rascunho de petições a partir de uma oportunidade qualificada é citado na interface e nos botões rápidos, mas não possui API de IA ou template engine integrada no backend.
* **Visualizar PDF das Peças**: A aba de documentos lista as peças com seus metadados ricos e links correspondentes, mas o visualizador interno ou redirecionamento de download seguro não está conectado ao Cloudflare R2/S3.
* **Confirmar/Criar Snapshots de Pena**: A engrenagem de cálculo do motor depende de sentenças e históricos prisionais. Na interface não há um painel para o advogado ajustar ou confirmar o snapshot a partir do documento extraído pela OCR.
* **Workflow de Revisão de OCR**: As tarefas de revisar extração aparecem na fila, mas clicar nelas não abre a interface de comparação lado a lado (documento PDF vs. chaves-valores).

---

# FUNCIONALIDADES TOTALMENTE AUSENTES

### MVP
* Endpoints HTTP para criação, supersessão e confirmação manual de `sentence_snapshots` e `custody_snapshots`.
* Fluxo de convite e gerenciamento básico de permissões de usuários/advogados (Tenant Isolation ativo mas sem UI de admin).

### Fase 2
* Pipeline de processamento assíncrono de OCR integrado com provedor externo.
* Visualizador de PDF com overlay de dados extraídos para auditoria humana.

### Fase 3
* Motor completo com a aritmética da LEP de 1984 e Pacote Anticrime de 2019 (frações de 16%, 20%, 25%, 30%, 40%, 50%, 60%, 70%).
* Sistema ativo de notificações push/e-mail para alertas de prazos.

### Futuro
* Integração nativa bidirecional com os tribunais brasileiros (sistemas PJe/SEEU).
* Módulo financeiro de cobrança e honorários baseado no sucesso das oportunidades reais alcançadas.

---

# ROADMAP REALISTA

Para que o EXECFLOW atinja a sua "primeira versão operacional utilizável", propomos a seguinte sequência técnica:

1. **Correção de Bugs Críticos de Infraestrutura (P0)**
   * **Impacto**: Bloqueante (Evita falhas em novas instalações e loops infinitos).
   * **Complexidade**: Baixa (Consertar trigger na Migration 0004, tipo boolean na Migration 0006 e acoplar trigger de execução de recalculação em `scheduleRecalculation`).
   * **Dependências**: Nenhuma.
   * **Estimativa**: 1 dia útil.

2. **Rotas Administrativas de Snapshots (P1)**
   * **Impacto**: Altíssimo (Permite criar casos novos e calibrar a base de cálculo).
   * **Complexidade**: Média (Construir serviços de `sentenceSnapshot.confirm` e `supersede` no backend e expor via endpoints HTTP).
   * **Dependências**: Nenhuma.
   * **Estimativa**: 4 dias úteis.

3. **Frontend de Gestão de Snapshots de Pena (P1)**
   * **Impacto**: Alto (Interface para o advogado cadastrar e confirmar o cálculo manualmente antes de rodar o motor).
   * **Complexidade**: Média-Alta (Exige formulários ricos de cálculo penal no frontend).
   * **Dependências**: Rotas Administrativas de Snapshots.
   * **Estimativa**: 5 dias úteis.

4. **Ações do Workspace de Oportunidades (P1)**
   * **Impacto**: Altíssimo (Permite qualificar ou descartar oportunidades geradas pelo motor).
   * **Complexidade**: Média (Escrever API de revisão de oportunidades e botões de ação na aba do Workspace).
   * **Dependências**: Nenhuma.
   * **Estimativa**: 5 dias úteis.

---

# PRÓXIMA FASE RECOMENDADA

A próxima fase recomendada com maior impacto prático é:

**Implementação da Camada de Gestão e Confirmação de Snapshots (Banco → API → Frontend)**

* **Justificativa**: Sem snapshots reais cadastrados de maneira visual pelo advogado, a engine do EXECFLOW não possui matéria-prima para cálculo, forçando o uso exclusivo de dados de seeds inseridos manualmente. Dar ao usuário o poder de configurar o cálculo e a data-base de uma execução penal é o primeiro passo absoluto para tornar o software utilizável por um escritório real.
