# Guia de Ativação — Jusbrasil (motor único de tribunais)

Este guia é o **passo a passo completo** para colocar o ExecFlow puxando seus
processos de verdade pela API do Jusbrasil: onde pegar as credenciais, o que
configurar no Render e como o webhook funciona.

> Depois de configurado, o fluxo é automático: você cadastra o cliente
> (nome + nº do processo CNJ + matrícula) → o Jusbrasil busca capa, partes e
> movimentações → os autos em PDF entram em Documentos (quando disponíveis) →
> o Claude analisa e detecta oportunidades → você clica em "Gerar peça" e baixa
> em Word. Novas movimentações chegam pelo webhook automaticamente.

---

## 1. Obter o Token da API Jusbrasil

1. Contate o suporte do Jusbrasil: **suportesolucoes@jusbrasil.com.br**
   - Informe que é advogado (OAB) e quer acesso à **API de Consulta de Processos
     com monitoramento via webhook**.
   - Pergunte também sobre o plano jurídico (o menor começa em ~R$ 1.000/mês
     para monitorar até 2.000 processos ativos com atualizações diárias).
2. Após assinar o contrato/plano, o Jusbrasil envia o **token UUID**:
   ```
   Exemplo: 0bb5e3a5-cd56-46c1-8552-061839f07aaa
   ```
   Esse é o seu `JUSBRASIL_API_KEY`.
3. Confirme com o suporte:
   - Qual a **URL base da API** que eles provisionaram para você
     (`https://api.jusbrasil.com.br` ou `https://op.digesto.com.br/api`).
   - Qual o **endpoint de consulta por CNJ** e o **endpoint de monitoramento**.
   - Se há suporte a **processos em segredo de justiça** (exige negociação
     separada — não usa certificado digital como o Escavador, é um nível de acesso
     no contrato).
   - Como configurar o **webhook de callback** (URL de retorno para movimentações).

> Guarde o token num lugar seguro. **Nunca** coloque no código — só nas variáveis
> de ambiente (passo 4).

---

## 2. Verificar e ajustar os endpoints (importante)

O cliente Jusbrasil do ExecFlow está em:
```
packages/workers/src/integrations/jusbrasil-client.ts
```

Os endpoints estão centralizados em `JUSBRASIL_PATHS` no topo do arquivo.
**Confirme com o suporte Jusbrasil** se os caminhos estão corretos para a sua
conta e ajuste se necessário:

```typescript
const JUSBRASIL_PATHS = {
  processByCnj: (cnj) => `/processos?numero_cnj=${encodeURIComponent(cnj)}`,
  processMovements: (cnj) => `/processos/${encodeURIComponent(cnj)}/movimentacoes`,
  monitoring: '/monitoramentos',
  monitoringById: (id) => `/monitoramentos/${id}`,
}
```

Se o suporte indicar um caminho diferente (ex.: `/consulta_de_processos_por_cnj`),
basta editar aquele arquivo — o resto do sistema se adapta automaticamente.

A URL base também pode ser sobrescrita via variável de ambiente:
```
JUSBRASIL_API_URL=https://op.digesto.com.br/api
```

---

## 3. Configurar o Webhook (callback de movimentações)

O ExecFlow já tem o endpoint pronto: **`POST /api/v1/webhooks/jusbrasil`**.

1. No painel/configuração do Jusbrasil, cadastre a URL de callback da sua API:
   ```
   https://SEU-DOMINIO-API.onrender.com/api/v1/webhooks/jusbrasil
   ```
   (substitua pelo domínio real do **execflow-api** no Render — passo 4).

2. Defina um **token de segurança** (uma senha forte qualquer). Você vai
   repetir esse valor na variável `JUSBRASIL_WEBHOOK_TOKEN`. O ExecFlow valida
   o header `X-Jusbrasil-Token` (ou `X-Webhook-Token`) contra esse valor.

3. O ExecFlow **cria o monitoramento automaticamente** (com essa URL de callback)
   ao cadastrar cada caso — você não precisa registrar processo por processo no
   painel Jusbrasil.

---

## 4. Render (API + Workers) — variáveis de ambiente

No dashboard do Render, em **cada** serviço, vá em **Environment** e configure:

### Serviço `execflow-api`
| Variável | Valor |
|---|---|
| `DATABASE_URL` | Supabase — **Transaction pooler (porta 6543)** |
| `ANTHROPIC_API_KEY` | sua chave da Anthropic |
| `JUSBRASIL_API_KEY` | token do passo 1 |
| `JUSBRASIL_WEBHOOK_TOKEN` | token de segurança do passo 3 |
| `JUSBRASIL_WEBHOOK_URL` | `https://SEU-DOMINIO-API/api/v1/webhooks/jusbrasil` |
| `PUBLIC_API_URL` | `https://SEU-DOMINIO-API` |
| `JUSBRASIL_API_URL` | URL base fornecida pelo Jusbrasil (se diferente do padrão) |
| `BETTER_AUTH_*`, `UPLOAD_TOKEN_SECRET` | como já estão |
| `STORAGE_S3_*` | bucket R2/S3 dos autos |
| `SMTP_USER`, `SMTP_PASS`, `OFFICE_EMAIL` | e-mail de alertas |

### Serviço `execflow-workers`
| Variável | Valor |
|---|---|
| `DATABASE_URL` | Supabase — **Session pooler (porta 5432)** |
| `ANTHROPIC_API_KEY` | sua chave da Anthropic |
| `JUSBRASIL_API_KEY` | token do passo 1 |
| `JUSBRASIL_WEBHOOK_TOKEN` | token de segurança do passo 3 |
| `JUSBRASIL_WEBHOOK_URL` | `https://SEU-DOMINIO-API/api/v1/webhooks/jusbrasil` |
| `PUBLIC_API_URL` | `https://SEU-DOMINIO-API` |
| `JUSBRASIL_API_URL` | URL base fornecida pelo Jusbrasil (se diferente do padrão) |
| `STORAGE_S3_*` | mesmo bucket da API |
| `SMTP_*`, `OFFICE_EMAIL` | e-mail de alertas |

Depois de salvar, faça **"Manual Deploy / Clear cache & deploy"** nos dois serviços.

> O `render.yaml` do repositório já lista todas essas variáveis com `sync: false`.

---

## 5. Supabase (banco)

Nada novo além do que já está configurado. Só confirme:
- **API (execflow-api):** Transaction pooler — porta **6543**.
- **Workers (execflow-workers):** Session pooler — porta **5432**.

---

## 6. Vercel (frontend, se aplicável)

O frontend só precisa de uma variável:
- `NEXT_PUBLIC_API_URL` = `https://SEU-DOMINIO-API` (execflow-api no Render).
- No Render (execflow-api), confirme que `BETTER_AUTH_TRUSTED_ORIGINS` inclui
  o domínio Vercel (ex.: `https://execflow.vercel.app`).

---

## 7. Teste de ponta a ponta

1. Cadastre um cliente com **nome + nº do processo (CNJ) + matrícula**.
2. Em segundos, o caso deve mostrar capa/partes e movimentações na timeline.
3. Se o Jusbrasil trouxer links de PDF na resposta, os autos entram em "Documentos".
4. Abra o caso e clique em **"Analisar autos (IA)"** → cálculo de pena + oportunidades.
5. Numa oportunidade, clique em **"Gerar peça"** → revise o prompt → baixe em Word.
6. Quando sair uma movimentação nova no tribunal, o Jusbrasil chama o webhook, ela
   aparece na timeline e o Claude verifica se virou oportunidade.

---

## Resumo do que depende de você

- [ ] Assinar plano e obter `JUSBRASIL_API_KEY` (passo 1)
- [ ] Confirmar URL base e endpoints com o suporte (passo 2)
- [ ] Configurar webhook + `JUSBRASIL_WEBHOOK_TOKEN` (passo 3)
- [ ] Variáveis no Render + deploy (passo 4)
- [ ] `NEXT_PUBLIC_API_URL` na Vercel (passo 6)

Nada de chave no código. Só nas variáveis de ambiente.
