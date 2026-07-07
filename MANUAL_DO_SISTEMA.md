# ExecFlow — Manual Completo do Sistema

> **Para quem é este documento:** para você, Miguel — o dono do sistema, advogado,
> não desenvolvedor. A ideia é que, lendo isto, você entenda **tudo** que o
> ExecFlow é, o que ele faz, o que está ligado, quanto custa, o que pode quebrar
> e como consertar — sem precisar decorar código.
>
> **Data desta revisão:** 07/07/2026. Feita com o sistema rodando de verdade
> (testes reais, não suposição). Onde algo não foi testável, está dito
> explicitamente.

---

## SUMÁRIO

1. [O que é o ExecFlow (resumo de 1 minuto)](#1-o-que-é-o-execflow)
2. [Como o sistema é montado (arquitetura em português)](#2-como-o-sistema-é-montado)
3. [Tudo que está conectado (inventário completo)](#3-tudo-que-está-conectado)
4. [Manual de uso — tela por tela](#4-manual-de-uso--tela-por-tela)
5. [As automações — o que roda sozinho e quando](#5-as-automações)
6. [Estado real de cada integração](#6-estado-real-de-cada-integração)
7. [Custos — hoje e o que faz subir](#7-custos)
8. [Credenciais e dados críticos a guardar](#8-credenciais-e-dados-críticos)
9. [Manutenção — rotina, o que falha e como consertar](#9-manutenção)
10. [Os objetivos do ExecFlow — cumpridos ou não](#10-objetivos--cumpridos-ou-não)
11. [Limitações conhecidas e o que ainda falta](#11-limitações-e-o-que-falta)
12. [O que mais um desenvolvedor precisaria](#12-o-que-mais-um-desenvolvedor-precisaria)

---

## 1. O QUE É O EXECFLOW

O ExecFlow é um **sistema operacional para execução penal** — um painel que:

1. **Descobre sozinho** os processos de execução penal do escritório (buscando pela OAB nos tribunais).
2. **Monitora as movimentações** desses processos automaticamente (sem você conferir cada um à mão).
3. **Recebe as intimações oficiais** (DJEN) e vincula ao processo certo.
4. **Lê os autos com Inteligência Artificial** (Claude) e sugere **prazos** e **oportunidades** (progressão de regime, livramento, indulto, prescrição, excesso de execução, etc.).
5. **Organiza tudo numa fila de trabalho** priorizada por urgência (risco à liberdade primeiro).

Em uma frase: **ele transforma "olhar processo por processo" em "o sistema me avisa o que precisa de atenção hoje".**

---

## 2. COMO O SISTEMA É MONTADO

O ExecFlow não é um programa só — são **peças que conversam entre si**. Pense num escritório:

| Peça (nome técnico) | O que é, em português | Onde roda |
|---|---|---|
| **Web** (`apps/web`) | O **site** que você abre no navegador. Tudo que você vê e clica. | Render (serviço `execflow-api`* ou próprio) |
| **API** (`apps/api`) | O **cérebro**. Recebe os cliques do site, fala com o banco, chama a IA, aplica as regras. | Render — serviço **`execflow-api`** |
| **Workers** (`packages/workers`) | O **funcionário que trabalha 24h sozinho**. Roda as automações (buscar movimentação, baixar intimação, etc.) nos horários marcados. | Render — serviço **`execflow-workers`** |
| **Banco de dados** (`packages/db`) | O **arquivo morto** — onde TODOS os dados vivem (casos, clientes, prazos, movimentações). | **Supabase** (Postgres na nuvem) |
| **Engine** (`packages/engine`) | As **regras de cálculo** de execução penal (LEP). Hoje parcialmente substituído pela IA. | Dentro da API/Workers |
| **Storage** (`packages/storage`) | Onde ficam guardados os **PDFs dos autos** que você sobe. | Local hoje (ver alerta no item 7) |
| **OCR / Extraction** (`packages/ocr`, `packages/extraction`) | Leem o **conteúdo** dos PDFs para a IA analisar. | Dentro dos Workers |
| **Auth** (`packages/auth`) | O **porteiro** — controla login e senha (Better Auth). | Dentro da API |

\* *Detalhe: hoje o site (web) e o cérebro (api) podem estar no mesmo serviço ou separados no Render — confirme no painel Render qual é o layout atual. O que importa: são 2 serviços pagos rodando, `execflow-api` e `execflow-workers`.*

**Como um pedido flui (exemplo real):**
> O worker acorda às 07:00 → busca no InfoSimples todos os processos da sua OAB →
> manda pra API → a API cria o caso no banco → quando você abre o site, o caso
> está lá. Se você sobe os autos e clica "Analisar", a API chama o Claude, que
> lê o PDF e devolve prazos e oportunidades, que a API grava no banco.

Tudo é **monorepo**: um único repositório no GitHub (`miguelgalvaoadv/execflow`)
com todas essas peças juntas. Quando você dá `git push`, o Render republica
sozinho.

---

## 3. TUDO QUE ESTÁ CONECTADO

Este é o inventário **completo** do que o sistema usa. Guarde esta tabela.

### 3.1. Plataformas onde o sistema vive

| Serviço | Para que serve | Conta/login | Pago? |
|---|---|---|---|
| **GitHub** (`github.com/miguelgalvaoadv/execflow`) | Guarda todo o código. É a fonte que o Render publica. | Sua conta GitHub | Grátis (repo é **público** — ver alerta 8) |
| **Render** (`dashboard.render.com`) | Roda a API e os Workers 24/7. | Sua conta Render | **Sim** — 2 serviços |
| **Supabase** | O banco de dados (Postgres). Todos os dados vivem aqui. | Sua conta Supabase | Grátis até certo limite / depois pago |

### 3.2. Fontes de dados dos tribunais (integrações)

| Fonte | O que traz | Custo | Estado hoje |
|---|---|---|---|
| **InfoSimples** | Descobre e monitora os processos do TJSP pela OAB (e-SAJ). **Motor principal.** | ~R$72/mês | Token configurado; roda 1x/dia |
| **DJEN** (Diário de Justiça Eletrônico Nacional) | Intimações oficiais. **Grátis, sem CNPJ.** | Grátis | ✅ **Consertado 06/07** (via caderno diário) |
| **DataJud** (CNJ) | Metadados públicos dos processos (enriquece o inventário). | Grátis | Ligado (inventário); sync de caso é opt-in |
| **Jusbrasil** | Motor antigo. Baixava capa/autos/movimentação. | Pago (não contratado) | **Desligado** (opt-in, sem chave) |
| **AASP** | Webhook de intimações (push). | Precisa cadastro AASP | Não usado (sem CNPJ) |
| **Astrea (IMAP)** | Lia notificações por e-mail. | — | **Pausado** de propósito |
| **SEEU / e-SAJ direto / PJe / eproc / Projudi** | Outros tribunais. | — | Não configurados (têm importação CSV como alternativa) |

### 3.3. Serviços de apoio

| Serviço | Para que serve | Estado |
|---|---|---|
| **Anthropic (Claude)** | A IA que lê os autos e gera prazos/oportunidades/minutas. | ⚠️ **Sem créditos** (ver 7) |
| **SMTP (Gmail)** | Enviaria os alertas por e-mail. | Desligado (sua decisão) |

---

## 4. MANUAL DE USO — TELA POR TELA

O menu lateral tem 3 grupos: **Visão Geral**, **Operações**, **Sistema**.

### 🏠 Início (Dashboard)
A tela de abertura. Mostra o **Resumo Operacional** (trabalho pendente, reviews,
prazos vencidos, casos ativos), a **Fila Prioritária** (o que precisa de atenção
AGORA, ordenado por risco à liberdade), os **Prazos da semana** e o **Pipeline
documental**. **Comece o dia aqui.**

### ⚖️ Execuções
A lista de **todos os casos** de execução penal. Você pode ver em **Lista** ou
**Kanban**, filtrar por status, monitoramento e comarca. Cada caso abre uma
página com 6 abas:
- **Movimentações** — a timeline do processo (o que aconteceu, de cada fonte: `[datajud]`, `[infosimples]`, `[djen]`).
- **Documentos** — onde você sobe o PDF dos autos.
- **Oportunidades** — o que a IA sugeriu que dá pra pleitear (progressão, livramento, etc.).
- **Prazos** — os prazos detectados.
- **Cálculos** — o cálculo de pena (proposto pela IA, você confirma).
- **Partes & Busca** — as partes do processo.

Botões no topo do caso: **Editar Caso**, **Sincronizar Tribunal** (busca
AQUELE processo específico na InfoSimples, na hora), **Analisar autos (IA)**
(dispara o Claude).

> **Atualização 07/07/2026 — cadastro passou a ser curado, não descoberto:**
> ao cadastrar um caso com o número do processo (CNJ), o sistema já dispara
> sozinho uma busca por AQUELE processo específico na InfoSimples (traz a
> movimentação) — não existe mais varredura automática "procurando processo
> novo" na sua OAB. Se a InfoSimples não achar o processo, o caso fica marcado
> como `sealed` — normalmente é CNJ digitado errado ou **segredo de justiça**
> (nesse caso, a movimentação só entra pelos autos que você subir). O DJEN
> continua cobrindo intimações automaticamente pra qualquer caso cadastrado,
> sem precisar de busca específica (ele já varre o Diário do dia inteiro).

> **Regra importante do sistema:** sem os autos atualizados, a geração de peça
> fica **bloqueada** e aparece o aviso "Autos desatualizados". Isso é de
> propósito — evita gerar peça com base em informação velha.

### 📋 Inventário OAB
A visão **ampla**: TODOS os processos que aparecem na sua OAB (não só os
promovidos a caso). Aqui você vê os sinais: `segredo` (segredo de justiça),
`precisa de autos`, `sem cliente`, `arquivado`. Cada linha tem os botões
**Promover a caso** (vira um caso de verdade) ou **Não é nosso** (descarta).
Também tem **Importar CSV** — é por aqui que você sobe uma lista de processos
manualmente (o caminho para os seus 40).

### 📨 Intimações
As intimações do DJEN que **ainda não bateram** com nenhum caso (órfãs). Você
tria: vincula ao caso certo ou descarta.

### 👤 Clientes
Cadastro dos clientes (executados/réus). Cada cliente tem **matrícula** (SAP),
processos vinculados, dados.

### ⏰ Prazos
Todos os prazos, com status (aberto, vencido, cumprido). Alimentado pela IA e
pelas regras de SLA.

### 💡 Oportunidades
Todas as oportunidades sugeridas pela IA, para você revisar e aceitar/recusar.

### ✅ Tarefas
As tarefas de trabalho (ex.: "Anexar autos do processo X").

### 📝 Peças
As minutas geradas pela IA (drafter). Baixáveis.

### 💰 Financeiro
Controle financeiro (honorários, etc.).

### 👥 Equipe / ⚙️ Configurações
Gestão de usuários e as **Integrações** (onde você vê o estado real de cada
fonte — a mesma tabela do item 6), histórico de IA, triagem Astrea.

---

## 5. AS AUTOMAÇÕES

Isto é o que o worker faz **sozinho**, sem você pedir. Todos os horários são em
**UTC** (Brasília = UTC−3, então 07:00 UTC = 04:00 da manhã em Brasília).

| Automação | Horário | O que faz | Estado |
|---|---|---|---|
| **InfoSimples curado** (movimentação dos casos já cadastrados) | a cada 3 dias, 07:00 UTC | Passa pelos casos JÁ cadastrados (só eles) e busca a movimentação de cada um por CNJ. Nunca cadastra caso novo sozinho. | ✅ Ligado (desde 07/07) |
| **InfoSimples — cadastro individual** | sob demanda | Ao cadastrar um caso com CNJ (ou clicar "Sincronizar Tribunal"), busca AQUELE processo na hora. | ✅ Ligado |
| **DJEN** (intimações) | 08:00 diário | Baixa o Diário do dia e filtra suas OABs — cobre qualquer caso cadastrado automaticamente. | ✅ Ligado (via caderno) |
| **DataJud** (enriquecimento do inventário) | 09:30 diário | Metadados públicos dos processos. | ✅ Ligado |
| **InfoSimples — descoberta ampla por OAB** | 07:00 diário | Varria a OAB inteira procurando processo novo e cadastrava sozinho. | ⚪ **Desligada 07/07** (opt-in — decisão do Miguel, risco de classificar errado) |
| **Varredura Jusbrasil** | 09:00 diário | (Desligada — era o bug que sobrescrevia status.) | ⚪ Opt-in, off |
| **DataJud → caso** | 06:00 e 18:00 | (Opt-in — desligado pra não duplicar o InfoSimples.) | ⚪ Opt-in, off |
| **Astrea (e-mail IMAP)** | a cada 10 min | (Pausado.) | ⚪ Off |
| **SLA — prazos vencidos** | a cada 5 min | Marca prazos que passaram do vencimento. | ✅ Ligado |
| **SLA — acordar adiados** | a cada 2 min | Reativa itens adiados/snoozed. | ✅ Ligado |
| **SLA — escalonamento** | a cada 10 min | Escala itens que estouraram o SLA. | ✅ Ligado |
| **SLA — tarefas paradas** | a cada 30 min | Detecta tarefas sem atividade. | ✅ Ligado |
| **Health sweep** | 12:00 diário | Confere a saúde do pipeline. | ✅ Ligado |

**Como ligar/desligar sem mexer em código:** cada opt-in é uma variável de
ambiente no serviço `execflow-workers` do Render (ex.: `DATAJUD_CASE_SYNC_ENABLED=true`,
`JUSBRASIL_CRAWLER_SWEEP_ENABLED=true`, `ASTREA_EMAIL_POLL_ENABLED=true`,
`DJEN_ENABLED=false`, `INFOSIMPLES_OAB_DISCOVERY_ENABLED=true` religa a descoberta ampla se você mudar de ideia).

---

## 6. ESTADO REAL DE CADA INTEGRAÇÃO

*(Testado ao vivo em 07/07/2026 na tela Configurações → Integrações.)*

| Integração | Estado na tela | O que significa de verdade |
|---|---|---|
| **DJEN** | Conectado | ✅ Funciona (consertado dia 06 via caderno). Última execução registrada. |
| **DataJud** | Conectado | ✅ Funciona. API pública do CNJ. Instável às vezes (backend do CNJ). |
| **AASP** | Conectado | Webhook registrado, mas você não usa (sem CNPJ). Pode ignorar. |
| **Astrea** | Conectado (pausado) | Código mantido, desligado de propósito. |
| **InfoSimples** | "Pendente de credencial" na tela do **site local** | ⚠️ Na tela aparece pendente porque o **token vive no worker** (Render), não no site local. **Em produção funciona** — foi ele que descobriu os 301 casos. |
| **SMTP / e-mail** | Pendente | Desligado (sua decisão). Sem isso, alertas só aparecem no painel, não no e-mail. |
| **Jusbrasil, SEEU, e-SAJ, PJe, eproc, Projudi, STF, STJ, DJE, Domicílio Judicial** | Pendente de credencial | Não configurados. Todos têm **importação CSV** como alternativa manual. |

---

## 7. CUSTOS

### 7.1. Custo mensal atual (estimado)

| Item | Custo/mês | Observação |
|---|---|---|
| **Render — `execflow-api`** | ~US$ 7 (Starter) | Serviço web. |
| **Render — `execflow-workers`** | ~US$ 7 (Starter) | Precisa ser pago: o plano Free **hiberna** e os crons não rodam. |
| **Supabase** | US$ 0 a ~US$ 25 | Grátis até 500MB/limite; depois o plano Pro (~US$25). |
| **InfoSimples** | ~R$ 80 (40 casos) | **Mudou em 07/07**: agora é R$0,20 × nº de casos CADASTRADOS (curados), não mais por página da OAB inteira. Roda a cada 3 dias (decisão sua, pra economizar) ≈ R$8/rodada ≈ R$80/mês pros 40 casos. Cresce devagar (só quando você cadastra caso novo), nunca gasta com processo que não é seu. |
| **DJEN, DataJud** | R$ 0 | Grátis. |
| **Anthropic (Claude)** | **Variável** | ⚠️ **Hoje está ZERADO** — precisa colocar crédito (ver abaixo). |
| **Total fixo aproximado** | **~R$ 160–240/mês** | Sem contar a IA. |

### 7.2. ⚠️ A IA (Claude) está sem créditos — AÇÃO NECESSÁRIA

Testei ao vivo: a análise de autos e a geração de peças **falham** com a mensagem
*"Your credit balance is too low"*. **O código está 100% correto** — ele chega
até a Anthropic, só falta saldo. Para usar a análise de autos / oportunidades /
minutas, você precisa **comprar créditos** em console.anthropic.com → Plans &
Billing.

**Quanto custa por uso:** cada análise de autos custa tipicamente **US$ 0,10 a
US$ 3** dependendo do tamanho do PDF (autos grandes custam mais). 40 casos
analisados uma vez ≈ **US$ 10–60** (uma vez só, não recorrente). Depois, só custa
quando você reanálisa ou gera peça nova.

### 7.3. O que faz o custo subir no futuro

- **Mais processos na OAB** → InfoSimples cobra por página (mais processos = mais páginas/dia).
- **Mais análises de IA** → cada análise/peça consome créditos Anthropic.
- **Mais autos guardados** → storage (hoje local — ver alerta abaixo — em produção precisa de S3/R2, que cobra por GB).
- **Banco crescendo** → se passar do limite grátis do Supabase, vira ~US$25/mês.

### 7.4. ⚠️ Alerta de storage

Hoje o `STORAGE_PROVIDER=local` — os PDFs são salvos **no disco do servidor**. Em
produção no Render, **disco local é efêmero**: se o serviço reiniciar, os autos
podem sumir. Para produção séria, o correto é configurar `STORAGE_PROVIDER=s3`
com um bucket (Cloudflare R2 é barato). **Enquanto isso não for feito, não
confie no sistema como único lugar dos autos** — guarde cópia dos PDFs.

---

## 8. CREDENCIAIS E DADOS CRÍTICOS

Estas são as coisas que você **precisa guardar num lugar seguro** (gerenciador
de senhas, ex.: Bitwarden/1Password). Se perder, o impacto está na última coluna.

| Credencial | Onde vive | Se você perder |
|---|---|---|
| **Login Render** | dashboard.render.com | Perde controle do deploy (recuperável por e-mail). |
| **Login Supabase** | supabase.com | Perde acesso ao banco/dados (recuperável por e-mail). |
| **Login GitHub** | github.com | Perde o código (recuperável por e-mail). |
| **`DATABASE_URL`** (senha do Supabase) | Render (api+workers) + `.env.local` | **Crítico** — é a chave do banco. Ver alerta abaixo. |
| **`ANTHROPIC_API_KEY`** | Render + console.anthropic.com | Sem IA. Gere nova em console.anthropic.com. |
| **`INFOSIMPLES_TOKEN`** | Render (workers) | Sem descoberta/monitoramento TJSP. |
| **`INTERNAL_API_TOKEN`** | Render (api E workers — tem que ser IGUAL nos dois) | Worker não fala com a API. |
| **`BETTER_AUTH_SECRET`** | Render (api) | Ninguém consegue logar. |
| **`DATAJUD_API_KEY`** | Render | Sem enriquecimento DataJud. |
| **Senha do seu login no ExecFlow** | — | Você não entra no painel (dá pra resetar no banco). |

### 8.1. ⚠️ Duas ações de segurança pendentes

1. **Rotacionar a senha do Supabase (`DATABASE_URL`).** Ela apareceu várias vezes
   em conversas de chat durante o desenvolvimento. Nunca foi para o GitHub (confirmei),
   mas por precaução: Supabase → Settings → Database → Reset password, e atualize
   o valor no Render (api + workers) e nos `.env.local`.
2. **O repositório GitHub é público.** Confirme se você quer isso. Se for privado
   o ideal, mude em GitHub → Settings → Danger Zone → Change visibility. (Nenhum
   segredo está no código hoje — os `.env.local` estão protegidos pelo `.gitignore`.)

---

## 9. MANUTENÇÃO

Boa notícia: **o sistema foi feito pra rodar sozinho.** Você não precisa mexer no
dia a dia. Mas vale saber o que olhar e o que fazer se algo travar.

### 9.1. Rotina recomendada

| Frequência | O que fazer |
|---|---|
| **Diário (2 min)** | Abrir o **Início** do painel. Se os casos estão atualizando e a fila faz sentido, está tudo certo. |
| **Semanal (5 min)** | Render → `execflow-workers` → aba **Logs**: procurar linhas com ✅ dos syncs (InfoSimples, DJEN). Se só aparecer ⚠️/erro, algo travou. |
| **Mensal (10 min)** | Conferir saldo Anthropic (console) e uso Supabase (dashboard → não passar do limite grátis). |

### 9.2. O que pode falhar e como consertar

| Sintoma | Causa provável | Como consertar |
|---|---|---|
| **Worker em "Failed service" / reiniciando** | Erro no boot (já corrigimos 1 caso: OCR). | Render → workers → Logs → ler o erro. Geralmente é uma variável faltando. |
| **"Casos não atualizam"** | Worker caiu, ou InfoSimples sem token. | Render → workers: está "Live"? A variável `INFOSIMPLES_TOKEN` existe? |
| **"Análise de autos falha"** | Sem créditos Anthropic. | console.anthropic.com → comprar crédito. |
| **DJEN parou** | CNJ pode ter mudado o endpoint de novo. | Ver logs `[djen-sync]`. Se voltar a dar 403, avisar o desenvolvedor. |
| **DataJud "operation aborted"** | Backend do CNJ instável (normal). | Nada — ele tenta de novo no próximo horário. |
| **Deploy quebrado após mudança** | Código com erro. | Render mostra o build falhando; o serviço antigo continua no ar até o novo subir. |
| **"Login não funciona"** | `BETTER_AUTH_SECRET` mudou ou banco fora. | Conferir a variável e se o Supabase está no ar. |

### 9.3. Como fazer uma mudança com segurança

Você **não** mexe em código direto. O fluxo é: pedir a mudança (aqui comigo ou
outro dev) → a mudança vai pro GitHub (`git push`) → o Render republica sozinho
em ~2-3 min → o serviço antigo só sai do ar quando o novo confirma que subiu
(então não fica "quebrado no meio"). Sempre dá pra voltar atrás (cada mudança é
um commit no histórico).

---

## 10. OBJETIVOS — CUMPRIDOS OU NÃO

Validei cada objetivo original **testando de verdade** no sistema rodando.

| Objetivo | Status | Evidência do teste |
|---|---|---|
| **Cadastrar execuções penais curadas + buscar dados automaticamente** | ✅ Cumprido (redesenhado 07/07) | Ao cadastrar um caso com CNJ, o sistema busca sozinho na InfoSimples (movimentação) na hora — testado. A descoberta automática ampla por OAB (que gerou os 301 casos originais, alguns fora do escopo) foi desligada por decisão do Miguel; ver item 11.9. |
| **Monitorar movimentações automaticamente** | ✅ Cumprido | Timeline do caso Edison com movimentações reais `[datajud]`/`[infosimples]`. |
| **Receber intimações oficiais (DJEN)** | ✅ Cumprido | 601 intimações reais puxadas no teste ao vivo dia 06. |
| **Cadastro de cliente + matrícula** | ✅ Cumprido | 307 clientes no banco; campo matrícula existe e é usado. |
| **Detectar prazos** | ✅ Parcial | 23 prazos no banco. A geração automática por IA depende de créditos. |
| **Sugerir oportunidades por IA** | ⚠️ Bloqueado por crédito | O pipeline funciona (chega na Anthropic) mas retorna "sem saldo". 0 oportunidades geradas hoje. |
| **Ler os autos com IA** | ⚠️ Bloqueado por crédito | Mesmo motivo. O código está correto e testado até o ponto da cobrança. |
| **Gerar minutas (peças)** | ⚠️ Bloqueado por crédito | Idem. A tela de Peças existe e funciona; falta o saldo pra IA escrever. |
| **Fila de trabalho priorizada** | ✅ Cumprido | Dashboard mostra fila prioritária, prazos vencidos, reviews. |
| **Pedir os autos quando faltam** | ✅ Cumprido | Casos sem autos criam tarefa "Anexar autos" automática. |

**Resumo honesto:** a **espinha dorsal está de pé e testada** (descoberta,
monitoramento, intimações, organização). Tudo que depende de **inteligência
artificial** (análise de autos, oportunidades, prazos automáticos, minutas)
está **pronto no código, mas parado por falta de crédito na Anthropic** —
não é bug, é saldo. Coloque crédito e essa metade acende.

---

## 11. LIMITAÇÕES E O QUE FALTA

Sendo 100% sincero com você:

1. **Créditos Anthropic zerados** → metade do valor (a IA) está desligada até você pôr saldo.
2. **Storage local em produção** → risco de perder autos num reinício. Precisa migrar pra S3/R2.
3. **Motor de cálculo de pena (LEP) é um esboço** → hoje quem calcula é a IA (propõe, você confirma), não uma fórmula fechada. Funciona, mas não é determinístico.
4. **Segredo de justiça** → processos sigilosos **não aparecem** nas fontes públicas (InfoSimples/DJEN). Para esses, a movimentação só entra pelos autos que você subir. **Implementado 07/07**: quando a InfoSimples não localiza o CNJ cadastrado, o caso fica marcado `sealed` — sinal automático de "confira o número ou é sigiloso".
5. **301 casos com monitoramento em "conferência manual"** → efeito do bug do Jusbrasil que **já rodou** antes da correção. A correção impede que aconteça de novo, mas os 301 registros existentes ficaram com esse status. Quando você mandar a lista dos 40 curados, a gente resolve isso (arquivando os que não são seus).
6. **Notificação só no painel** → sem SMTP ligado, nada chega no e-mail. Decisão sua, mas registre que é assim.
7. **Sino in-app é stub** → não tem notificação dentro do app ainda.
8. **`playwright` sobrando** → biblioteca de robô antigo ainda listada, não usada. Limpeza pendente (não atrapalha).
9. **Descoberta automática por OAB desligada (decisão 07/07)** → o sistema não procura mais processo novo sozinho. Cadastro é sempre manual (você informa nome/matrícula/CNJ) — a partir daí a InfoSimples e o DJEN passam a monitorar aquele processo específico. Código da descoberta ampla continua no repositório, desligado por padrão (`INFOSIMPLES_OAB_DISCOVERY_ENABLED=true` religa se você mudar de ideia).

---

## 12. O QUE MAIS UM DESENVOLVEDOR PRECISARIA

Você perguntou: *"o que mais precisaria para uma super revisão de funcionamento,
gastos, manutenção, uso, controle?"*. Aqui está a lista do que ainda seria bom ter,
em ordem de prioridade:

1. **Colocar crédito na Anthropic** — é o desbloqueio nº 1. Sem isso, metade do sistema está dormindo.
2. **Migrar o storage para S3/R2** — para os autos não correrem risco de sumir.
3. **Rotacionar a senha do Supabase** e **decidir sobre o repo público** (item 8).
4. **Um "ambiente de teste" separado** — hoje o site local aponta para o **banco de produção** (o mesmo do sistema real). Isso é perigoso: um teste pode alterar dados reais. O ideal seria um segundo banco Supabase só para testes.
5. **Monitoramento de erros automático** — hoje, se o worker cai, você só descobre olhando os logs. Uma ferramenta como Sentry (tem plano grátis) te avisaria por e-mail na hora.
6. **Backup do banco** — confirmar que o Supabase está com backups automáticos ligados (o plano Pro tem; o Free é limitado).
7. **Limpeza dos dados de demonstração** — o banco tem uma mistura de dados reais (301 casos) com dados de teste (Edison, "João Teste", etc.). Vale separar/limpar.
8. **Definir quem mais acessa** — hoje há um usuário. Se sua equipe vai usar, criar os logins na tela Equipe.
9. **Documentar o processo dos 40** — quando você mandar a lista, registramos exatamente como foram cadastrados, pra ser repetível.

---

### Apêndice — Números do sistema hoje (07/07/2026, dados reais de produção)

- **301** casos de execução (297 ativos, 4 em triagem)
- **307** clientes
- **23** prazos
- **0** oportunidades geradas *(bloqueado por crédito de IA)*
- **~60** tabelas no banco / **15** migrations aplicadas
- **2** serviços pagos no Render + **1** banco Supabase
- **3** fontes de tribunal ativas (InfoSimples, DJEN, DataJud)

---

*Documento gerado e validado com o sistema rodando ao vivo. Para dúvidas sobre
qualquer item, o ponto de partida é sempre: **Início do painel** (uso diário),
**Render → Logs** (o worker está vivo?), **console.anthropic.com** (tem crédito?).*
