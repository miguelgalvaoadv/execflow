# Deploy no Render — passo a passo (worker 24/7 + API)

Objetivo: deixar o **worker rodando o tempo todo** para que o monitoramento
automático (InfoSimples 1x/dia, DJEN 2x/dia) dispare sozinho, e resolver o
**worker antigo** ("fantasma") que roda código velho.

> Você faz tudo pelo navegador em **https://dashboard.render.com**. Não precisa
> de terminal. Onde aparecer `⟨...⟩`, troque pelo seu valor.

---

## PARTE 0 — Antes de tudo: subir o código novo para o GitHub

O Render publica a partir do seu repositório no GitHub. Todo o código novo
(InfoSimples, DJEN, dedup, filtro de execução penal, auto-arquivamento) precisa
estar lá primeiro.

**Se você usa o GitHub Desktop ou VS Code:** faça *commit* de tudo e *push* para
o branch `main`. **Se quiser, me peça** que eu faço o commit e push por você
(é um comando só).

Quando o código estiver no GitHub, o Render detecta e já oferece para publicar.

---

## PARTE 1 — Gerar o segredo interno (INTERNAL_API_TOKEN)

O worker conversa com a API por um endpoint interno protegido por um segredo.
Esse mesmo segredo tem que estar **nos dois serviços** (API e worker).

1. Abra https://www.random.org/strings ou simplesmente use este (já serve):
   ```
   1e27baae05ccd39d4271dddd2baf3f6ef504cfeb723eee76b9afbbe640062c5f
   ```
2. Guarde esse valor — você vai colar ele em **dois lugares** (Parte 3 e 4).

---

## PARTE 2 — Entrar no Render e achar os serviços

1. Acesse **https://dashboard.render.com** e faça login.
2. No painel, você deve ver **dois serviços**:
   - **execflow-api** (tipo *Web Service*)
   - **execflow-workers** (tipo *Background Worker*) ← este é o "fantasma"
3. Se **não** existir o `execflow-workers`, pule para a **PARTE 6** (criar do zero).

---

## PARTE 3 — Configurar a API (execflow-api)

1. Clique em **execflow-api**.
2. No menu da esquerda, clique em **Environment**.
3. Clique em **Add Environment Variable** e adicione (uma por vez):

   | Key | Value |
   |---|---|
   | `INTERNAL_API_TOKEN` | ⟨o segredo da Parte 1⟩ |
   | `DATAJUD_API_KEY` | `cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==` |
   | `AASP_WEBHOOK_ENABLED` | `false` (ligue só quando registrar na AASP) |

   *(As demais — `DATABASE_URL`, `ANTHROPIC_API_KEY`, `BETTER_AUTH_*`,
   `STORAGE_*` — já devem estar preenchidas do deploy anterior. Se não,
   me peça os valores.)*
4. Clique em **Save Changes**. O Render vai **redeployar a API sozinho**.
5. Anote a URL pública da API (aparece no topo, algo como
   `https://execflow-api.onrender.com`). Você vai precisar dela na Parte 4.

---

## PARTE 4 — Configurar o worker (execflow-workers) — o principal

1. Volte ao painel e clique em **execflow-workers**.
2. Menu da esquerda → **Environment** → **Add Environment Variable**. Adicione:

   | Key | Value | O que é |
   |---|---|---|
   | `EXECFLOW_API_URL` | ⟨URL da API da Parte 3⟩ | o worker chama a API por aqui |
   | `INTERNAL_API_TOKEN` | ⟨o MESMO segredo da Parte 1⟩ | tem que ser idêntico ao da API |
   | `INFOSIMPLES_TOKEN` | ⟨seu token InfoSimples⟩ | busca movimentação dos casos já cadastrados (por CNJ) |
   | `INFOSIMPLES_OABS` | `206292/SP` | só usado se religar a descoberta automática por OAB (opt-in, desligada por padrão desde 07/07/2026 — ver MANUAL_DO_SISTEMA.md) |
   | `DJEN_ENABLED` | `true` | intimações oficiais grátis |
   | `DJEN_OABS` | `206292/SP` | mesma OAB |
   | `DATAJUD_API_KEY` | `cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==` | enriquece o inventário |
   | `DATAJUD_CASE_SYNC_ENABLED` | `false` | mantém DataJud sem duplicar movimentação |
   | `ASTREA_EMAIL_POLL_ENABLED` | `false` | Astrea pausado |

   *(`DATABASE_URL`, `ANTHROPIC_API_KEY`, `STORAGE_*` já devem existir do deploy
   anterior — confira que estão iguais às da API.)*
3. Clique em **Save Changes**. O worker **redeploya automaticamente com o código
   novo** — e isso já **resolve o "worker fantasma"**: ao redeployar, o Render
   substitui o processo velho pelo novo. Não existem dois; é o mesmo serviço
   atualizado.

---

## PARTE 5 — Confirmar que ligou

1. Ainda em **execflow-workers**, clique em **Logs** (menu esquerdo).
2. Você deve ver, logo após o deploy, linhas como:
   ```
   [worker-registry] InfoSimples OAB sync registered (diário 07:00 UTC)
   [worker-registry] DJEN intimações sync registered (2x/dia)
   [worker-registry] DataJud case-sync NÃO agendado (opt-in; ...)
   [workers] EXECFLOW workers running
   ```
3. Se aparecer isso, **está no ar e rodando sozinho.** 🎉
   Os syncs vão disparar nos horários agendados (InfoSimples todo dia às 07:00
   UTC ≈ 04:00 Brasília; DJEN 2x/dia). Para rodar **agora** sem esperar, me
   peça que eu disparo um sync manual (ou você aguarda o próximo horário).

---

## PARTE 6 — (Só se o worker NÃO existir) Criar do zero

1. No painel do Render → **New +** (canto superior direito) → **Background Worker**.
2. **Connect a repository** → escolha o repositório do ExecFlow no GitHub.
3. Preencha:
   - **Name:** `execflow-workers`
   - **Region:** a mesma da API (ex.: Oregon)
   - **Branch:** `main`
   - **Build Command:** `pnpm install --prod=false`
   - **Start Command:** `cd packages/workers && pnpm start`
   - **Instance Type:** o menor pago (**Starter**) — worker precisa ficar
     ligado sempre; o plano *Free* **hiberna** e os crons não disparam.
4. Clique em **Create Background Worker**.
5. Depois, vá em **Environment** e adicione TODAS as variáveis da **Parte 4**.

> ⚠️ **Importante sobre plano:** background worker no plano **Free do Render
> dorme** quando fica ocioso → os crons não rodam. Para monitoramento 24/7 use
> o plano **Starter** (o mais barato pago). A API web pode ficar no Free (ela
> "acorda" no primeiro acesso), mas o worker precisa do pago.

---

## Depois do deploy — os 2 itens rápidos que dependem de você

1. **Trocar a senha do InfoSimples** (apareceu no chat). O sistema usa só o
   token; a senha não é usada, mas troque por segurança.
2. **SMTP** (para os alertas chegarem no seu e-mail): no serviço **execflow-api**
   E **execflow-workers**, adicione `SMTP_USER`, `SMTP_PASS`, `OFFICE_EMAIL`
   (use uma "senha de app" do Gmail, não a senha normal).

---

## Resumo do que cada serviço faz depois de no ar

- **execflow-api** — o site + a IA (análise de autos, minutas) + o endpoint
  interno que o worker chama.
- **execflow-workers** — roda sozinho 24/7: InfoSimples 1x/dia (monitora SÓ os
  casos já cadastrados por CNJ — cadastro é manual, curado por você; custo
  ~R$0,20 × nº de casos ativos), DJEN 1x/dia (intimações, via caderno diário),
  DataJud (enriquece inventário), OCR dos autos que você sobe, varreduras de SLA.
  Ver MANUAL_DO_SISTEMA.md para o detalhe completo e atualizado.
