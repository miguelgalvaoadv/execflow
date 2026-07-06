# Relatório Final — Painel Jurídico Inteligente (ExecFlow)

**Data:** 02/07/2026 · **Escopo:** transformação da plataforma em painel jurídico criminal completo, reaproveitando a base existente.

---

## 1. O que foi implementado (novo nesta entrega)

| Módulo | O que faz | Onde |
|---|---|---|
| **Inventário por OAB** | Importação CSV em massa (~200 processos), classificação determinística de prioridade (alta/média/baixa com justificativa), triagem, promoção a caso | `/inventory` · `apps/api/src/routes/inventory.ts` · `packages/engine/src/inventory-classifier.ts` |
| **Intimações estruturadas** | Toda intimação AASP vira `court_communications` (processada/vinculada ao inventário/órfã) com dedup por hash, 3 datas (disponibilização/publicação/ciência), heurística de possível prazo, triagem manual | `/intimations` · `apps/api/src/routes/communications.ts` |
| **Prazo provisório automático** | Intimação com sinal de prazo → prazo PROVISÓRIO (5 dias corridos conservadores, prioridade crítica, `origin='extracted'`) aguardando validação humana | webhook AASP em `webhooks.ts` |
| **Tarefas** | Tela sobre a máquina de estados existente (assumir/liberar/concluir); **oportunidade só vira tarefa após validação do advogado** (422 se sugerida) | `/tasks` · `POST /opportunities/:id/create-task` |
| **Portal do cliente** | Role `client` + vínculo `memberships.linked_client_id`; API whitelist (status simples, última movimentação de tribunal, documentos por nome); layout próprio sem shell interno | `/portal` · `apps/api/src/routes/portal.ts` |
| **Integrações (tela)** | 16 conectores com status HONESTO (credencial no ambiente + evidência de execução); pendentes indicam a alternativa CSV | `/settings/integracoes` |
| **Histórico da IA** | Toda chamada ao Claude gravada (agente, modelo, prompt, resposta, tokens, custo estimado, erro); acesso lawyer+ | `/settings/ia-historico` · `services/ai-log.ts` |
| **Partes do processo** | Réu/corréu/vítima/MP/advogado/testemunha com confiança sugerida×confirmada | aba "Partes & Busca" no caso |
| **Busca nos autos** | Busca no texto OCR com citação de **documento + página exata + trecho + confiança** | `POST /cases/:id/search-autos` |
| **Worker DataJud** | Enriquecimento diário do inventário (cron 09:30 UTC) por CNJ; preenche só campos vazios; reclassifica; alimenta o conector | `packages/workers/src/consumers/inventory-enrichment.ts` |

## 2. O que foi reaproveitado (já existia)

- Motor determinístico de prazos e benefícios LEP (`packages/engine` — evaluators, confiança, playbooks)
- Oportunidades com revisão obrigatória + histórico de status
- Cadastro sugerido + validação humana (intake, extração, snapshot promotion, review decisions)
- Trava de frescor dos autos (stale → bloqueia peça com 409) e versionamento com `supersedesDocumentId`
- Minutas com Claude (prompt editável, DOCX) · Cálculo de pena por IA · Timeline · Auditoria (`audit_logs`)
- Webhook AASP/Jusbrasil, pipeline Astrea (pausado por kill-switch), upload/OCR/extração, notificações e-mail

## 3. Removido/pausado
- Nada foi apagado. Astrea IMAP pausado via `ASTREA_EMAIL_POLL_ENABLED=false` (contingência preservada).

## 4. Migrações aplicadas (verificadas coluna a coluna no banco)
- **0010_painel_juridico**: `oab_profiles`, `inventory_items`, `case_parties`, `court_communications`, `integration_connectors`, `ai_interaction_logs` + prioridade em casos + origem/validação de cadastro em clientes
- **0011_client_portal**: role `client` no enum + `memberships.linked_client_id`
- **Bug crítico corrigido**: a 0009 nunca tinha sido aplicada (timestamp fora de ordem no journal fazia o Drizzle pulá-la silenciosamente) — **criar caso estava quebrado**; corrigido e verificado.

## 5. Resultado dos ciclos de teste (executados de verdade nesta sessão)

| # | Ciclo | Resultado |
|---|---|---|
| 1 | Fluxo feliz (cliente→caso→intimação→prazo provisório→oportunidade validada→tarefa→concluir) | ✅ |
| 2 | PDF válido (presign→blob→complete, doc criado) | ✅ (após correção de CORS) |
| 3 | PDF ruim (bytes ≠ checksum) | ✅ rejeitado 422 gracioso |
| 4 | Cliente sem CPF | ✅ (sem ref → 422; com internalRef → 201) |
| 5 | Vários réus (réu+corréu+vítima em `case_parties`) | ✅ |
| 6 | Segredo de justiça manual → prioridade alta | ✅ |
| 7 | Movimentação genérica ("autos conclusos") → NÃO trava, NÃO cria prazo | ✅ |
| 8 | Sentença → stale → **peça bloqueada 409 FRESHNESS_GATE_BLOCKED** | ✅ |
| 9 | Execução penal (homologação de cálculo → reclassifica alta + precisa de autos + prazo provisório) | ✅ (parte IA bloqueada por créditos) |
| 10 | Importado sem autos → aviso sem bloqueio | ✅ |

**Extras verificados:** portal do cliente sem vazamento (0 campos internos no payload; 14/14 rotas internas → 403), busca com página exata (pág. 2 e 3 citadas corretamente), worker boota com todos os crons, dedup de intimações, auditoria (83 logs), histórico IA (4 registros incl. erro real), typecheck+build completos zero erros, console zero erros.

## 6. Erros encontrados e corrigidos DURANTE os testes
1. **Migração 0009 nunca aplicada** (journal fora de ordem) → criar caso quebrado em produção → corrigido.
2. **Dedup de intimações órfãs falhava** quando o payload não trazia data → hash estabilizado.
3. **CORS bloqueava upload no navegador** (`X-Upload-Token` fora de `allowHeaders`) → corrigido.
4. **5 brechas de segurança para o role client** (tarefas, filas, sync, minutas, engine runs, membros da equipe) → todas fechadas com piso `assistant`.
5. Classificador: "sem cliente" sozinho elevava tudo a alta → agora só reforça com outro sinal.
6. DataJud: falha de rede era contada como "não encontrado" → agora reporta erro honesto no conector.

## 7. Limitações reais (sem fingimento)
- **⚠️ CONTA ANTHROPIC SEM CRÉDITOS** — detector de criticidade, minutas e cálculo de pena degradam graciosamente mas NÃO FUNCIONAM até recarga em console.anthropic.com/settings/billing. O histórico da IA capturou o erro exato.
- **API DataJud (CNJ) inacessível** desta rede durante os testes (timeout em todos os clientes HTTP) — código completo e com degradação honesta; validar hit real quando a API voltar.
- e-SAJ/PJe/eproc/Projudi/SEEU/STJ/STF/DJEN/Domicílio: conectores em `pending_credential` — **alternativa funcional é o CSV** (por design; sem burlar captcha/login).
- Prazo provisório usa contagem conservadora fixa (5 dias corridos) — o enquadramento fino (dias úteis, feriados, tipo de peça via motor determinístico completo) é a evolução natural.
- Busca nos autos = texto OCR (ILIKE) com citação de página via marcadores `\f`; pgvector documentado como evolução (requer extensão + embeddings).
- OCR automático depende do worker no ar (Render: serviço `execflow-workers`).
- Deploy Render: worker precisa ser publicado/reiniciado com este código (tarefa #26 pendente de infra).

## 8. Como rodar local
```bash
pnpm install
pnpm db:migrate                      # migrações (packages/db/.env.local → DATABASE_URL)
pnpm --filter @execflow/api dev      # API :3001
pnpm --filter @execflow/web dev      # Web :3000
pnpm --filter @execflow/workers dev  # Workers (crons + filas)
```
Login staff: `admin@execflow.local` · Cliente de teste do portal: `cliente@execflow.local` (mesma senha dev).
Criar usuário-cliente: `pnpm --filter @execflow/db exec tsx --env-file=.env.local scripts/seed-client-user.ts <email> <clientId>`

## 9. Próximos passos recomendados
1. **Recarregar créditos Anthropic** (destrava IA: tiers, minutas, cálculo).
2. Registrar na AASP (`intimacaoapi-cadastro.aasp.org.br`) → `AASP_WEBHOOK_TOKEN` → enviar 1º payload real para eu travar o schema.
3. Deploy no Render (API + worker) com as novas env vars.
4. Importar o CSV real dos ~200 processos e revisar a triagem.
5. Evoluções: motor fino de prazos por tipo de peça, pgvector, tela de movimentações dedicada, agenda/Google Calendar.
