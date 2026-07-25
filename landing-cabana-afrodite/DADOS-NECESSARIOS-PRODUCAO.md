# DADOS NECESSÁRIOS PARA COLOCAR EM PRODUÇÃO

O sistema já funciona de ponta a ponta em **modo mock** (sem credenciais). Para ir ao ar,
faltam apenas as informações e autorizações abaixo. **Nada de senha/segredo deve ser enviado
por mensagem** — veja a seção própria.

---

## 1. Dados que o cliente pode enviar (não são segredos)

Podem ser passados normalmente e cadastrados no painel administrativo:

- **Preços reais** (copiados do Airbnb): diária padrão, valores por dia da semana,
  taxa de limpeza, taxa por hóspede adicional, hóspedes incluídos, máximo de hóspedes.
- **Regras**: mínimo/máximo de noites, descontos (por noites/período), caução, sinal
  ou pagamento integral, prazo de pagamento, parcelamento.
- **Períodos especiais/feriados** com tarifa própria.
- **Horários** de check-in e check-out.
- **Políticas**: cancelamento, regras da casa, privacidade.
- **Contato**: e-mail e telefone/WhatsApp oficiais.
- **Link iCal de exportação do Airbnb** (o endereço "Exportar calendário" — não é senha).

> ⚠️ Hoje há valores **DEMO** em `supabase/migrations/0003_seed_demo.sql` e
> `src/config/settings.ts`. Substituir pelos reais pelo painel (sem mexer no código).

---

## 2. Autorizações que o cliente deve fazer pessoalmente (exigem login dele)

1. **Mercado Pago** — acessar [Mercado Pago Developers](https://www.mercadopago.com.br/developers) logado:
   - criar/selecionar a aplicação (Checkout Pro);
   - ativar as **credenciais de produção**;
   - cadastrar o **webhook**: `https://SEU-DOMINIO/api/webhooks/mercadopago` (evento *payments*);
   - gerar a **assinatura secreta** do webhook.
2. **Airbnb** — logado no painel do anfitrião:
   - copiar o link **"Exportar calendário"** (iCal) do anúncio;
   - **importar** no Airbnb o calendário gerado pelo site
     (`https://SEU-DOMINIO/api/calendar/reservations-<TOKEN>.ics`), em "Importar calendário".
3. **Supabase** — criar o projeto e aplicar as migrations (`0001`, `0002`, `0003`).
4. **Serviço de e-mail** (Resend/SendGrid) — criar conta e gerar a API key.
5. **Netlify** — conectar o repositório/pasta e configurar as variáveis de ambiente.

---

## 3. Segredos que NÃO devem ser enviados por mensagem

Inserir **diretamente** no painel de variáveis de ambiente do Netlify
(Site settings → Environment variables). Cada um:

| Variável | Pública/Secreta | Quem insere | Como revogar |
|---|---|---|---|
| `MERCADO_PAGO_ACCESS_TOKEN` | **Secreta** | cliente/dev no Netlify | regenerar no MP Developers |
| `MERCADO_PAGO_PUBLIC_KEY` | Pública | dev | regenerar no MP |
| `MERCADO_PAGO_WEBHOOK_SECRET` | **Secreta** | cliente/dev | regenerar no MP |
| `SUPABASE_URL` | Pública | dev | — |
| `SUPABASE_ANON_KEY` | Pública | dev | rotacionar no Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secreta** | dev | rotacionar no Supabase |
| `ICAL_EXPORT_TOKEN` | **Secreta** | dev | regenerar (painel) e reimportar no Airbnb |
| `ADMIN_PASSWORD_HASH` | **Secreta** (hash) | dev | gerar novo hash |
| `ADMIN_SESSION_SECRET` | **Secreta** | dev | trocar (desloga sessões) |
| `EMAIL_API_KEY` | **Secreta** | dev | rotacionar no provedor |
| `AIRBNB_ICAL_URL` | **Secreta** (link privado) | dev | regenerar no Airbnb |

> Nunca colar esses valores em chat, README, testes, logs ou no Git.

---

## 4. Onde inserir cada informação

- **Netlify** (Site settings → Environment variables): todas as variáveis acima + `SITE_URL`,
  `APP_ENV=production`, `TIMEZONE=America/Sao_Paulo`, `RESERVATION_PAYMENT_EXPIRATION_HOURS`.
- **Supabase** (SQL Editor): rodar `0001` → `0002` → `0003`. Copiar URL, anon key e service role key.
- **Mercado Pago Developers**: credenciais de produção + cadastro do webhook + assinatura.
- **Airbnb** (anúncio → Disponibilidade → Sincronizar calendários): importar o `.ics` do site;
  copiar o link de exportação para `AIRBNB_ICAL_URL`.
- **Provedor de e-mail**: gerar API key → `EMAIL_API_KEY`, definir `EMAIL_FROM` e `EMAIL_PROVIDER`.
- **Domínio/DNS** (se aplicável): apontar o domínio no Netlify e ajustar `SITE_URL`.

Depois de configurar, mude `APP_ENV` para `sandbox` (testes com credenciais de teste) e,
por fim, `production`.

---

## 5. Checklist do teste final de produção

- [ ] Aplicar migrations no Supabase e cadastrar preços reais no painel.
- [ ] `APP_ENV=sandbox`: rodar todo o fluxo com credenciais de TESTE do MP.
- [ ] Testar sincronização do **calendário real do Airbnb** (`/api/admin/ical-sync`).
- [ ] Criar um **bloqueio manual** e confirmar que bloqueia no site.
- [ ] Testar **conflito de datas** (tentar reservar período ocupado).
- [ ] Criar uma **solicitação** pelo site.
- [ ] **Aprovar** no painel (após checar disponibilidade).
- [ ] Gerar o **checkout** e concluir o pagamento no ambiente MP.
- [ ] Confirmar o **webhook** (reserva vira `confirmed`).
- [ ] Verificar o **.ics** do site já com o período novo.
- [ ] **Importar o .ics no Airbnb** e confirmar o bloqueio lá.
- [ ] `APP_ENV=production`: repetir com **cobrança real de valor baixo**.
- [ ] Testar **cancelamento** e o fluxo de **reembolso** (com confirmação administrativa).
- [ ] Conferir e-mails transacionais chegando.

> Lembrete operacional: o Airbnb pode demorar para reimportar o `.ics`. Após cada pagamento
> confirmado, o painel avisa o admin para **bloquear/atualizar imediatamente** a data no Airbnb.
