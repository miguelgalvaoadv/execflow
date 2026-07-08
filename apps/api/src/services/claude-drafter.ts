import Anthropic from '@anthropic-ai/sdk'
import { logAiInteraction } from './ai-log.ts'
import { buildDocumentBlocks } from './claude-doc-blocks.ts'
import { db } from '../lib/db.ts'
import {
  opportunities,
  executionCases,
  clients,
  sentenceSnapshots,
  pieceDrafts,
  users,
  documents,
} from '@execflow/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import type { HonoContext } from '../context/types.ts'
import { createStorageProviderFromEnv } from '@execflow/storage'

/**
 * Instrução ESPECÍFICA por tipo de oportunidade — sem isso, o prompt de
 * "Redigir Peça" era 100% genérico (só interpolava `opp.opportunityType` cru,
 * ex.: "hc", sem nenhuma orientação sobre estrutura, artigo de lei, ou o que
 * uma petição daquele tipo específico precisa provar). Achado 08/07/2026,
 * pedido do Miguel: "prompts específicos e muito detalhados para cada tipo
 * de peça". Cada bloco cobre: base legal, o que a peça precisa demonstrar
 * com apoio nos autos, estrutura própria do tipo, e o erro mais comum a
 * evitar nesse tipo específico.
 */
const PIECE_TYPE_GUIDANCE: Record<string, string> = {
  progression: `TIPO: Progressão de regime (art. 112 LEP).
O QUE PROVAR: (1) cumprimento da fração exigida — calcule mostrando a conta (pena total, data-base, fração aplicável conforme a data do fato e o tipo de crime, dias já cumpridos); (2) bom comportamento carcerário (atestado de conduta); (3) ausência de falta grave não sanada no período relevante.
ESTRUTURA PRÓPRIA: após "DOS FATOS", inclua uma seção "DO CÁLCULO" mostrando a conta da fração passo a passo (não só o resultado). Se o atestado de conduta mais recente nos autos tiver mais de ~90 dias, peça sua atualização antes ou junto do pedido. Requeira expressamente a expedição de guia de execução atualizada após a progressão.
CUIDADO: cite a fração e a lei vigente NA DATA DO FATO, não a de hoje (irretroatividade, art. 5º XL CF) — Leis 15.358/2026 e 15.402/2026 mudaram as frações recentemente; se o crime foi cometido antes da vigência dessas leis, a fração é a antiga (mais branda). Desde a Lei 14.843/2024, o exame criminológico pode ser exigido — se os autos não o tiverem e a decisão do juízo costumar exigi-lo, antecipe esse ponto na petição.`,

  parole: `TIPO: Livramento condicional (art. 83 CP, arts. 131-146 LEP).
O QUE PROVAR: (1) cumprimento da fração — 1/3 (primário, bons antecedentes), 1/2 (reincidente em crime doloso), 2/3 (condenado por crime hediondo/equiparado, SALVO se reincidente específico em hediondo, caso em que é VEDADO — art. 83, V, CP c/c art. 5º Lei 8.072/90); (2) reparação do dano ou comprovação de impossibilidade de fazê-lo (art. 83, IV, CP); (3) prognóstico favorável de não voltar a delinquir.
ESTRUTURA PRÓPRIA: proponha, se os autos tiverem essa informação, comprovante de proposta de trabalho ou residência fixa (requisito prático que a maioria dos juízos cobra na prática, mesmo não sendo condição legal expressa) — se não houver essa informação nos autos, sinalize com [CONFIRMAR COM O CLIENTE] em vez de inventar. Requeira parecer da Comissão Técnica de Classificação (CTC) se ainda não constar dos autos e o juízo costumar exigi-lo.
CUIDADO: SEMPRE verifique se o réu é reincidente específico em crime hediondo antes de peticionar — nesse caso o livramento é vedado e a petição certa seria outra (ex.: progressão, ou HC se a vedação estiver sendo aplicada incorretamente).`,

  remission: `TIPO: Remição de pena (arts. 126-130 LEP).
O QUE PROVAR: dias trabalhados ou estudados, com base em atestado/certificado da unidade prisional ou instituição de ensino nos autos — cite os documentos e períodos exatos. Regra de conversão: 1 dia de pena para cada 3 dias trabalhados, ou a cada 12h de estudo (frequência em pelo menos 3 dias).
ESTRUTURA PRÓPRIA: relacione em lista os períodos e a atividade (trabalho/estudo) com a fonte documental de cada um; calcule o total de dias a remir; requeira a homologação e o desconto imediato na guia de execução, com reflexo automático nos prazos de progressão/livramento já em curso.
CUIDADO: não confundir remição por trabalho com por estudo — critérios de conversão são diferentes (3:1 vs. horas). Desde a Lei 15.402/2026 (art. 126 §9º LEP), cumprimento em regime domiciliar NÃO impede a remição — mencione isso explicitamente se o sentenciado estiver em domiciliar. Não misture dias já homologados (não peticionar de novo) com dias pendentes de reconhecimento (o pedido real).`,

  detraction: `TIPO: Detração penal (art. 42 CP).
O QUE PROVAR: período exato de prisão provisória, prisão administrativa, internação ou medida de segurança anterior que ainda não foi computado no cálculo atual — datas de início e fim, com a fonte nos autos (certidão carcerária, guia).
ESTRUTURA PRÓPRIA: aponte especificamente ONDE no cálculo homologado esse período está ausente (comparação explícita). Requeira não só a inclusão do período, mas o REFAZIMENTO de todos os benefícios cujo prazo depende da data-base (progressão, livramento, término), já que a detração conta para TODOS os fins, não só reduzir o total.
CUIDADO: detração não é só "descontar da pena total" — é anterior no tempo, afeta a DATA-BASE de todos os cálculos posteriores. Uma detração mal explicada na petição frequentemente é negada porque o juízo não entende o impacto sistêmico; deixe isso explícito.`,

  amnesty: `TIPO: Anistia — extingue o PRÓPRIO CRIME (não apenas a pena), por LEI do Congresso Nacional, atingindo uma classe de crimes.
O QUE PROVAR: existência de lei de anistia vigente que abranja especificamente o crime do sentenciado (tipo penal, período, ou outro critério que a lei estabeleça).
CUIDADO CRÍTICO: anistia é rara em execução penal individual — a maioria dos pedidos que parecem "anistia" são na verdade INDULTO (perdão da pena por decreto do Executivo, tipo "indult") ou COMUTAÇÃO (redução/troca da pena, tipo "commutation"). Se os autos não citarem uma lei de anistia específica e vigente, NÃO redija com fundamento em anistia — avise isso ao advogado explicitamente na peça com [CONFIRMAR TIPO DE CLEMÊNCIA CORRETO] em vez de inventar uma lei de anistia inexistente.`,

  indult: `TIPO: Indulto — perdão da PENA (não do crime) por decreto do Presidente da República (ex.: indulto natalino, art. 84, XII, CF; art. 187 LEP).
O QUE PROVAR: enquadramento do sentenciado nos requisitos OBJETIVOS e SUBJETIVOS do decreto específico vigente (pena remanescente máxima, tempo mínimo cumprido, ausência de falta grave num período definido pelo próprio decreto, exclusões por tipo de crime).
ESTRUTURA PRÓPRIA: cite o decreto pelo número e data EXATOS. Se os autos não trouxerem essa informação, NÃO invente o número/ano/requisitos do decreto — isso é o erro mais grave possível nesse tipo de petição, porque decretos de indulto mudam todo ano e citar o errado invalida o pedido inteiro. Escreva a petição com [CONFIRMAR DECRETO DE INDULTO VIGENTE E SEUS REQUISITOS ANTES DE PROTOCOLAR] no lugar do número do decreto, e liste os dados objetivos do sentenciado (pena remanescente, tempo cumprido, conduta) para que o advogado só precise conferir contra o decreto certo.
CUIDADO: nunca cite jurisprudência ou requisitos "típicos" de indultos anteriores como se fossem os do decreto atual — cada decreto tem seus próprios critérios.`,

  commutation: `TIPO: Comutação de pena — substituição ou redução da pena por decreto do Executivo (mesma base do indulto: art. 84, XII, CF; art. 188 LEP), mas sem extinguir a pena por completo.
O QUE PROVAR: os mesmos requisitos objetivos/subjetivos do decreto de comutação vigente aplicável ao caso.
CUIDADO: mesma regra do indulto — NÃO invente número/ano de decreto nem seus percentuais de comutação. Use [CONFIRMAR DECRETO DE COMUTAÇÃO VIGENTE] no lugar de qualquer dado que não esteja nos autos.`,

  hc: `TIPO: Habeas Corpus (art. 5º, LXVIII, CF; art. 647 CPP) — MEDIDA DE URGÊNCIA.
O QUE PROVAR: constrangimento ilegal concreto e atual à liberdade — exemplos: regressão de regime sem audiência de justificação prévia (nula, art. 118 §2º LEP); cálculo de pena manifestamente errado mantendo o sentenciado preso além do devido; excesso de prazo; fração de progressão aplicada incorretamente (lei errada, data-base errada).
ESTRUTURA PRÓPRIA: linguagem direta e objetiva, sem rodeios — abra com o fato ilegal em 1-2 frases antes de qualquer outra coisa. Se houver risco atual à liberdade (o sentenciado já deveria estar em regime mais brando ou solto), peça LIMINAR expressamente logo no início dos pedidos, destacada em negrito/maiúsculas, antes do pedido de mérito.
CUIDADO: não cite número de HC, RE ou súmula específica do STF/STJ que você não tenha certeza absoluta de que existe e diz o que você está afirmando — jurisprudência inventada em HC é gravíssimo (pode ser apontado pelo juízo e prejudicar a credibilidade do pedido real). Prefira fundamentar diretamente nos dispositivos legais (CF, CPP, LEP) e nos fatos dos autos; só cite precedente se tiver certeza do número/ementa.`,

  pad_challenge: `TIPO: Impugnação de PAD (Procedimento Administrativo Disciplinar) / falta grave.
O QUE PROVAR: nulidade processual concreta no PAD ou na consequência dele (regressão de regime, perda de dias remidos) — ausência de defesa técnica, ausência de audiência de justificação/oitiva do apenado (art. 118 §2º LEP — sem ela, regressão é nula), prazo de defesa não respeitado, cerceamento de defesa.
ESTRUTURA PRÓPRIA: aponte CADA nulidade separadamente, com o fato específico dos autos que a caracteriza (ex.: "não há nos autos registro de audiência de justificação antes da decisão de regressão de fls. X"). Requeira a anulação do PAD e, por consequência, da regressão de regime ou da perda de dias remidos dela decorrente, com restabelecimento do status anterior.
CUIDADO: sempre verifique PRIMEIRO se houve a audiência de justificação — é a nulidade mais comum e mais grave; se não houver menção a ela nos autos, essa é provavelmente a tese central da peça.`,

  prescription: `TIPO: Prescrição da pretensão executória (arts. 109-110 CP).
O QUE PROVAR: o prazo prescricional aplicável à pena (conforme a tabela do art. 109 CP) transcorreu INTEGRALMENTE, sem qualquer causa interruptiva (art. 117 CP: nova prisão, fuga, etc.) desde o marco inicial (trânsito em julgado para a acusação, ou outro marco cabível).
ESTRUTURA PRÓPRIA: monte uma linha do tempo clara e datada mostrando cada marco relevante (trânsito em julgado, eventuais interrupções, data de hoje) e o cálculo do prazo decorrido vs. o prazo prescricional da pena.
CUIDADO — erro grave e comum: verifique CUIDADOSAMENTE se não há fuga, nova prisão em outro processo, ou qualquer outro marco interruptivo no período — alegar prescrição sem checar isso pode expor o cliente a reafirmar publicamente uma tese que não se sustenta. Se os autos não permitirem confirmar a ausência de interrupção com segurança, diga isso explicitamente na peça em vez de afirmar a prescrição como certa.`,

  recalculation: `TIPO: Recálculo de pena (art. 66, III, "a", LEP — competência do juízo da execução para retificar cálculo).
O QUE PROVAR: erro CONCRETO e específico no cálculo homologado atual — não uma discordância genérica. Aponte exatamente qual dado está errado: fração aplicada, data-base, remição não computada, detração ausente, unificação de pena não realizada.
ESTRUTURA PRÓPRIA: seção comparativa "COMO ESTÁ" vs. "COMO DEVERIA ESTAR", com a conta refeita passo a passo. Cite o documento/data do cálculo homologado que contém o erro.
CUIDADO: um pedido de recálculo sem apontar o erro específico (só "peço a revisão do cálculo") costuma ser indeferido por falta de fundamentação concreta — sempre refaça a conta você mesmo na petição, mostrando o número certo.`,

  excess_execution: `TIPO: Excesso de execução (art. 185 LEP, art. 66, III, "b", LEP).
O QUE PROVAR: a pena está sendo cumprida ALÉM do que a sentença/lei determina — situação de URGÊNCIA porque envolve tempo de prisão indevido. Exemplos: fração de progressão superior à devida aplicada por engano; benefício já devido objetivamente e não concedido; pena já cumprida por completo e ainda em execução.
ESTRUTURA PRÓPRIA: comparação objetiva e numérica entre o tempo que a lei permite e o tempo que está sendo efetivamente cumprido. Se houver risco atual à liberdade, use tom de urgência equivalente ao de um HC e considere sugerir ao advogado, na peça, que avalie cumular com HC se o risco for imediato.
CUIDADO: mesma disciplina do recálculo — mostre a conta, não afirme "há excesso" sem provar com números.`,

  rights_violation: `TIPO: Violação de direitos do preso (arts. 40-43 LEP e demais direitos assegurados pela Lei 7.210/84).
O QUE PROVAR: fato CONCRETO e específico descrito nos autos que caracteriza a violação (ex.: negativa de assistência à saúde, impedimento de visita sem justificativa legal, condições degradantes documentadas) — nunca genérico.
ESTRUTURA PRÓPRIA: identifique o direito específico violado com o dispositivo legal correspondente, narre o fato com base no documento dos autos que o registra, peça a cessação imediata da violação e, se cabível pelos fatos narrados, reparação.
CUIDADO: não generalize para "condições prisionais ruins" — aponte o direito específico (saúde, visita, trabalho, educação, etc.) e o fato concreto que o violou, com a fonte nos autos.`,

  manual: `TIPO: Oportunidade criada manualmente pelo advogado (sem tipificação automática) — use as instruções gerais de estrutura de petição de execução penal (fatos, direito, pedidos) e as instruções específicas fornecidas pelo advogado no campo de instruções adicionais como guia principal.`,
}

function pieceTypeGuidance(opportunityType: string): string {
  return PIECE_TYPE_GUIDANCE[opportunityType] ?? ''
}

/**
 * Thrown by generateDraftForOpportunity() when documentFreshnessStatus === 'stale'.
 * The route handler catches this and returns HTTP 409 with structured body.
 * The frontend reads 409 to show the staleness banner (not a generic error toast).
 */
export class FreshnessGateError extends Error {
  readonly code = 'FRESHNESS_GATE_BLOCKED'
  readonly pendingCriticalMovementType: string | null
  readonly pendingCriticalMovementSince: Date | null

  constructor(movementType: string | null, movementSince: Date | null) {
    super(
      'Os autos do processo precisam ser atualizados antes de gerar uma nova peça. ' +
      'Uma movimentação crítica foi recebida após os últimos autos carregados. ' +
      'Faça upload dos autos atuais e tente novamente.'
    )
    this.pendingCriticalMovementType = movementType
    this.pendingCriticalMovementSince = movementSince
  }
}

/**
 * Claude Drafter Service
 * Generates legal petitions based on Execution Opportunities and case context.
 */
export class ClaudeDrafterService {
  private client: Anthropic | null = null;

  constructor() {
    const apiKey = process.env['ANTHROPIC_API_KEY']
    if (apiKey) {
      this.client = new Anthropic({ apiKey })
    }
  }

  /**
   * Carrega o contexto da oportunidade (oportunidade + caso + cliente + pena).
   */
  private async loadContext(ctx: HonoContext, opportunityId: string) {
    const orgCtx = ctx.get('org')
    const organizationId = orgCtx.organization.id
    const userId = orgCtx.domainUserId

    const oppResult = await db
      .select({
        opportunity: opportunities,
        case: executionCases,
        client: clients,
      })
      .from(opportunities)
      .innerJoin(executionCases, eq(opportunities.executionCaseId, executionCases.id))
      .innerJoin(clients, eq(executionCases.clientId, clients.id))
      .where(
        and(
          eq(opportunities.id, opportunityId),
          eq(opportunities.organizationId, organizationId)
        )
      )

    const firstResult = oppResult[0]
    if (!firstResult) {
      throw new Error('Opportunity not found or access denied.')
    }
    const { opportunity: opp, case: execCase, client } = firstResult

    let snapshotInfo = ''
    if (opp.sentenceSnapshotId) {
      const snapResult = await db
        .select()
        .from(sentenceSnapshots)
        .where(eq(sentenceSnapshots.id, opp.sentenceSnapshotId))
      const snap = snapResult[0]
      if (snap) {
        snapshotInfo = `\n[Contexto da Pena]\nPena Total (Dias): ${snap.totalSentenceDays}\nDias Cumpridos: ${snap.servedDays}\n`
      }
    }

    return { organizationId, userId, opp, execCase, client, snapshotInfo }
  }

  /**
   * Monta o prompt padrão (system + user) que será enviado ao Claude.
   * Centraliza o texto para que a tela possa exibi-lo e o advogado editá-lo.
   */
  buildPrompts(
    data: Awaited<ReturnType<ClaudeDrafterService['loadContext']>>,
    instructions?: string
  ): { systemPrompt: string; userPrompt: string } {
    const { opp, execCase, client, snapshotInfo } = data
    const guidance = pieceTypeGuidance(opp.opportunityType)

    const systemPrompt = `Você é um sócio especialista em Execução Penal de um escritório de ponta, com décadas de banca peticionando perante Varas de Execuções Penais. Sua missão é redigir uma petição clara, direta, tecnicamente impecável e elegante para o Juízo da Execução.

REGRAS GERAIS:
1. Responda APENAS com o texto Markdown da petição. Não inclua comentários fora da petição.
2. Use linguagem formal jurídica, mas objetiva. Evite o 'juridiquês' excessivo que atrapalha a leitura.
3. Não invente dados do réu, do processo ou do caso. Se faltar RG, CPF, data ou qualquer dado concreto, use [INSERIR DADO] em vez de supor.
4. Fundamente o pedido com os dispositivos legais corretos (CF, CP, LEP) e, se citar jurisprudência (STF/STJ), cite SOMENTE precedentes de cuja existência e conteúdo você tenha certeza — na dúvida, funde o pedido diretamente na lei e omita a citação de jurisprudência específica. Jurisprudência ou número de decreto inventado é o pior erro possível numa peça real: derruba a credibilidade do pedido inteiro.
5. Todo número, data e cálculo apresentado na peça deve vir dos dados fornecidos abaixo (resumo/fundamentação do motor, ${'`'}snapshotInfo${'`'}, instruções do advogado) — não deduza nem arredonde valores que não foram informados. Se um dado necessário para o pedido não estiver disponível, sinalize com [CONFIRMAR COM O CLIENTE/AUTOS] no lugar exato onde o dado entraria, em vez de omitir o ponto ou inventar um valor plausível.
${guidance ? `\nORIENTAÇÃO ESPECÍFICA PARA ESTE TIPO DE PEÇA (${opp.opportunityType}):\n${guidance}\n` : ''}`

    const userPrompt = `Por favor, elabore uma petição de Execução Penal com base na seguinte oportunidade identificada pelo nosso motor de cálculos matemáticos:

[Dados do Cliente]
Nome: ${client.fullName}
Número do Processo de Execução: ${execCase.executionProcessNumber}
Vara: ${execCase.courtName || '[VARA DE EXECUÇÕES PENAIS DA COMARCA DE...]'}

[Oportunidade a ser Requerida]
Tipo: ${opp.opportunityType}
Resumo do Motor: ${opp.summary}
Fundamentação do Motor: ${opp.rationale || 'Atingiu o requisito objetivo e subjetivo.'}
${snapshotInfo}

Instruções Adicionais do Advogado:
${instructions || 'Nenhuma instrução adicional.'}

Regras:
- Enderece corretamente a peça ao juízo da execução.
- Crie o cabeçalho padrão, qualificação breve e passe ao "DOS FATOS".
- Crie a seção "DO DIREITO" e a seção "DOS PEDIDOS", seguindo a estrutura própria do tipo de peça indicada nas instruções de sistema (ex.: seção de cálculo para progressão/remição/recálculo, tom de urgência com liminar para HC/excesso de execução).
- Formate a peça em Markdown limpo (use # e ## para seções, listas para pedidos).
- Finalize com "Termos em que, Pede deferimento. [Local], [Data]. Advogado."`

    return { systemPrompt, userPrompt }
  }

  /**
   * Retorna o prompt padrão (system + user) SEM chamar o Claude — para a tela
   * exibir e o advogado editar antes de gerar a peça.
   */
  async previewPrompt(ctx: HonoContext, opportunityId: string) {
    const data = await this.loadContext(ctx, opportunityId)
    return this.buildPrompts(data)
  }

  /**
   * Inicia a geração de uma peça (fase síncrona e rápida: valida, checa
   * "freshness gate", cria o registro em `generating`) e dispara a chamada
   * ao Claude EM SEGUNDO PLANO — não espera a resposta.
   *
   * Por quê: a chamada ao Claude para gerar peça lê os mesmos PDFs grandes
   * da análise de autos (buildDocumentBlocks) e pode levar 60-120s+. Segurar
   * a requisição HTTP até o fim atravessa o proxy do Next.js (rewrites), que
   * corta a conexão e devolve erro ao navegador mesmo quando o backend
   * termina com sucesso — o MESMO bug já corrigido em /analyze (achado
   * 08/07/2026). O front faz polling em GET /piece-drafts/:draftId até o
   * status sair de 'generating'.
   *
   * Também trava duplo-disparo: se já existe uma peça `generating` para essa
   * MESMA oportunidade, devolve o registro existente em vez de criar (e
   * cobrar) outra chamada ao Claude em cima da que já está rodando.
   */
  async startDraftGeneration(
    ctx: HonoContext,
    opportunityId: string,
    options: { instructions?: string; systemPrompt?: string; userPrompt?: string } = {}
  ) {
    if (!this.client) {
      throw new Error('ANTHROPIC_API_KEY is not configured in the environment.')
    }

    const data = await this.loadContext(ctx, opportunityId)
    const { organizationId, userId, opp, execCase } = data

    // ── Freshness gate: block if a critical movement arrived after last autos load
    if (execCase.documentFreshnessStatus === 'stale') {
      throw new FreshnessGateError(
        (execCase as any).pendingCriticalMovementType ?? null,
        (execCase as any).pendingCriticalMovementSince ?? null
      )
    }

    // ── Guarda contra duplo-clique / múltiplas abas gerando a mesma peça.
    const [existingDraft] = await db
      .select()
      .from(pieceDrafts)
      .where(and(eq(pieceDrafts.opportunityId, opp.id), eq(pieceDrafts.status, 'generating')))
      .orderBy(desc(pieceDrafts.createdAt))
      .limit(1)

    if (existingDraft) {
      return existingDraft
    }

    // Create Draft Record in generating state
    const [draft] = await db
      .insert(pieceDrafts)
      .values({
        organizationId,
        executionCaseId: execCase.id,
        opportunityId: opp.id,
        status: 'generating',
        modelUsed: 'claude-sonnet-4-6',
        createdByUserId: userId,
      })
      .returning()

    if (!draft) {
      throw new Error('Failed to create draft record.')
    }

    void this.runGeneration(data, draft.id, options)

    return draft
  }

  /**
   * Fase lenta (chamada ao Claude): roda em segundo plano, chamada por
   * startDraftGeneration(). Nunca lança — sempre atualiza o registro do
   * draft (sucesso ou 'failed'), pra nunca ficar preso em 'generating' pra
   * sempre (achado 08/07/2026: antes, um erro do Claude — ex. sem crédito —
   * deixava a peça travada "gerando" indefinidamente, sem status de falha).
   */
  private async runGeneration(
    data: Awaited<ReturnType<ClaudeDrafterService['loadContext']>>,
    draftId: string,
    options: { instructions?: string; systemPrompt?: string; userPrompt?: string }
  ) {
    if (!this.client) return
    const { organizationId, opp, execCase } = data

    const freshnessWarning =
      !execCase.documentFreshnessStatus || execCase.documentFreshnessStatus === 'unknown'
        ? 'AVISO: Nenhum autos foi carregado para este processo. A petição será gerada sem os autos, baseada apenas nos dados do caso e na oportunidade identificada. Ressalte na peça que os cálculos devem ser verificados com os autos originais.'
        : null

    // Prompt: usa o override completo do advogado, ou monta o padrão.
    const defaults = this.buildPrompts(data, options.instructions)
    const systemPrompt = options.systemPrompt?.trim() ? options.systemPrompt : defaults.systemPrompt
    let userPrompt = options.userPrompt?.trim() ? options.userPrompt : defaults.userPrompt
    if (freshnessWarning) {
      userPrompt = `${freshnessWarning}\n\n${userPrompt}`
    }

    // Fetch Relevant Documents for Context (RAG / Vision)
    const docResults = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.executionCaseId, execCase.id),
          eq(documents.status, 'confirmed')
        )
      )

    const relevantClasses = ['sentenca', 'acórdão', 'despacho', 'guia_de_execucao', 'atestado_medico', 'laudo_disciplinar', 'atestado_penas', 'ficha_reu', 'pad', 'certidao_carceraria', 'comprovante_trabalho_estudo', 'autos_iniciais', 'autos_integral']
    const relevantDocs = docResults.filter((d: any) => d.documentClass && relevantClasses.includes(d.documentClass))

    // Blocos com proteção de limite: PDFs grandes viram texto OCR recortado
    // (limite da API: ~100 páginas/32MB por PDF — autos reais passam disso).
    const { blocks: docBlocks, manifest } = await buildDocumentBlocks(
      relevantDocs.map((d: any) => ({
        id: d.id,
        fileName: d.fileName,
        mimeType: d.mimeType,
        byteSize: Number(d.byteSize),
        storageKey: d.storageKey,
      }))
    )
    const contentBlocks = docBlocks as unknown as Exclude<Anthropic.MessageParam['content'], string>

    contentBlocks.push({
      type: 'text',
      text: manifest.length > 0 ? `Documentos fornecidos: ${manifest.join('; ')}.\n\n${userPrompt}` : userPrompt,
    })

    // 5. Call Anthropic
    const startedAt = Date.now()
    try {
      const response = await this.client.messages.create({
        // @ts-ignore
        model: 'claude-sonnet-4-6',
        // 4096 → 8000: peças agora seguem orientação estrutural mais detalhada
        // por tipo (seções de cálculo, listas de nulidades, etc.) — precisa de
        // mais margem pra não truncar no meio da petição.
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: contentBlocks }],
      })

      const generatedContent = response.content
        .filter((c) => c.type === 'text')
        .map((c) => (c as any).text)
        .join('\n')

      void logAiInteraction({
        organizationId,
        agent: 'draft_generator',
        model: 'claude-sonnet-4-6',
        promptText: `${systemPrompt}\n\n---\n\n${userPrompt}\n\n[+ ${relevantDocs.length} documento(s) PDF anexado(s) como contexto]`,
        responseText: generatedContent,
        executionCaseId: execCase.id,
        clientId: execCase.clientId,
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
        status: 'success',
        durationMs: Date.now() - startedAt,
      })

      // Update Draft Record
      await db
        .update(pieceDrafts)
        .set({
          contentMarkdown: generatedContent,
          status: 'draft',
          updatedAt: new Date(),
        })
        .where(eq(pieceDrafts.id, draftId))

      // Update Opportunity to link to this draft
      await db
        .update(opportunities)
        .set({
          realizedPieceDraftId: draftId,
        })
        .where(eq(opportunities.id, opp.id))
    } catch (err) {
      console.error('Claude API Error:', err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      void logAiInteraction({
        organizationId,
        agent: 'draft_generator',
        model: 'claude-sonnet-4-6',
        promptText: `${systemPrompt}\n\n---\n\n${userPrompt}`,
        executionCaseId: execCase.id,
        clientId: execCase.clientId,
        status: 'error',
        errorMessage,
        durationMs: Date.now() - startedAt,
      })
      // Nunca deixa o registro preso em 'generating' — sem isso, uma falha do
      // Claude (ex.: sem crédito) fazia a peça "gerar" pra sempre na tela.
      await db
        .update(pieceDrafts)
        .set({ status: 'failed', errorMessage, updatedAt: new Date() })
        .where(eq(pieceDrafts.id, draftId))
    }
  }

  /**
   * Retrieves an existing draft.
   */
  async getDraft(ctx: HonoContext, draftId: string) {
    const orgCtx = ctx.get('org')
    const organizationId = orgCtx.organization.id
    const result = await db
      .select()
      .from(pieceDrafts)
      .where(
        and(
          eq(pieceDrafts.id, draftId),
          eq(pieceDrafts.organizationId, organizationId)
        )
      )
    
    if (result.length === 0) {
      throw new Error('Draft not found.')
    }
    
    return result[0]
  }

  /**
   * Saves manual edits to an existing draft.
   */
  async updateDraft(ctx: HonoContext, draftId: string, newMarkdown: string, finalize = false) {
    const authCtx = ctx.get('auth')
    const orgCtx = ctx.get('org')
    const organizationId = orgCtx.organization.id
    const userId = orgCtx.domainUserId
    
    const updateData: any = {
      contentMarkdown: newMarkdown,
      updatedAt: new Date(),
    }
    
    if (finalize) {
      updateData.status = 'finalized'
      updateData.finalizedAt = new Date()
      updateData.finalizedByUserId = userId
    }

    const [updated] = await db
      .update(pieceDrafts)
      .set(updateData)
      .where(
        and(
          eq(pieceDrafts.id, draftId),
          eq(pieceDrafts.organizationId, organizationId)
        )
      )
      .returning()
      
    return updated
  }
}
