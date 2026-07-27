# Especificação original do sistema de reservas — Cabana Afrodite

> Documento de referência canônico. Este é o texto original enviado pelo Miguel que define
> o escopo completo do sistema de reservas. Guardado aqui (versionado no repo, não só em
> memória/contexto de conversa) para que qualquer sessão futura — minha ou de outra IA —
> possa auditar a implementação contra o pedido original sem depender de contexto de chat
> que pode ser resumido/perdido.
>
> **Ver `SPEC-COMPLIANCE-CHECKLIST.md`** para o status item-a-item (feito / parcial / pendente)
> com referência aos arquivos que implementam cada requisito.

---

## 1. Modo de execução autônoma obrigatório

Execute integralmente este trabalho no projeto atual. Apresente inicialmente um diagnóstico
técnico breve (framework, linguagem, build, rotas, bibliotecas, publicação, backend,
arquivos alterados, dependências, riscos, arquitetura recomendada) e então inicie
imediatamente a implementação, sem parar em planejamento/checklist/dúvidas não impeditivas.
Continue até que todas as funcionalidades possíveis sem credenciais reais estejam
implementadas, testadas e documentadas. Durante o desenvolvimento, use credenciais de teste,
mocks, adaptadores, variáveis vazias, placeholders, sandbox. Quando depender de credencial
real, implemente antes: interface, tipos, contratos, serviços, adaptadores, mocks,
validações, tratamento de erros, testes, documentação, variáveis de ambiente. Modos `mock`,
`sandbox`, `production` configuráveis.

## 2. Objetivo

Transformar a landing em site funcional de reservas com: calendário de disponibilidade,
sincronização iCal com o Airbnb (importar), exportação de `.ics`, solicitação de reserva,
cálculo de valores, aprovação administrativa, pagamento Mercado Pago Checkout Pro,
confirmação por webhook, banco de dados, painel administrativo, bloqueios manuais, preços
editáveis, mensagens, página de acompanhamento, histórico de status, relatórios/CSV.

## 3. Decisões já definidas

Sincronização iCal só de indisponibilidade (sem preço); preços iniciais copiados
manualmente do Airbnb e editáveis no painel; banco próprio; cálculo no backend; Checkout Pro
hospedado pelo MP, sem dados de cartão no site; preços site/Airbnb podem divergir; pagamento
só após aprovação; admin confere disponibilidade antes de aprovar; reserva confirmada entra
no `.ics`; Airbnb pode demorar a importar — painel deve avisar o admin a bloquear manualmente;
credenciais reais só depois do sistema funcionar em teste.

## 4. Pesquisa e documentação oficial

Priorizar plugin/MCP oficial do Mercado Pago, depois docs oficiais, depois SDK oficial.
Não usar tutoriais não oficiais quando existir doc oficial. iCal do Airbnb: só documentação
oficial de import/export; nunca scraping, login automatizado, extração de preço da página
pública, ou tratar o iCal como sincronização de preço.

## 5. Referências visuais

Preservar 100% a identidade visual da landing. Não copiar código/textos/imagens/marca de
outros sites — só usar como referência de padrão de usabilidade (seleção de datas,
calendário, hóspedes, resumo de preço, formulário, acompanhamento, pagamento, confirmação).

## 6. Arquitetura

Identificar a arquitetura atual e adaptar (não forçar outra). Se Netlify: Netlify Functions,
env vars do Netlify, scheduled functions. Supabase preferencial para Postgres, auth do admin,
reservas, hóspedes, preços, períodos especiais, bloqueios, histórico, pagamentos, logs de
sync, configurações. Não introduzir dois bancos sem necessidade. Documentar decisões.

## 7. Fluxo obrigatório da reserva (32 passos)

Check-in → check-out → hóspedes → backend verifica disponibilidade (reservas próprias +
bloqueios manuais + iCal Airbnb) → detecta conflito → calcula preço → hóspede vê
detalhamento → informa dados → aceita regras/cancelamento/privacidade → envia →
`pending_approval` → admin notificado → admin reconfirma disponibilidade → aprova/recusa →
aprovada vira `awaiting_payment` → cria preferência MP → hóspede recebe link → paga no MP →
MP envia webhook → backend valida assinatura → consulta pagamento na API → compara valor →
compara referência → verifica idempotência → `paid` → `confirmed` → entra no `.ics` → admin
avisado para bloquear no Airbnb → hóspede recebe confirmação. **Nunca confirmar só pela URL
de retorno do navegador.**

## 8. Estados da reserva

`pending_approval, rejected, awaiting_payment, payment_pending, paid, confirmed, cancelled,
refunded, expired, completed`. Histórico de toda mudança: status anterior, novo, data/hora,
origem, admin (se aplicável), evento externo (se aplicável), observação, id técnico. Sem
alterações silenciosas.

## 9. Disponibilidade e sobreposição

Intervalo semiaberto `[check_in, check_out)`. Check-out pode ser check-in de outra (salvo
buffer de preparação). Impedir sobreposição no frontend, backend E banco (constraint/função
atômica). Fuso `America/Sao_Paulo`, cuidado com UTC/horário de verão/conversões.

## 10. Integração iCal do Airbnb

Serviço exclusivo no backend para `AIRBNB_ICAL_URL` (nunca exposto no frontend). Parse do
`.ics` → períodos indisponíveis. Cache curto, atualização periódica quando a plataforma
permitir, atualização manual pelo painel, timeout, retentativas controladas, sem chamadas
excessivas, log da última sincronização (data/hora, sucesso/erro, eventos encontrados,
períodos importados, duração, mensagem de erro, origem, última bem-sucedida). `.ics` de
teste cobrindo: reserva comum, bloqueio manual, checkout=checkin mesmo dia, períodos
consecutivos, evento cancelado, evento sem horário, evento dia inteiro, fuso diferente,
calendário vazio, duplicados, alterados.

## 11. Calendário `.ics` exportado pelo site

Rota pública tipo `/api/calendar/reservations-{ICAL_EXPORT_TOKEN}.ics`. Só: id técnico,
datas, indisponibilidade genérica, timestamp, UID estável. **Nunca**: nome, CPF, e-mail,
telefone, observações, valor, pagamento, endereço. Só reservas confirmadas/pagas e bloqueios
manuais ativos — nunca pendentes/recusadas/expiradas/canceladas/reembolsadas. Token longo
imprevisível, regenerável pelo admin.

## 12. Sistema de preços

Configurável pelo painel: diária padrão, por dia da semana, períodos especiais, feriados,
datas específicas, taxa de limpeza, taxa por hóspede extra, hóspedes incluídos, máximo de
hóspedes, mínimo/máximo de noites, descontos (percentual, por noites, por período), valor
mínimo, caução, sinal ou integral, buffer de preparação, prazo de pagamento, parcelamento.
Valores DEMO claramente identificados, nunca inventar dados reais do cliente. Tudo editável
sem mexer em código. Cálculo definitivo sempre no backend, recalculado antes de: solicitar,
aprovar, criar preferência, confirmar pagamento. Dinheiro em centavos (inteiros), nunca
float. Detalhamento completo exibido ao hóspede.

## 13. Dados do hóspede

Só o necessário; obrigatoriedade configurável. Campos possíveis: nome, e-mail, telefone,
CPF (só quando necessário), adultos, crianças, observações, aceites (regras, cancelamento,
privacidade). CPF não obrigatório por padrão. Validar/sanitizar no backend. Sem dados
pessoais completos em logs ou URLs públicas. LGPD: minimização, finalidade, controle de
acesso, exclusão/anonimização, retenção limitada, registro do aceite.

## 14. Mercado Pago Checkout Pro

Hospedado pelo MP, sem checkout transparente, sem campo de cartão no site, sem dados de
cartão armazenados. SDK oficial. Variáveis: `MERCADO_PAGO_ACCESS_TOKEN`,
`MERCADO_PAGO_PUBLIC_KEY` (só se necessário), `MERCADO_PAGO_WEBHOOK_SECRET`, `SITE_URL`.
Preferência só após aprovação. `external_reference` único/imprevisível. URLs separadas para
aprovado/pendente/recusado/cancelado. Webhook em `/api/webhooks/mercadopago`. Validar
assinatura conforme doc oficial atual (não presumir formato antigo). Após webhook: validar
assinatura → extrair ids → consultar API → conferir id/status/valor/moeda/referência/
ambiente/idempotência → registrar evento → atualizar reserva idempotentemente. Só confirma
se: aprovado, valor certo, moeda certa, referência bate, resposta é da API oficial, evento
não processado, reserva ainda confirmável, sem novo conflito de disponibilidade. Idempotência
contra duplicidade de reserva/pagamento/webhook/status/mensagem.

## 15. Expiração do pagamento

Prazo configurável. Reserva aprovada não paga no prazo: `expired`, libera datas, invalida
preferência quando possível, impede pagamento por valor antigo, avisa hóspede e admin,
registra no histórico. Pagamento aprovado após expiração: não confirma automaticamente sem
reverificar disponibilidade, sinaliza para análise administrativa, registra o evento, não
perde o registro financeiro, oferece fluxo de reembolso/tratamento manual.

## 16. Cancelamentos e reembolsos

Estrutura para: solicitação de cancelamento, cancelamento administrativo, política aplicada,
valor pago/reembolsável/retido, id do reembolso, status, data, observações. Sem reembolso
automático real em testes — mocks prontos, mas reembolso real exige confirmação
administrativa explícita.

## 17. Painel administrativo

Área autenticada. Admin deve conseguir: ver calendário mensal, listar reservas, pesquisar
por hóspede, filtrar por status, abrir detalhes, aprovar, recusar, cancelar, marcar
concluída, consultar histórico, bloquear/remover bloqueios manuais, configurar preços/taxas/
hóspedes incluídos/limite/mínimo de noites/datas especiais/descontos/caução/sinal-ou-
integral/prazo de pagamento/parcelamento, consultar pagamentos, copiar link do `.ics`,
regenerar o token do `.ics`, forçar sync do Airbnb, ver última sincronização e erros,
reenviar link de pagamento, exportar CSV, consultar logs administrativos. Alteração manual
para `paid` sempre registrada (usuário, data, motivo, valor, observação, origem manual) —
nunca silenciosa.

## 18. Interface pública

Preservar design. Seção de reserva com a mesma identidade: seletor de entrada/saída,
calendário responsivo com indisponíveis marcadas, adultos/crianças, resumo e detalhamento de
preço, formulário do hóspede, aceites, mensagens de erro amigáveis, estados de carregamento,
confirmação, página de acompanhamento, botão de pagamento pós-aprovação, mensagens por
status. Funcionar em celular/tablet/desktop. Acessibilidade: labels, navegação por teclado,
foco visível, contraste, erros associados aos campos, ARIA, calendário sem mouse, estados
claros nos botões.

## 19. Página de acompanhamento

Token público imprevisível, nunca o ID interno sequencial. Mostra: código, datas, hóspedes,
valores, status, prazo de pagamento, botão de pagar, confirmação, mensagens administrativas,
orientação de cancelamento. Sem dados sensíveis além do necessário.

## 20. Mensagens

Modelos para: solicitação recebida/aprovada/recusada, link de pagamento, lembrete de
pagamento, pagamento pendente/confirmado, reserva confirmada/cancelada, solicitação
expirada, reembolso, lembrete de check-in, instruções da hospedagem. Serviço de e-mail via
variável de ambiente; camada abstrata com provedor de desenvolvimento (log local) e mocks
até haver credencial real. Nunca travar a implementação por falta de e-mail.

## 21. Segurança

Env vars, `.env.example`, `.env` no gitignore, validação/sanitização de entrada, auth
administrativa, autorização por função, proteção de rotas admin, rate limiting em rotas
públicas críticas, proteção contra abuso de formulário, cabeçalhos de segurança, HTTPS
obrigatório em produção, proteção CSRF quando aplicável, CORS restritivo, logs sem dados
pessoais sensíveis, tratamento seguro de erro, validação de webhook, idempotência, proteção
contra alteração de preço pelo navegador, proteção contra enumeração de reservas, tokens
imprevisíveis, expiração de token quando aplicável, controle de acesso no banco. Sem
segredos no código/frontend/Git/README/testes/logs/histórico do terminal/respostas de chat.
Sem dados completos de cartão.

## 22. Banco de dados

Migrations + documentação. Mínimo: `reservations, reservation_guests,
reservation_status_history, manual_blocks, pricing_rules, special_periods,
payment_transactions, payment_webhook_events, ical_imported_events, ical_sync_logs,
settings, admin_users, notification_logs, audit_logs`. Chaves adequadas, UUIDs, índices,
FKs, constraints, timestamps, controle de duplicidade, exclusão lógica quando cabível,
políticas do Supabase se usado. Estratégia consistente anti-sobreposição. Documentar ordem
das migrations.

## 23. Variáveis de ambiente

`.env.example` completo: `SITE_URL, APP_ENV, AIRBNB_ICAL_URL, ICAL_EXPORT_TOKEN,
MERCADO_PAGO_ACCESS_TOKEN, MERCADO_PAGO_PUBLIC_KEY, MERCADO_PAGO_WEBHOOK_SECRET,
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, EMAIL_PROVIDER,
EMAIL_API_KEY, EMAIL_FROM, RESERVATION_PAYMENT_EXPIRATION_HOURS,
TIMEZONE=America/Sao_Paulo`. Só as realmente necessárias. Validar na inicialização, com
mensagem clara (nunca erro genérico) quando faltar algo obrigatório.

## 24. Testes

Cobrir: cálculo de diária por dia da semana/fim de semana/datas especiais/feriados, taxa de
limpeza, hóspede extra, descontos, caução, sinal, total, sobreposição, bloqueios manuais,
período do Airbnb, checkout=checkin mesmo dia, buffer, parsing do iCal (cancelado,
duplicado, vazio), geração do `.ics` (e proteção de dados), webhook válido/inválido/
assinatura inválida/repetido, pagamento com valor/referência diferente, pendente, aprovado,
atrasado, reserva expirada, cancelamento, reembolso simulado, acesso ao painel sem login,
tentativa de alterar preço pelo frontend, tentativa de confirmar sobreposta, idempotência.
Só credenciais de teste; nunca pagamento real sem etapa manual explícita.

## 25. Qualidade e validação

Após cada conjunto lógico: rodar projeto, lint, typecheck, testes relevantes, build, corrigir
antes de avançar. Confirmar que instala/roda/compila/testa/builda para produção nos marcos
importantes.

## 26. Ordem obrigatória

Inspecionar → identificar stack → rodar o atual → conferir a landing → ponto de recuperação →
definir arquitetura → banco/migrations → preços → disponibilidade → bloqueios → calendário
público → parser iCal → `.ics` de teste → geração do `.ics` do site → solicitação →
acompanhamento → painel admin → aprovação/recusa → MP sandbox → preferências → webhook →
confirmação → expiração → cancelamento → reembolso → mensagens → segurança/rate limiting →
testes → lint → typecheck → testes → build → corrigir tudo → documentação → só então
apresentar o que depende do cliente. Sem parar para confirmação entre etapas.

## 27. Informações do cliente

Não inventar valores/regras/dados comerciais reais — configurações provisórias claramente
identificadas (preços, taxas, hóspedes, mínimo de noites, descontos, caução, sinal,
parcelamento, prazo, política de cancelamento, horários, e-mails, telefone, regras), todas
editáveis no painel sem mexer em código.

## 28. Momento de solicitar dados reais

Só depois que: projeto compila, banco estruturado, migrations prontas, painel admin pronto,
solicitação funciona com dados simulados, iCal funciona com arquivo de teste, `.ics` do site
funciona, Checkout Pro funciona em sandbox, webhook testado, testes executados, build de
produção concluído. Então apresentar `DADOS NECESSÁRIOS PARA COLOCAR EM PRODUÇÃO` separada
em: dados que o cliente pode enviar; autorizações que exigem login pessoal do cliente;
segredos que não devem ir por mensagem (nome da variável, painel onde inserir, quem insere,
pública ou secreta, como revogar); onde inserir cada informação (hospedagem, Supabase, MP,
Airbnb, e-mail, domínio/DNS); checklist de teste final de produção (calendário real, bloqueio,
conflito, solicitação, aprovação, checkout, cobrança real baixa, webhook, confirmação, `.ics`,
importar no Airbnb, bloqueio no Airbnb, cancelamento, reembolso).

## 29. Entregáveis finais

Resumo do implementado, diagnóstico da arquitetura final, arquivos criados/alterados,
migrations, `.env.example`, comandos (instalação/dev/lint/typecheck/testes/build),
instruções de publicação/banco/Supabase/MP/webhook/Airbnb/e-mail, checklist de produção,
dados ainda necessários do cliente, limitações conhecidas, riscos do atraso do iCal,
resultados de testes/lint/typecheck/build/auditoria MP, pontos a conferir manualmente,
instruções de manutenção futura. Não encerrar de forma genérica, não parar no planejamento,
não inventar credencial, não pedir senha pessoal, não pagar de verdade sem autorização
manual.
