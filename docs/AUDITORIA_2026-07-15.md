# Auditoria completa do ExecFlow — 15/07/2026

Auditoria ponta a ponta (dados + funcionalidades + integrações + testes reais pagos)
feita para a entrega dos 40 casos ao chefe nesta semana. Tudo abaixo foi **verificado
com evidência** (queries no banco de produção, chamadas HTTP reais, análise de código),
não com suposição.

---

## 1. Veredito geral

| Área | Estado | Observação |
|---|---|---|
| Dados dos 40 casos | 🟢 Limpos | Sem inglês/código visível, sem lixo de features removidas (1 evento simulado encontrado e removido) |
| Análise de autos (Claude) | 🟢 Funciona | Testada HOJE no caso real do BRUNO — sucesso, com citação de páginas |
| DJEN (intimações) | 🟡 Funciona, mas OAB é placeholder | Perfil cadastrado com OAB **999999/SP** — corrigir para a OAB real |
| InfoSimples (movimentações) | 🔴 **PARADO** | Token perdeu autorização (erro 603) — desde ~09/07 nenhum caso atualiza |
| OCR / armazenamento | 🔴 Divergente | Autos enviados ficam no disco local; worker do Render procura no S3 e não acha |
| Workers (Render) | 🟢 Vivos | Pegaram o evento do teste em segundos |
| Dashboard/Radar/Agenda | 🟢 Em sincronia | Números da dashboard = COUNT real no banco (conferido um a um) |
| Autocorreção | 🟢 Boa (com 1 correção feita hoje) | Sweeps automáticos OK; relay do outbox corrigido |

**Pronto pra entregar?** Sim, com 3 ações que **só o Miguel** pode fazer antes
(seção 4) + o mutirão de autos (seção 6).

---

## 2. O que foi testado AO VIVO hoje (com custo real)

1. **Analisar autos (IA) — caso BRUNO NATALINO** → `202 Accepted`, concluiu em ~3min:
   snapshot proposto de **2.922 dias (8 anos)**, 32,7% cumprido, tráfico (hediondo, 5a)
   + organização criminosa (comum, 3a) em concurso material distinguidos crime a crime,
   acórdão que reduziu de 9a7m para 8a identificado, **5 prazos + 4 oportunidades +
   4 alertas + 5 fatos** criados, com dedup automático das 5 sugestões antigas.
   Fato com citação: "Progressão ao semiaberto deferida... fls. 150-153 (DEECRIM 3ª RAJ)".
   → Créditos Anthropic estão OK hoje.
2. **Sincronizar Tribunal — caso Igor Wesley** → `202`, worker do **Render pegou em
   segundos** (cadeia botão→outbox→worker 100% funcional) e falhou honestamente com
   **InfoSimples code 603** (token sem autorização) — o erro aparece vermelho na tela,
   sem fingir sucesso. O DJEN rodou sem erro dentro do mesmo sync.
3. **Preparar p/ ChatGPT — caso Igor** → pacote de 6.525 caracteres com contexto do
   caso + schema JSON correto. Botão OK (o teste com o ChatGPT de verdade fica pra
   fazermos juntos, como você pediu).
4. **Dashboard vs banco** → todos os 8 números conferidos contra COUNT direto:
   40 casos, 41 clientes, 1 intimação nova, 10 prazos vencidos, 1 na semana,
   46 tarefas, 87 oportunidades, 0 eventos hoje. **Batem 100%.**

## 3. Problemas encontrados e o que JÁ FOI corrigido hoje

| Problema | Gravidade | Estado |
|---|---|---|
| 15.542 eventos `failed` no outbox (loop de publicação p/ filas inexistentes) | Média (poluição/ruído) | ✅ Corrigido no código (`e9d430a`) — eventos só-registro não tentam mais publicar |
| Radar mostrava 31 "prazos vencidos" quando só 10 existem (21 projeções órfãs) | Média (UI mente) | ✅ 21 projeções resolvidas — Radar agora = 10 reais |
| 3 projeções de "extração para revisar" de documentos que não existem mais | Baixa | ✅ Resolvidas |
| Evento **simulado** ("Movimentação Simulada... JUDIT") na timeline do MARCOS PAULO | Baixa (resíduo de mock) | ✅ Removido |
| Texto em inglês/código em dados visíveis | — | ✅ Auditado: **zero** em prazos/oportunidades/tarefas; timeline limpa |
| Análises/syncs travados em `running` | — | ✅ Zero travados |
| Prazos `open` com vencimento passado sem virar `overdue` | — | ✅ Zero — a varredura automática (overdue sweep) está funcionando |
| Oportunidades abertas com janela vencida | — | ✅ Zero |

## 4. AÇÕES QUE SÓ VOCÊ PODE FAZER (antes da entrega)

1. **🔴 InfoSimples (a mais urgente):** o token deu **code 603 — "não tem autorização
   de acesso ao serviço"**. Entrar no painel da InfoSimples e reativar/renovar a
   autorização do serviço TJSP e-SAJ (ou gerar token novo e trocar `INFOSIMPLES_TOKEN`
   no Render → execflow-workers). Sem isso, **nenhum caso recebe movimentação nova**
   (última atualização real: 07/07).
2. **🔴 OAB real no perfil:** o Inventário está com **OAB 999999/SP** (placeholder).
   O DJEN consulta o CNJ **por esse número** — trocar pela sua OAB real na tela de
   Inventário/perfil OAB. Sem isso a captação de intimações é loteria.
3. **🟡 Armazenamento dos autos:** a API local grava PDF em disco local
   (`STORAGE_PROVIDER=local`), e o worker do Render procura no S3 → OCR falha com
   "Object not found". Decisão: (a) configurar `STORAGE_S3_*`/R2 no `.env.local` da
   API local para gravar direto na nuvem (e re-subir os 4 autos existentes), ou
   (b) aceitar que upload+análise rodam só da sua máquina por enquanto.
   A análise por IA **funciona mesmo assim** (para PDFs ≤600 págs) — o que quebra é
   OCR/reanálise incremental de autos que crescem.
4. **🟡 Cliente placeholder:** "Executado (processo 0008415-36...)" — colocar o nome
   real da pessoa (Clientes → Editar).
5. 🟢 Créditos Anthropic: OK hoje (o problema de 12/07 foi resolvido). Continuar
   conferindo o saldo no card do Claude em Configurações antes de mutirões de análise.

## 5. Integração entre categorias (verificada com evidência)

- Autos confirmados → **Analisar (IA)** → snapshot (aba Cálculos) + oportunidades
  (aba do caso + hub) + prazos (aba + hub + **dashboard** + **sininho** + Radar). ✔ visto hoje no BRUNO.
- Intimação DJEN → aba Intimações + contador "novas" na dashboard + prazo provisório
  ("PROVISÓRIO — validar prazo" do Igor). ✔
- Prazo vencido → sweep automático marca `overdue` → dashboard/Radar/sininho. ✔
- Prazos/oportunidades → botão "Adicionar à agenda" → Agenda/notificações. ✔
- Tarefas ("Anexar autos", "Completar CNJ") criadas no cadastro → /tarefas + aba do caso. ✔
- Financeiro/Equipe/Configurações: módulos novos testados nas entregas anteriores. ✔

## 6. Caso a caso — o que falta pra cada um

**Resumo:** 4 casos completos (autos + análise) · 30 com movimentação mas SEM autos ·
6 sem CNJ. As 46 tarefas pendentes do sistema são exatamente este checklist
(40 "Anexar autos" + 6 "Completar CNJ").

> Nota: a tabela abaixo é o retrato do início da auditoria; durante ela o BRUNO foi
> analisado com sucesso (grupo B→A). O Marcelo tem snapshot de 08/07 (a última tentativa
> de reanálise falhou por crédito em 12/07 — basta clicar Analisar de novo).

| # | Grupo | Cliente | CNJ | Autos | Movs | DJEN | Oportunidades | Prazos | Ação necessária |
|---|---|---|---|---|---|---|---|---|---|
| 1 | A-ANALISADO | HÍGOR GABRIEL BARBOSA DA SILVA Réu Preso | 0007568-34.2023.8.26.0496 | 1 | 84 | nao | qualified:1,suggested:7,dismissed:10 | open:6,overdue:1 | Revisar oportunidades/prazos gerados |
| 2 | A-ANALISADO | LEANDRO GOMES BALBINO | 0000778-79.2025.8.26.0426 | 1 | 5 | nao | qualified:2,suggested:7 | open:1,overdue:5 | Autos incompletos (cálculo zerado) — anexar guia + cálculo |
| 3 | A-ANALISADO (hoje) | BRUNO NATALINO RODRIGUES Réu Preso | 0006057-64.2024.8.26.0496 | 1 | 41 | nao | suggested:4 (novas) | open:5 | Revisar oportunidades/prazos gerados hoje |
| 4 | A-ANALISADO (08/07) | Marcelo Henrique Ponciano Rodrigues | 0005988-32.2024.8.26.0496 | 1 | 8 | nao | suggested:6,qualified:1 | acknowledged:1,overdue:3 | Reanalisar (última tentativa caiu por crédito) + revisar vencidos |
| 5 | C-SO-MOVIMENTACAO | Ademir Fernandes Borges | 0007201-10.2023.8.26.0496 | 0 | 57 | nao | suggested:2 | — | Anexar autos do processo |
| 6 | C-SO-MOVIMENTACAO | Alexandre Resende de Oliveira | 0011291-20.2025.8.26.0196 | 0 | 0 | nao | — | — | Anexar autos do processo |
| 7 | C-SO-MOVIMENTACAO | André Luis de Sousa Arlindo | 7000413-24.2019.8.26.0196 | 0 | 6 | nao | — | — | Anexar autos do processo |
| 8 | C-SO-MOVIMENTACAO | Arlindo Cesar Ap. Pereira Jr | 0004494-69.2023.8.26.0496 | 0 | 59 | nao | suggested:3 | — | Anexar autos do processo |
| 9 | C-SO-MOVIMENTACAO | Cristiano Mouro da Silva | 0010669-45.2024.8.26.0496 | 0 | 9 | nao | suggested:3 | — | Anexar autos do processo |
| 10 | C-SO-MOVIMENTACAO | Edison Ribeiro de Souza Neto | 0003024-03.2023.8.26.0496 | 0 | 8 | nao | — | — | Anexar autos do processo |
| 11 | C-SO-MOVIMENTACAO | Executado (processo 0008415-36…) | 0008415-36.2023.8.26.0496 | 0 | 148 | nao | — | — | **Corrigir nome do cliente** + anexar autos |
| 12 | C-SO-MOVIMENTACAO | Fabiano Nicolau Simões dos Reis | 0002422-46.2022.8.26.0496 | 0 | 10 | nao | suggested:2 | — | Anexar autos do processo |
| 13 | C-SO-MOVIMENTACAO | Gabriel Rodrigues Pereira | 0007163-66.2021.8.26.0496 | 0 | 0 | nao | — | — | Anexar autos do processo |
| 14 | C-SO-MOVIMENTACAO | Gilson de Souza de Almeida | 0011216-54.2020.8.26.0196 | 0 | 20 | nao | — | — | Anexar autos do processo |
| 15 | C-SO-MOVIMENTACAO | Guilherme Rainer da Silva | 0012102-84.2024.8.26.0496 | 0 | 8 | nao | suggested:7 | — | Anexar autos do processo |
| 16 | C-SO-MOVIMENTACAO | Habner Ponciano Rodrigues | 0005982-25.2024.8.26.0496 | 0 | 40 | nao | suggested:2 | — | Anexar autos do processo |
| 17 | C-SO-MOVIMENTACAO | Heliomar Antunes Cintra | 0001069-63.2025.8.26.0496 | 0 | 0 | nao | — | — | Anexar autos do processo |
| 18 | C-SO-MOVIMENTACAO | Hitalo Rafael Ponciano Rodrigues | 0005984-92.2024.8.26.0496 | 0 | 10 | nao | — | — | Anexar autos do processo |
| 19 | C-SO-MOVIMENTACAO | Igor Wesley Cruz Réu Preso | 0006233-82.2020.8.26.0496 | 0 | 14 | **sim** | suggested:1 | overdue:1 | **Validar o prazo PROVISÓRIO (vencido 12/07!)** + anexar autos |
| 20 | C-SO-MOVIMENTACAO | JHONY MURARI MARQUES Réu Preso | 0008558-64.2019.8.26.0496 | 0 | 10 | nao | suggested:4 | — | Anexar autos do processo |
| 21 | C-SO-MOVIMENTACAO | João Daniel Alves | 0007088-22.2024.8.26.0496 | 0 | 0 | nao | — | — | Anexar autos do processo |
| 22 | C-SO-MOVIMENTACAO | João Vitor da Silva | 0003941-85.2024.8.26.0496 | 0 | 10 | nao | — | — | Anexar autos do processo |
| 23 | C-SO-MOVIMENTACAO | Joel Soares de Almeida | 0003038-50.2024.8.26.0496 | 0 | 82 | nao | suggested:2 | — | Anexar autos do processo |
| 24 | C-SO-MOVIMENTACAO | José Antonio M. Reche | 0010189-33.2025.8.26.0496 | 0 | 0 | nao | — | — | Anexar autos do processo |
| 25 | C-SO-MOVIMENTACAO | Leonardo Jose Rosa Réu Preso | 0001825-48.2020.8.26.0496 | 0 | 10 | nao | suggested:5 | — | Anexar autos do processo |
| 26 | C-SO-MOVIMENTACAO | Lucas E. Matos | 0009560-69.2019.8.26.0496 | 0 | 8 | nao | suggested:4 | — | Anexar autos do processo |
| 27 | C-SO-MOVIMENTACAO | Luis Eduardo Raimundo | 0004569-06.2026.8.26.0496 | 0 | 0 | nao | — | — | Anexar autos do processo |
| 28 | C-SO-MOVIMENTACAO | MARCOS PAULO MENESES FERREIRA Réu Preso | 0006325-60.2020.8.26.0496 | 0 | 192 | nao | suggested:16 | — | Anexar autos (16 sugestões p/ triar — prioridade) |
| 29 | C-SO-MOVIMENTACAO | Mateus Henrique Ribeiro | 0010623-74.2025.8.26.0026 | 0 | 0 | nao | — | — | Anexar autos do processo |
| 30 | C-SO-MOVIMENTACAO | Nalmir W. Moraes | 0009234-41.2021.8.26.0496 | 0 | 8 | nao | — | — | Anexar autos do processo |
| 31 | C-SO-MOVIMENTACAO | Paulo Filipe Alves | 0007092-40.2016.8.26.0496 | 0 | 10 | nao | suggested:3 | — | Anexar autos do processo |
| 32 | C-SO-MOVIMENTACAO | Rodrigo Alves de Freitas | 0001776-12.2017.8.26.0496 | 0 | 10 | nao | suggested:2 | — | Anexar autos do processo |
| 33 | C-SO-MOVIMENTACAO | Tiago Ponciano Lopes da Silva | 0015857-82.2025.8.26.0496 | 0 | 9 | nao | suggested:2 | — | Anexar autos do processo |
| 34 | C-SO-MOVIMENTACAO | WESLEI MARQUES | 7000310-17.2019.8.26.0196 | 0 | 6 | nao | — | — | Anexar autos do processo |
| 35 | D-SEM-CNJ | Kauã Firmino | SEM CNJ | 0 | 0 | nao | — | — | Cadastrar CNJ + anexar autos |
| 36 | D-SEM-CNJ | Milla Rhanna de Almeida | SEM CNJ | 0 | 0 | nao | — | — | Cadastrar CNJ + anexar autos |
| 37 | D-SEM-CNJ | Noel Verissimo de Souza | SEM CNJ | 0 | 0 | nao | — | — | Cadastrar CNJ + anexar autos |
| 38 | D-SEM-CNJ | Robson Borges da Silva | SEM CNJ | 0 | 0 | nao | — | — | Cadastrar CNJ + anexar autos |
| 39 | D-SEM-CNJ | Rogerio da Silva Reche | SEM CNJ | 0 | 0 | nao | — | — | Cadastrar CNJ + anexar autos |
| 40 | D-SEM-CNJ | Silvia Alves Pereira | SEM CNJ | 0 | 0 | nao | — | — | Cadastrar CNJ + anexar autos |

**DJEN por caso:** só o **Igor Wesley** recebeu intimação via DJEN até hoje (disponibilizada
07/07, captada 13/07). Todos os demais dependem de: OAB real no perfil (ação 2 da seção 4)
+ o processo publicar algo novo no Diário. Não é defeito — o DJEN só vê o que sai publicado
por dia; o histórico entra pelos autos.

**Prazos vencidos (10) a conferir pelo advogado:** 4 do Marcelo (inclui manifestação de
04/04), 5 do LEANDRO, 1 do Hígor, e o PROVISÓRIO do Igor (crítico). São prazos REAIS
gerados de autos/intimação — concluir ou dispensar com motivo na tela de Prazos.

## 7. Cálculos vs lei (conferência jurídica)

- **BRUNO (hoje):** 8 anos = 2.922 dias ✓ (bissexto contado), tráfico hediondo separado
  de orgcrim comum ✓, concurso material ✓, fatos pré-25/03/2026 → frações antigas ✓.
- **Hígor:** 4.940d por unificação (art. 111 LEP) de 4 processos ✓; 24,7% = 1.218/4.940 ✓.
  ⚠ Observação: o % NÃO soma os 219 dias remidos no numerador — art. 128 LEP manda contar
  remição como pena cumprida (seria ~29%). Conservador; revisar na homologação do snapshot.
- **Marcelo:** 2.920d/8 anos, 33,7% ✓.
- **LEANDRO:** snapshot **zerado** (0d/0%) — autos anexados não continham guia/cálculo.
  Não é bug: a IA se recusou a inventar. Anexar autos completos e reanalisar.
- A tabela de frações no prompt cobre as **Leis 15.358/2026 e 15.402/2026** com regra de
  irretroatividade pela data do fato.

## 8. Previsão de bugs e autocorreção

**O que se autocorrige sozinho:**
- Prazo virou vencido → overdue sweep periódico marca e projeta no Radar (comprovado: zero esquecidos).
- Eventos de fila → pg-boss com retry; publicação falha → 5 tentativas → dead-letter (e após o fix de hoje, evento sem consumidor nem tenta).
- OCR → 3 tentativas com registro de erro por documento.
- Duplo clique em Analisar → guarda de run em andamento (custo protegido).
- Sync que falha → log vermelho na tela; `manual_review` no caso (não finge sucesso).
- Casos sigilosos → lembrete diário automático de conferência manual.

**O que NÃO se autocorrige (e como se manifesta):**
- Token InfoSimples inválido → todos os casos ficam `manual_review` silenciosamente até alguém olhar Integrações (é o estado ATUAL). Sinal: "Última atualização" parada há dias.
- Créditos Anthropic zerados → botão Analisar falha com erro claro, mas nada avisa ANTES; conferir o card do Claude em Configurações (mostra custo do mês + link do saldo).
- Storage divergente local×Render → OCR falha para sempre naquele documento (o erro fica registrado no doc).
- Análise interrompida no meio (queda do processo da API) → run pode ficar `running` e **bloquear o botão** daquele caso (hoje: zero travados; se acontecer, marcar o run como failed no banco destrava).
- Worker do Render fora do ar → botão Sincronizar fica em "pending" para sempre (hoje: vivo).

## 9. Roteiro de entrega da semana (passo a passo)

**Dia 1 (antes de tudo — 30min):**
1. Renovar autorização do token InfoSimples (painel deles) → testar com "Sincronizar Tribunal" em 1 caso → deve ficar verde e `monitored`.
2. Corrigir a OAB 999999 → OAB real no Inventário.
3. Corrigir o nome do cliente "Executado (processo...)".
4. (Recomendado) Configurar R2/S3 no `.env.local` local p/ os próximos uploads irem pra nuvem.

**Dias 1-3 (mutirão de autos — o grosso):**
5. Para os 6 sem CNJ: obter e cadastrar o número (Editar caso) — as tarefas "Completar CNJ" somem sozinhas ao concluir.
6. Para os 34 com CNJ sem autos (30 do grupo C + LEANDRO com autos incompletos): baixar o PDF integral no e-SAJ/SEEU e subir na aba Documentos de cada caso → confirmar → **Analisar autos (IA)**. Custo estimado: ~US$0,05-1,10/caso (≲US$40 total). Alternativa grátis: "Preparar p/ ChatGPT" + "Importar" (a validar juntos).
7. Conferir cada análise: aba Cálculos (homologar/rejeitar o snapshot), Oportunidades (qualificar/dispensar as sugeridas — hoje 87 no total, MARCOS PAULO com 16 é o maior), Prazos (concluir/dispensar os 10 vencidos, validar o PROVISÓRIO do Igor).

**Dia 4 (fechamento):**
8. Dashboard deve mostrar: 0 tarefas "Anexar autos"/"Completar CNJ", prazos vencidos zerados ou justificados, oportunidades triadas.
9. Criar o acesso do chefe em **Equipe → Criar acesso** (papel Advogado ou Admin) e repassar login+senha.
10. Mostrar pra ele: Início (números reais) → um caso completo (BRUNO ou Hígor: Cálculos + Oportunidades + Prazos) → Intimações → Agenda → Financeiro.

---
*Gerado pela auditoria automatizada de 15/07/2026. Evidências: queries em produção,
testes HTTP reais (análise BRUNO com custo real, sync Igor via worker Render),
código-fonte revisado. Correções aplicadas nesta data: commit `e9d430a` (outbox) +
limpeza de 24 projeções órfãs + remoção de 1 evento simulado.*
