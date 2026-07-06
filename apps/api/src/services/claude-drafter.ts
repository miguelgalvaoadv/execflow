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
import { eq, and } from 'drizzle-orm'
import type { HonoContext } from '../context/types.ts'
import { createStorageProviderFromEnv } from '@execflow/storage'

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

    const systemPrompt = `Você é um excelente e experiente advogado criminalista brasileiro atuando estritamente na fase de Execução Penal (LEP).
Sua missão é redigir uma petição clara, direta, fundamentada e elegante para o Juízo da Execução.
REGRAS:
1. Responda APENAS com o texto Markdown da petição. Não inclua comentários fora da petição.
2. Use linguagem formal jurídica, mas objetiva. Evite o 'juridiquês' excessivo que atrapalha a leitura.
3. Não invente dados do réu. Se faltar RG, CPF ou dados, use [INSERIR DADO].
4. Fundamente seu pedido de forma incisiva usando a constituição, a LEP e jurisprudência pacificada (STF/STJ) se aplicável.`

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
- Crie a seção "DO DIREITO" e a seção "DOS PEDIDOS".
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
   * Generates a piece draft for a qualified opportunity.
   *
   * `options.systemPrompt` / `options.userPrompt` permitem que o advogado
   * substitua o prompt completo (edição na tela). Quando ausentes, usa o padrão
   * de buildPrompts() com as `instructions` adicionais.
   */
  async generateDraftForOpportunity(
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

    const freshnessWarning =
      !execCase.documentFreshnessStatus || execCase.documentFreshnessStatus === 'unknown'
        ? 'AVISO: Nenhum autos foi carregado para este processo. A petição será gerada sem os autos, baseada apenas nos dados do caso e na oportunidade identificada. Ressalte na peça que os cálculos devem ser verificados com os autos originais.'
        : null

    // 3. Create Draft Record in generating state
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

    // 4. Prompt: usa o override completo do advogado, ou monta o padrão.
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
        max_tokens: 4096,
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

      if (!draft) {
        throw new Error('Failed to create draft record.')
      }

      // 6. Update Draft Record
      await db
        .update(pieceDrafts)
        .set({
          contentMarkdown: generatedContent,
          status: 'draft',
          updatedAt: new Date(),
        })
        .where(eq(pieceDrafts.id, draft.id))
        
      // 7. Update Opportunity to link to this draft
      await db
        .update(opportunities)
        .set({
          realizedPieceDraftId: draft.id,
          // If we want to change status to realized we can, but usually we just link it
        })
        .where(eq(opportunities.id, opp.id))

      return {
        draftId: draft.id,
        status: 'draft',
        contentMarkdown: generatedContent,
        ...(freshnessWarning ? { freshnessWarning } : {}),
      }
    } catch (err) {
      console.error('Claude API Error:', err)
      void logAiInteraction({
        organizationId,
        agent: 'draft_generator',
        model: 'claude-sonnet-4-6',
        promptText: `${systemPrompt}\n\n---\n\n${userPrompt}`,
        executionCaseId: execCase.id,
        clientId: execCase.clientId,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      })
      // Revert or mark failed (though status is already 'generating', could set to failed if we had it)
      throw new Error('Falha ao comunicar com o Claude API: ' + (err instanceof Error ? err.message : String(err)))
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
