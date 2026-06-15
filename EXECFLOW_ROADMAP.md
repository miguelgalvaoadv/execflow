# EXECFLOW: Roadmap (Post-MVP)

## MARCO 1 — MVP EXECFLOW (✅ CONCLUÍDO)
- Upload de documento → OCR → Snapshot → LFP → Evaluator → Opportunity persistida → Dashboard
- O fluxo End-to-End foi comprovado operando visualmente na interface (Motor gerando oportunidades).

## MARCO 2 — BENEFÍCIOS PRINCIPAIS (Próximo)
Foco exclusivo na expansão e correção de lógicas de domínio:
- **Remover Mocks**: Implementar a lógica real no LegalFactProcessor para ler os resultados do OCR e convertê-los em sentenças dinâmicas.
- **Playbooks de Progressão Real**: Ligar o `ProgressionEvaluator` real ao catálogo JSON do Pacote Anticrime e leis anteriores (substituindo o Mock).
- **Livramento Condicional (Parole)**: Adicionar `ParoleEvaluator` com verificação de reparação de dano e comportamento.
- **Remição**: Adicionar o tracker de remição de pena para estudo e trabalho, ligando às oportunidades detectadas.
- **Auditoria Jurídica**: Habilitar traces por Rationale em cada nível, conectando os artigos citados em tela.

## MARCO 3 — EXPLICAÇÃO JURÍDICA
- Expansão visual das oportunidades para exibir: Trilha de auditoria (quem, quando, regras de playbook), artigos legislativos e árvore de decisão do motor.

## MARCO 4 — GERAÇÃO DE PEÇAS
- Geração automática de minutas (docx/pdf) usando como base os dados extraídos em tela. Oportunidade validada gera template de petição de Livramento/Progressão.

## MARCO 5 — PAINEL OPERACIONAL E WORKFLOW
- Filas de SLA para revisão de oportunidades por advogados seniores, transição de estado da oportunidade (`suggested` → `qualified` → `pursuing`).
