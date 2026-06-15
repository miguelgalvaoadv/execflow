import Anthropic from '@anthropic-ai/sdk'
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
   * Generates a piece draft for a qualified opportunity.
   */
  async generateDraftForOpportunity(
    ctx: HonoContext,
    opportunityId: string,
    instructions?: string
  ) {
    if (!this.client) {
      throw new Error('ANTHROPIC_API_KEY is not configured in the environment.')
    }

    const authCtx = ctx.get('auth')
    const orgCtx = ctx.get('org')
    const organizationId = orgCtx.organization.id
    const userId = orgCtx.domainUserId

    // 1. Fetch Opportunity with full context
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

    if (oppResult.length === 0) {
      throw new Error('Opportunity not found or access denied.')
    }

    const { opportunity: opp, case: execCase, client } = oppResult[0]

    // 2. Fetch Sentence Snapshot context if applicable
    let snapshotInfo = ''
    if (opp.sentenceSnapshotId) {
      const snapResult = await db
        .select()
        .from(sentenceSnapshots)
        .where(eq(sentenceSnapshots.id, opp.sentenceSnapshotId))
      
      if (snapResult.length > 0) {
        const snap = snapResult[0]
        snapshotInfo = `\n[Contexto da Pena]\nPena Total (Dias): ${snap.totalSentenceDays}\nDias Cumpridos: ${snap.servedDays}\n`
      }
    }

    // 3. Create Draft Record in generating state
    const [draft] = await db
      .insert(pieceDrafts)
      .values({
        organizationId,
        executionCaseId: execCase.id,
        opportunityId: opp.id,
        status: 'generating',
        modelUsed: 'claude-sonnet-4-20250514',
        createdByUserId: userId,
      })
      .returning()

    // 4. Construct Prompt
    const systemPrompt = `Você é um excelente e experiente advogado criminalista brasileiro atuando estritamente na fase de Execução Penal (LEP).
Sua missão é redigir uma petição clara, direta, fundamentada e elegante para o Juízo da Execução.
REGRAS:
1. Responda APENAS com o texto Markdown da petição. Não inclua comentários fora da petição.
2. Use linguagem formal jurídica, mas objetiva. Evite o 'juridiquês' excessivo que atrapalha a leitura.
3. Não invente dados do réu. Se faltar RG, CPF ou dados, use [INSERIR DADO].
4. Fundamente seu pedido de forma incisiva usando a constituição, a LEP e jurisprudência pacificada (STF/STJ) se aplicável.`

    const userPrompt = `Por favor, elabore uma petição de Execução Penal com base na seguinte oportunidade identificada pelo nosso motor de cálculos matemáticos:

[Dados do Cliente]
Nome: ${client.name}
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

    const relevantClasses = ['sentenca', 'atestado_medico', 'laudo_disciplinar', 'atestado_penas', 'ficha_reu', 'pad', 'certidao_carceraria']
    const relevantDocs = docResults.filter((d: any) => d.documentClass && relevantClasses.includes(d.documentClass))

    const storage = createStorageProviderFromEnv()
    const contentBlocks: Anthropic.MessageParam['content'] = []

    for (const doc of relevantDocs) {
      if (doc.mimeType !== 'application/pdf') continue;
      try {
        const buffer = await storage.getObject(doc.storageKey)
        const base64 = buffer.toString('base64')
        // @ts-ignore - anthropic types might not have 'document' natively in older sdk versions
        contentBlocks.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: base64,
          }
        })
      } catch (e) {
        console.error(`[ClaudeDrafter] Failed to load doc ${doc.id} from storage`, e)
      }
    }

    contentBlocks.push({
      type: 'text',
      text: userPrompt
    })

    // 5. Call Anthropic
    try {
      const response = await this.client.messages.create({
        // @ts-ignore
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: contentBlocks }],
      })

      const generatedContent = response.content
        .filter((c) => c.type === 'text')
        .map((c) => (c as any).text)
        .join('\n')

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
      }
    } catch (err) {
      console.error('Claude API Error:', err)
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
