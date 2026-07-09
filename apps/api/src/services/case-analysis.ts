/**
 * Análise dos autos por IA (Claude) — gera o cálculo de pena, oportunidades e
 * prazos a partir dos autos confirmados do caso, escrevendo no banco.
 *
 * Substitui (de forma pragmática) o motor LEP determinístico (stub): a IA propõe,
 * o advogado confirma. Snapshots saem como 'proposed', oportunidades como
 * 'suggested', prazos como 'open'.
 */
import Anthropic from '@anthropic-ai/sdk'
import { logAiInteraction } from './ai-log.ts'
import { buildDocumentBlocks, latestOcrText } from './claude-doc-blocks.ts'
import { buildDossieText } from './case-dossie.ts'
import { eq, and, notInArray, desc } from 'drizzle-orm'
import { db } from '../lib/db.ts'
import {
  executionCases,
  clients,
  documents,
  sentenceSnapshots,
  opportunities,
  deadlines,
} from '@execflow/db/schema'
import { createStorageProviderFromEnv } from '@execflow/storage'

const RELEVANT_CLASSES = [
  'sentenca', 'acórdão', 'despacho', 'guia_de_execucao', 'atestado_medico',
  'laudo_disciplinar', 'atestado_penas', 'ficha_reu', 'pad', 'certidao_carceraria',
  'comprovante_trabalho_estudo', 'autos_iniciais', 'autos_integral',
]
const OPP_TYPES = new Set([
  'progression', 'remission', 'detraction', 'amnesty', 'indult', 'commutation', 'hc',
  'pad_challenge', 'prescription', 'recalculation', 'excess_execution',
  'rights_violation', 'parole',
])
const DL_CLASSES = new Set(['legal', 'benefit', 'disciplinary', 'calculation', 'internal', 'recurring', 'sla'])

function parseJsonLoose(text: string): any {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1]!.trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) t = t.slice(start, end + 1)
  return JSON.parse(t)
}

export type CaseAnalysisResult = {
  snapshotId: string | null
  resumoPena: string | null
  oportunidadesCriadas: number
  prazosCriados: number
  incremental: boolean
  documentosLidos: number
}

export async function analyzeAutosForCase(
  organizationId: string,
  caseId: string,
  userId: string
): Promise<CaseAnalysisResult> {
  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada no servidor.')
  const client = new Anthropic({ apiKey })

  const rows = await db
    .select({ case: executionCases, client: clients })
    .from(executionCases)
    .innerJoin(clients, eq(executionCases.clientId, clients.id))
    .where(and(eq(executionCases.id, caseId), eq(executionCases.organizationId, organizationId)))
  const row = rows[0]
  if (!row) throw new Error('Caso não encontrado.')

  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.executionCaseId, caseId), eq(documents.status, 'confirmed')))
  const autos = docs.filter(
    (d: any) => d.documentClass && RELEVANT_CLASSES.includes(d.documentClass) && d.mimeType === 'application/pdf'
  )
  if (autos.length === 0) {
    throw new Error('Nenhum documento confirmado (autos em PDF) para analisar. Suba os autos primeiro.')
  }

  // Reanálise INCREMENTAL: se o caso já tem um dossiê de uma análise
  // anterior, e nem todos os autos atuais são novos desde então, manda só
  // os documentos NOVOS + o dossiê anterior como baseline — em vez de reler
  // TUDO de novo. Achado 08/07/2026 (pedido do Miguel): mudar um documento
  // pequeno num caso de 600 páginas forçava reler as 600 páginas de novo,
  // toda vez — desnecessário, já que o sistema já tinha essa leitura salva.
  // Só cai pro modo integral se for a primeira análise do caso, ou se TODOS
  // os autos forem novos (não há baseline útil pra reaproveitar).
  const [previousSnapshot] = await db
    .select()
    .from(sentenceSnapshots)
    .where(and(eq(sentenceSnapshots.executionCaseId, caseId), eq(sentenceSnapshots.organizationId, organizationId)))
    .orderBy(desc(sentenceSnapshots.createdAt))
    .limit(1)

  const previousDocIds = new Set(
    Array.isArray(previousSnapshot?.sourceDocumentIds) ? (previousSnapshot.sourceDocumentIds as string[]) : []
  )
  const oldAutos = autos.filter((d: any) => previousDocIds.has(d.id))
  const newAutos = autos.filter((d: any) => !previousDocIds.has(d.id))
  const hasDossie = !!previousSnapshot?.explanation
  const isIncremental = hasDossie && newAutos.length > 0 && newAutos.length < autos.length

  // "Autos atualizados" quase sempre é o PDF INTEIRO do processo baixado de
  // novo (fls. numeradas sequencialmente, só cresce) — não um arquivo
  // separado pequeno. Sem tratar isso, um novo upload da mesma classe
  // (ex.: novo "autos_integral" com mais páginas) contaria como documento
  // 100% novo e mandaria o PDF inteiro de novo, do mesmo jeito que antes.
  // Detecta: documento novo de MESMA CLASSE de um já analisado, com MAIS
  // páginas → trata como continuação, manda só as páginas que vieram
  // depois + o dossiê anterior, em vez do arquivo inteiro de novo.
  const growthBlocks: Array<Record<string, unknown>> = []
  const growthManifest: string[] = []
  const docsForFullRead: typeof newAutos = []
  if (isIncremental) {
    for (const newDoc of newAutos) {
      const predecessor = oldAutos.find((d: any) => d.documentClass === newDoc.documentClass)
      if (!predecessor) {
        docsForFullRead.push(newDoc)
        continue
      }
      const [oldOcr, newOcr] = await Promise.all([latestOcrText(predecessor.id), latestOcrText(newDoc.id)])
      if (oldOcr && newOcr && newOcr.pageCount > oldOcr.pageCount) {
        const pages = newOcr.text.split('\f')
        const newPages = pages.slice(oldOcr.pageCount)
        growthBlocks.push({
          type: 'text',
          text: `===== PÁGINAS NOVAS DE "${newDoc.fileName}" (continuação de "${predecessor.fileName}", a partir da fl. ${oldOcr.pageCount + 1} de ${newOcr.pageCount}) =====\n\n${newPages.map((p, i) => `[página ${oldOcr.pageCount + i + 1}]\n${p}`).join('\n\n')}\n\n===== FIM DAS PÁGINAS NOVAS =====`,
        })
        growthManifest.push(`${newDoc.fileName}: continuação de ${predecessor.fileName} — só as ${newPages.length} página(s) novas foram lidas`)
      } else {
        // Não deu pra confirmar que é continuação (sem OCR ainda, ou não
        // cresceu) — trata como documento novo de verdade, lê inteiro.
        docsForFullRead.push(newDoc)
      }
    }
  } else {
    docsForFullRead.push(...autos)
  }

  // Blocos com proteção de limite: PDFs ≤600 pág. vão nativos (limite real da
  // API Anthropic pra modelos de 1M de contexto); maiores vão como texto OCR
  // com triagem por relevância via Haiku (barato) — só as páginas prováveis
  // de conter sentença/cálculo/PAD/etc. chegam ao Sonnet, com cabeça+cauda
  // sempre incluídas; sem OCR → aviso explícito.
  const { blocks, manifest } = await buildDocumentBlocks(
    docsForFullRead.map((d: any) => ({
      id: d.id,
      fileName: d.fileName,
      mimeType: d.mimeType,
      byteSize: Number(d.byteSize),
      storageKey: d.storageKey,
    }))
  )
  blocks.push(...growthBlocks)
  manifest.push(...growthManifest)
  if (blocks.length === 0) {
    throw new Error(
      `Nenhum documento pôde ser incluído na análise. Detalhe: ${manifest.join(' | ') || 'autos sem conteúdo legível'}. Se o PDF for grande, aguarde o OCR processar (worker) e tente de novo.`
    )
  }
  if (isIncremental && previousSnapshot) {
    blocks.push({
      type: 'text',
      text: `${buildDossieText(previousSnapshot)}\n\n[FIM DO DOSSIÊ ANTERIOR — o que vier acima nesta mensagem é SÓ o que é NOVO desde essa análise (documentos novos inteiros, ou só as páginas novas de autos que cresceram). O restante já analisado não foi reenviado; use o dossiê acima como o que já se sabia sobre ele.]`,
    })
  }

  const system = `Você é advogado criminalista brasileiro, sócio especialista em Execução Penal (LEP) com décadas de banca — o tipo de advogado que a defensoria chama quando o cálculo do juízo parece errado e ninguém mais percebeu. Sua função aqui não é resumir os autos: é fazer a leitura técnica completa que um advogado faria antes de decidir o que peticionar, extraindo TUDO que for real e deixando de fora TUDO que não tiver base concreta nos autos.

MÉTODO DE LEITURA (siga esta ordem mentalmente antes de responder):
1. Qualificação e tipificação: nome completo, quando a informação existir; o(s) crime(s) exato(s) com artigo/lei (ex.: art. 33, caput, Lei 11.343/06; art. 2º, Lei 12.850/2013) e, CRUCIAL, a DATA DO FATO (data do crime, não a da prisão nem a da sentença) — é essa data que define qual lei/fração se aplica (ver tabela de frações abaixo). Identifique também se o crime é hediondo/equiparado, se houve violência/grave ameaça, se há resultado morte, se o réu é primário ou reincidente (e se a reincidência é específica em crime hediondo).
2. Título executivo: sentença e, se houver, acórdão — pena aplicada, regime inicial, data do trânsito em julgado (para a defesa e para a acusação podem ser datas diferentes; a que importa pra execução é o trânsito para a defesa).
3. Guia de execução e cálculo mais recente HOMOLOGADO (não um cálculo provisório/anterior superado) — esse é o cálculo "oficial" atual; qualquer cálculo anterior a ele só importa se você for apontar um erro que persiste.
4. Histórico de cumprimento: detração (prisão provisória/internação já computada?), remição (dias já homologados por trabalho/estudo — cheque se ainda há período pendente de reconhecimento), unificação de penas (há notícia de outra condenação/processo que devia ter sido somada e não foi?).
5. Disciplina: PAD(s) — resultado, se houve falta grave reconhecida, se houve a audiência de justificação (oitiva do apenado) ANTES de qualquer regressão de regime (sem ela a regressão é nula), regime disciplinar diferenciado (RDD) se houver.
6. Decisões recentes do juízo: qualquer despacho/decisão sobre cálculo, benefício, PAD, saída temporária, monitoramento eletrônico — com data de publicação (para contar prazo de recurso a partir da intimação/publicação, não de hoje).
7. Pendências explícitas nos autos: manifestações aguardando resposta, documentos faltando, exame criminológico pendente.
Se dois documentos dos autos divergirem entre si num mesmo dado (ex.: dois cálculos com pena total diferente), NÃO escolha um silenciosamente — use o mais recente/homologado como base e mencione a divergência no "resumo".

RESPONDA APENAS COM JSON VÁLIDO (sem nenhum texto fora do JSON, sem cercas markdown), no formato EXATO:
{
 "pena": {
   "penaTotalDias": number|null, "regimeAtual": string|null, "dataBase": "YYYY-MM-DD"|null, "diasRemidos": number|null, "diasCumpridosAprox": number|null,
   "resumo": string,
   "confiancaGeral": "high|medium|low",
   "crimes": [ { "tipificacao": string, "artigo": string, "lei": string, "dataFato": "YYYY-MM-DD"|null, "hediondo": boolean, "diasPena": number|null } ],
   "componentesDoCalculo": [ { "nome": string, "valor": string, "confianca": "high|medium|low", "fonte": string, "comoChegou": string } ],
   "premissasAssumidas": string[],
   "dadosFaltantes": [ { "campo": string, "impacto": "high|medium|low", "descricao": string } ],
   "baseLegal": string[]
 },
 "oportunidades": [ { "tipo": "progression|remission|parole|amnesty|indult|commutation|detraction|hc|excess_execution|prescription|pad_challenge|rights_violation|recalculation", "titulo": string, "fundamentacao": string, "evidencia": string, "prazo": string, "confianca": "high|medium|low" } ],
 "prazos": [ { "titulo": string, "classe": "legal|benefit|disciplinary|calculation", "dias": number|null, "dataLimite": "YYYY-MM-DD"|null, "descricao": string, "porque": string } ]
}

CAMPOS NOVOS DE PROFUNDIDADE — leia com atenção, é aqui que mora a diferença entre uma análise genérica (ruim) e uma análise real (o que se espera):
- "componentesDoCalculo": um item por PARCELA do cálculo (pena por crime, detração, remição, fração aplicada, dias restantes, etc.), cada um com o VALOR, a FONTE (documento/página onde está escrito) e "comoChegou" mostrando a conta feita (ex.: "8 anos = 2.920 dias; 40% de 2.920 = 1.168 dias cumpridos necessários"). Isso é o que vira a explicação "como você chegou nisso" que o advogado vê na tela — sem isso preenchido de verdade e específico deste caso, a análise é inútil.
- "crimes": um item por crime da condenação (se houver mais de um, cada um com sua própria data do fato — pode mudar a fração aplicável por crime).
- "premissasAssumidas": toda vez que você precisou assumir algo razoável na ausência de dado explícito (ex.: "assumido réu primário por ausência de menção a antecedentes"), registre aqui — não deixe isso escondido dentro do resumo.
- "dadosFaltantes": o que falta nos autos pra aumentar a confiança (ex.: atestado de conduta atualizado, certidão de trânsito em julgado).
- "baseLegal": lista dos dispositivos legais efetivamente usados no cálculo deste caso (não a lista genérica do checklist — só o que você de fato aplicou).
- "evidencia" (em cada oportunidade): a citação factual específica que sustenta o pedido — nome do documento e, se possível, a informação exata nele (data, número, trecho). PROIBIDO texto genérico do tipo "cumpriu os requisitos legais" ou "atende ao art. 112 LEP" sem dizer QUAL número/data prova isso NESTE caso. Exemplo RUIM: "O sentenciado cumpriu a fração necessária para progressão." Exemplo BOM: "Conforme guia de execução homologada em 14/11/2023 (fls. do atestado de pena), pena total de 2.920 dias, fração de 40% = 1.168 dias; réu já cumpriu 1.203 dias em 08/07/2026 — fração atingida há aproximadamente 35 dias."
- "porque" (em cada prazo): a razão ESPECÍFICA deste caso pra esse prazo existir agora (não a explicação genérica do instituto, que já está em "descricao") — ex.: "PAD nº 45/2026 julgado em 02/07/2026 sem registro de audiência de justificação nos autos; prazo conta da ciência da decisão em 05/07/2026."
Se você não tem informação suficiente pra preencher algum desses campos com especificidade real, é melhor deixar a lista vazia ou o item com "confianca": "low" do que preencher com generalidade — genérico demais é tão ruim quanto errado, porque não ajuda o advogado a agir.
DISTINÇÃO DOS TIPOS DE CLEMÊNCIA (erro comum — não confundir):
- "amnesty" = ANISTIA: extingue o próprio crime, decretada por LEI do Congresso, atinge classe de crimes — raríssima em execução penal individual. Só use se os autos citarem lei de anistia específica.
- "indult" = INDULTO: perdão da PENA (não do crime), por decreto do Executivo (ex.: indulto natalino). É o tipo de clemência mais comum de se pleitear — use este pra pedidos de indulto individual.
- "commutation" = COMUTAÇÃO: troca/redução da pena por decreto (ex.: converter parte do restante em outra modalidade). Também decorre de decreto, mas é substituição, não perdão total.
Se os autos não citarem o número/ano do decreto de indulto/comutação vigente, NÃO invente — registre a oportunidade mas diga explicitamente em "fundamentacao" que o advogado precisa confirmar o decreto vigente antes de peticionar.

REGRAS DAS OPORTUNIDADES (muito importante):
- Liste APENAS o que pode ser pleiteado AGORA (dentro do prazo) ou NO FUTURO. NÃO liste oportunidades referentes a atos já passados/perdidos.
- Em "prazo", diga SEMPRE quando cabe: "imediato — já cumpriu o requisito", ou uma data/previsão aproximada (ex.: "previsto para ~03/2027, ao atingir 2/5 da pena"). Se não der pra estimar, explique objetivamente o gatilho futuro.
- Em "fundamentacao", cite o dispositivo legal exato (artigo + lei/código) e, quando possível, o fato específico dos autos que sustenta o pedido (não genérico como "cumpriu os requisitos" — diga QUAL requisito e COMO você chegou nesse número/data).
- "confianca": "high" só quando o dado-chave (fração, data, dias) está EXPLÍCITO nos autos ou é cálculo aritmético direto sobre dados explícitos. "medium" quando envolve alguma inferência razoável (ex.: presumir data do fato pela denúncia quando a sentença não repete). "low" quando os autos são ambíguos ou incompletos nesse ponto — nunca omita a oportunidade só por baixa confiança, apenas marque como "low" e diga o que falta confirmar.

CHECKLIST DE OPORTUNIDADES — institutos da execução penal (percorra cada um; inclua só o que tiver base real nos autos, mas NÃO PULE nenhum item sem checar):
- Progressão de regime (art. 112 LEP) — fração cumprida? Ver tabela abaixo.
- Livramento condicional (art. 83 CP, art. 131 LEP) — 1/3 (primário), 1/2 (reincidente doloso), 2/3 (hediondo, se não vedado). VEDADO se reincidente específico em hediondo (art. 83, V, CP).
- Remição de pena por trabalho/estudo não computada — há atestado/certificado nos autos que ainda não entrou no cálculo?
- Remição de leitura (arts. 126 §6º e 8º LEP, remição ficta em alguns tribunais) — se os autos mencionarem atividade de leitura com relatório.
- Detração não computada — período de prisão provisória/internação/domiciliar anterior à condenação que falta abater.
- Indulto ou comutação — se decreto vigente aplicável aos requisitos do sentenciado (ver distinção acima; não inventar número de decreto).
- Unificação/soma de penas — há notícia de outra condenação (mesmo em processo diferente) que devia ter sido somada e não foi?
- Prescrição da pretensão executória (art. 109-110 CP) — decurso do prazo sem causa interruptiva (fuga, nova prisão) desde o trânsito em julgado ou outro marco.
- Excesso de execução (art. 185 LEP) — pena sendo cumprida além do que a lei/sentença permite (fração errada aplicada, benefício já devido e não concedido).
- Recálculo de pena (art. 66, III, "a", LEP) — erro concreto identificável no cálculo homologado (fração, data-base, remição ou detração ausentes).
- Habeas Corpus — qualquer ilegalidade processual com risco à liberdade: regressão sem audiência de justificação, cálculo manifestamente errado mantendo prisão além do devido, excesso de prazo.
- Impugnação de PAD / falta grave — nulidade processual (ausência de defesa técnica, ausência de oitiva do apenado, prazo de defesa não respeitado).
- Conversão para prisão domiciliar (art. 117 LEP: maior de 70 anos, doença grave, gestante/mãe de criança até 12 anos ou pessoa com deficiência, filho com deficiência) — se os autos indicarem alguma dessas condições.
- Saída temporária (art. 122 LEP) — se o regime permitir (semiaberto) e os requisitos objetivos/subjetivos estiverem presentes.
- Violação de direitos do preso (arts. 40-43 LEP) — fato concreto nos autos (assistência à saúde negada, etc.), não genérico.
Institutos sem qualquer menção ou elemento nos autos NÃO são erro de omissão — é sinal de que não se aplicam a este caso. Só marque "low" confidence ou omita se genuinamente não houver base, nunca insira pra "preencher" a lista.

TABELA DE FRAÇÕES DO ART. 112 DA LEP (progressão de regime) — USE ESTA TABELA, não confie só no que você já sabe: as Leis 15.358/2026 e 15.402/2026 mudaram os percentuais recentemente e podem estar fora do que você aprendeu em treinamento.
REGRA DE OURO — IRRETROATIVIDADE (art. 5º, XL, CF/88): use a fração vigente na DATA DO FATO (data do crime), NUNCA a fração vigente hoje nem a da data da petição. Lei penal mais gravosa não retroage. Se o crime foi cometido ANTES da vigência da lei que aumentou a fração, use a fração ANTIGA (mais branda), mesmo que o cálculo/petição seja posterior.
Frações vigentes por período (para crimes SEM outra causa de aumento específica no processo):
- Crime comum (sem violência/grave ameaça), réu primário: 1/6 (~16,67%) — inalterado desde a Lei 13.964/2019.
- Crime comum, reincidente: 20% — inalterado desde 2019.
- Crime com violência ou grave ameaça (exceto crimes contra a dignidade sexual), réu primário: 25% (Lei 15.402/2026, vigência 08/05/2026); ANTES dessa data: também 25% (já era assim desde 2019 — sem mudança aqui).
- Crime com violência ou grave ameaça, reincidente específico: 30% — inalterado desde 2019.
- Crime hediondo/equiparado SEM resultado morte, réu primário: cometido A PARTIR de 25/03/2026 (Lei 15.358/2026) → 70%. Cometido ANTES de 25/03/2026 → 40% (regra do Pacote Anticrime, Lei 13.964/2019).
- Crime hediondo/equiparado SEM resultado morte, reincidente: a partir de 25/03/2026 → 80%. Antes → 60%.
- Crime hediondo/equiparado COM resultado morte, réu primário: a partir de 25/03/2026 → 75% (VEDADO livramento condicional se também for líder de organização criminosa ultraviolenta, milícia privada, ou feminicídio). Antes → 50%.
- Crime hediondo/equiparado COM resultado morte, reincidente: a partir de 25/03/2026 → 85% (VEDADO livramento condicional). Antes → 70%.
Se os autos não deixarem claro a data exata do crime (data-base costuma ser a da prisão/flagrante, mas o crime pode ter sido cometido antes), use a data do crime narrada na denúncia/sentença — não a data-base de detração.
Livramento condicional (art. 83 CP): 1/3 da pena (primário, bons antecedentes), 1/2 (reincidente em crime doloso), 2/3 (condenado por crime hediondo/equiparado — mas VEDADO se for reincidente específico em crime hediondo, art. 83, V, CP c/c art. 5º, Lei 8.072/90).
Remição (art. 126 LEP): 1 dia de pena para cada 3 dias trabalhados, ou a cada 12h de estudo (em ao menos 3 dias). Desde a Lei 15.402/2026, regime domiciliar NÃO impede a remição.
Detração (art. 42 CP): tempo de prisão provisória/internação/prisão administrativa conta para TODOS os fins, inclusive no numerador da fração de progressão — confira se já foi computada no cálculo homologado.

CHECKLIST DE PRAZOS (percorra cada item; inclua em "prazos" só o que tiver base real nos autos — não invente data nem gatilho):
- Recurso de agravo em execução (art. 197 LEP) — 5 dias da ciência/intimação de decisão do juízo da execução.
- Embargos de declaração — 2 dias (prazo curto, não confundir com o do agravo).
- Manifestação sobre cálculo de pena / PEC (planilha de execução) — prazo de vista à defesa.
- Impugnação de excesso de execução.
- Defesa em PAD (falta grave) e prazo pra audiência de justificação.
- Audiência de justificação (oitiva do apenado, art. 118 §2º LEP) ANTES de qualquer regressão de regime por falta grave — sem essa oitiva a regressão é nula e cabe HC; se os autos mostrarem regressão sem menção a essa audiência, sinalize isso na oportunidade/prazo.
- Recurso administrativo contra decisão de PAD.
- Manifestação sobre laudo/parecer da Comissão Técnica de Classificação (CTC) ou exame criminológico, se houver.
- Exame criminológico: desde a Lei 14.843/2024, é obrigatório em determinados casos para progressão (não mais facultativo) — se os autos indicarem que a progressão está condicionada a esse exame e ele ainda não foi feito/juntado, registre como prazo/pendência.
- Regime Disciplinar Diferenciado (RDD): se os autos mencionarem inclusão ou prorrogação em RDD, há prazo de recurso próprio — ganhou relevância com o Marco Legal do Crime Organizado (2026), especialmente em casos de organização criminosa ou milícia.
- Monitoramento eletrônico: quando houver condição de monitoramento (comum em saída temporária e livramento condicional), verifique prazo de vencimento/renovação do equipamento ou da autorização.
- Prazo de retorno de saída temporária (e renovação, se aplicável).
- Relatório periódico de cumprimento de condições do livramento condicional.
- Indulto natalino ou outro decreto de indulto/comutação vigente: decretos de indulto têm janela de vigência e requisitos próprios (geralmente publicados em dezembro) — se os autos mencionarem algum decreto de indulto/comutação e o réu parecer se enquadrar, registre a oportunidade e o prazo de requerimento dentro da vigência do decreto.
- Prescrição da pretensão executória (data-limite pra execução da pena, se identificável).
- Data prevista de término da pena (vencimento) — marco de monitoramento, não é bem um "prazo processual", mas deve ser registrado se calculável.
- Prazo pra requerer detração (tempo de prisão provisória a abater) quando há elemento nos autos sugerindo abatimento ainda não computado.
- Prazo pra juntar comprovante de trabalho/estudo pendente de remição.
- Prazo pra manifestação do MP sobre petição da defesa, quando essa manifestação for pré-requisito pra decisão que afeta o reeducando.
- Unificação/soma de penas — prazo pra requerer quando há notícia de nova condenação nos autos.
- Qualquer outro prazo com data ou termo inicial explícito no texto, mesmo que não se encaixe nas categorias acima.
DATA DO PRAZO — use "dias" OU "dataLimite", nunca os dois:
- "dataLimite" (YYYY-MM-DD): use quando souber ou puder calcular a data real do marco (ex.: previsão de progressão, livramento condicional, término de pena — você já calcula isso no campo "pena" e no resumo, reuse o mesmo cálculo aqui). É o caso mais comum pra prazos de benefício/cálculo.
- "dias": use SÓ para prazos processuais contados a partir de HOJE (ex.: agravo em execução = 5, embargos de declaração = 2). Nunca use "dias" pra estimar uma data que já está anos no futuro — isso conta errado.
NÃO invente dados ausentes (use null). Liste apenas oportunidades e prazos realmente cabíveis com base nos autos — a ausência de uma categoria do checklist nos autos não é erro, é sinal de que ela não se aplica a este caso.

REGRA FINAL — DISCIPLINA CONTRA ALUCINAÇÃO (a mais importante de todas):
- Todo número, data ou fração que você reportar precisa vir de um destes dois lugares: (a) está escrito literalmente nos autos, ou (b) é uma conta aritmética direta a partir de números que estão nos autos (e nesse caso o "resumo" ou "fundamentacao" deve deixar claro qual conta foi feita, ex.: "8 anos = 2.920 dias; data-base 14/11/2023; 40% de 2.920 = 1.168 dias → previsão 26/01/2027").
- Nunca preencha um campo numérico ou de data só para não deixar em branco. "null" é sempre a resposta certa quando o dado não existe ou não é calculável com segurança — um campo null é infinitamente melhor que um campo errado, porque um número errado vira uma petição errada, que pode manter alguém preso além do devido ou fazer o advogado protocolar algo sem fundamento.
- Se os autos forem insuficientes pra determinar algo central (ex.: data do fato ausente, cálculo homologado ilegível, PDF cortado), diga isso explicitamente no "resumo" — não finja completude.
- Não corrija "para melhor" nem "para pior" na dúvida — se não der pra saber se o réu é primário ou reincidente, por exemplo, não assuma nenhum dos dois; diga que a informação está ausente e que isso afeta a fração aplicável.
${isIncremental ? `
REANÁLISE INCREMENTAL: esta NÃO é a primeira análise deste caso. Você recebeu (1) o dossiê da análise anterior, no início da mensagem, e (2) só os documentos NOVOS desde então (não os autos inteiros de novo). Sua tarefa: atualizar a análise, não recomeçar do zero. Trate o dossiê anterior como verdadeiro pra tudo que os documentos novos não contradizem. Se um documento novo contradiz ou substitui algo do dossiê anterior (ex.: novo cálculo homologado substitui o antigo, nova decisão de PAD), priorize o documento novo e diga isso no "resumo". O JSON de resposta deve sair COMPLETO (não só o que mudou) — combine o que já era sabido com o que é novo.` : ''}`

  blocks.push({
    type: 'text',
    text: isIncremental
      ? `Reanálise incremental dos autos de execução penal de ${row.client.fullName} (processo ${row.case.executionProcessNumber ?? 'sem número'}).\nDocumentos NOVOS desde a última análise: ${manifest.join('; ')}.\nO dossiê da análise anterior foi incluído acima. Retorne somente o JSON atualizado e completo conforme as instruções.`
      : `Analise os autos de execução penal de ${row.client.fullName} (processo ${row.case.executionProcessNumber ?? 'sem número'}).\nDocumentos fornecidos: ${manifest.join('; ')}.\nRetorne somente o JSON conforme as instruções.`,
  })

  const startedAt = Date.now()
  let resp
  try {
    resp = await client.messages.create({
      // @ts-ignore
      model: 'claude-sonnet-4-6',
      // 10000 → 16000: o prompt agora pede o "boletim explicativo" completo
      // (componentesDoCalculo, premissas, dadosFaltantes, evidência por
      // oportunidade/prazo) — resposta bem maior que o resumo curto de antes.
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: blocks as unknown as Anthropic.MessageParam['content'] }],
    })
  } catch (err) {
    void logAiInteraction({
      organizationId,
      agent: 'sentence_calculator',
      model: 'claude-sonnet-4-6',
      promptText: system,
      executionCaseId: caseId,
      clientId: row.client.id,
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    })
    throw err
  }
  const text = resp.content.filter((c) => c.type === 'text').map((c) => (c as any).text).join('\n')

  void logAiInteraction({
    organizationId,
    agent: 'sentence_calculator',
    model: 'claude-sonnet-4-6',
    promptText: `${system}\n\n[+ ${autos.length} PDF(s) dos autos anexado(s)]`,
    responseText: text,
    executionCaseId: caseId,
    clientId: row.client.id,
    inputTokens: resp.usage?.input_tokens ?? null,
    outputTokens: resp.usage?.output_tokens ?? null,
    status: 'success',
    durationMs: Date.now() - startedAt,
  })

  let parsed: any
  try {
    parsed = parseJsonLoose(text)
  } catch {
    console.error('[case-analysis] JSON inválido. stop_reason=', (resp as any).stop_reason, 'len=', text.length)
    console.error('[case-analysis] resposta crua (início):', text.slice(0, 600))
    console.error('[case-analysis] resposta crua (fim):', text.slice(-400))
    throw new Error('A IA não retornou um JSON válido. Tente novamente.')
  }

  // 0. Supersede sugestões da IA de rodadas anteriores desta mesma análise.
  // Achado 08/07/2026: a dedup abaixo compara TÍTULO EXATO — como o Claude
  // varia a redação a cada rodada ("Progressão ao regime semiaberto" vs.
  // "Progressão de regime para semiaberto"), reanalisar o mesmo caso
  // acumulava quase-duplicatas em vez de substituir. Antes de inserir o novo
  // lote, descarta as sugestões da IA da rodada anterior que o advogado
  // ainda não tocou (oportunidades 'suggested', prazos 'open' com
  // origin='rule') — decisões humanas (qualificado, prazo reconhecido, etc.)
  // nunca são tocadas aqui.
  const supersededNote = `Substituída por nova análise dos autos em ${new Date().toLocaleDateString('pt-BR')}.`
  await db
    .update(opportunities)
    .set({
      status: 'dismissed',
      dismissedAt: new Date(),
      dismissedByUserId: userId,
      dismissedReason: supersededNote,
      updatedAt: new Date(),
    })
    .where(and(eq(opportunities.executionCaseId, caseId), eq(opportunities.status, 'suggested')))
  await db
    .update(deadlines)
    .set({
      status: 'dismissed',
      dismissedAt: new Date(),
      dismissedByUserId: userId,
      dismissedReason: supersededNote,
      dismissedReasonCode: 'superseded_by_reanalysis',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(deadlines.executionCaseId, caseId),
        eq(deadlines.status, 'open'),
        eq(deadlines.origin, 'rule')
      )
    )

  // 1. Snapshot de pena (proposto) — grava o "boletim explicativo" completo
  // (explanation/crimesBreakdown/missingDataFlags) que o schema já previa
  // (`sentence-snapshot.ts`, "This is what gets rendered in the 'Explain
  // calculation' UI") mas nunca tinha sido preenchido de verdade — achado
  // 08/07/2026: sem isso, a análise parecia genérica porque o dado detalhado
  // que o Claude podia produzir era descartado antes de chegar no banco.
  let snapshotId: string | null = null
  const pena = parsed.pena
  if (pena && (pena.penaTotalDias || pena.resumo)) {
    const total = Number(pena.penaTotalDias) || 0
    const served = Number(pena.diasCumpridosAprox) || 0
    const remission = Number(pena.diasRemidos) || 0
    const remaining = Math.max(total - served - remission, 0)
    const pct = total > 0 ? Math.min(served / total, 1).toFixed(4) : '0'
    const confianca = ['high', 'medium', 'low'].includes(pena.confiancaGeral) ? pena.confiancaGeral : 'unknown'
    const crimesBreakdown = Array.isArray(pena.crimes)
      ? pena.crimes.map((c: any) => ({
          crimeName: String(c.tipificacao ?? ''),
          article: String(c.artigo ?? ''),
          law: String(c.lei ?? ''),
          sentenceDate: c.dataFato ?? null,
          isHediondo: Boolean(c.hediondo),
          sentenceDays: c.diasPena != null ? Number(c.diasPena) : null,
        }))
      : []
    const missingDataFlags = Array.isArray(pena.dadosFaltantes)
      ? pena.dadosFaltantes.map((d: any) => ({
          field: String(d.campo ?? ''),
          impact: ['high', 'medium'].includes(d.impacto) ? d.impacto : 'medium',
          description: String(d.descricao ?? ''),
        }))
      : []
    const explanation = {
      basis: String(pena.resumo ?? ''),
      components: Array.isArray(pena.componentesDoCalculo)
        ? pena.componentesDoCalculo.map((c: any) => ({
            name: String(c.nome ?? ''),
            value: c.valor ?? null,
            confidence: ['high', 'medium', 'low'].includes(c.confianca) ? c.confianca : 'medium',
            sourceRefs: c.fonte ? [String(c.fonte)] : [],
            derivationNote: String(c.comoChegou ?? ''),
          }))
        : [],
      assumptions: Array.isArray(pena.premissasAssumidas) ? pena.premissasAssumidas.map(String) : [],
      missingData: missingDataFlags.map((m: any) => m.description).filter(Boolean),
      legalCitations: Array.isArray(pena.baseLegal) ? pena.baseLegal.map(String) : [],
    }
    const inserted = await db
      .insert(sentenceSnapshots)
      .values({
        organizationId,
        executionCaseId: caseId,
        effectiveAt: pena.dataBase ? new Date(pena.dataBase) : new Date(),
        status: 'proposed',
        totalSentenceDays: total,
        servedDays: served,
        remissionDays: remission,
        detractionDays: 0,
        remainingDays: remaining,
        percentServed: pct,
        confidenceLevel: confianca,
        calculationMethod: isIncremental
          ? 'Reanálise incremental dos autos por IA (Claude) — requer confirmação do advogado.'
          : 'Análise dos autos por IA (Claude) — requer confirmação do advogado.',
        crimesBreakdown,
        missingDataFlags,
        explanation,
        // Grava o conjunto COMPLETO de autos considerados (não só os novos
        // desta rodada) — é contra essa lista que a PRÓXIMA análise decide o
        // que já foi lido e o que é de fato novo.
        sourceDocumentIds: autos.map((d: any) => d.id),
        createdByUserId: userId,
      } as any)
      .returning({ id: sentenceSnapshots.id })
    snapshotId = inserted[0]?.id ?? null
  }

  // 2. Oportunidades (sugeridas), com dedup por título
  let oportunidadesCriadas = 0
  for (const o of parsed.oportunidades ?? []) {
    const titulo = String(o.titulo ?? 'Oportunidade').slice(0, 255)
    const existing = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.executionCaseId, caseId),
          eq(opportunities.summary, titulo),
          notInArray(opportunities.status, ['dismissed', 'expired'])
        )
      )
      .limit(1)
    if (existing.length > 0) continue
    await db.insert(opportunities).values({
      organizationId,
      executionCaseId: caseId,
      opportunityType: OPP_TYPES.has(o.tipo) ? o.tipo : 'recalculation',
      status: 'suggested',
      summary: titulo,
      rationale:
        (o.prazo ? `⏳ Prazo/previsão: ${String(o.prazo)}\n\n` : '') +
        String(o.fundamentacao ?? '') +
        (o.evidencia ? `\n\n📄 Evidência: ${String(o.evidencia)}` : ''),
      confidenceLevel: ['high', 'medium', 'low'].includes(o.confianca) ? o.confianca : 'medium',
      isBlocked: false,
    } as any)
    oportunidadesCriadas++
  }

  // 3. Prazos (abertos), com dedup por título
  let prazosCriados = 0
  for (const p of parsed.prazos ?? []) {
    const titulo = String(p.titulo ?? 'Prazo').slice(0, 255)
    const existing = await db
      .select({ id: deadlines.id })
      .from(deadlines)
      .where(
        and(
          eq(deadlines.executionCaseId, caseId),
          eq(deadlines.title, titulo),
          notInArray(deadlines.status, ['dismissed', 'completed'])
        )
      )
      .limit(1)
    if (existing.length > 0) continue
    // Prefere dataLimite (data real, calculada pela IA) — "dias" só serve pra
    // prazos processuais curtos contados de hoje. Achado 07/07/2026: usar só
    // "dias" fazia previsão de anos no futuro (progressão, livramento) virar
    // "vence hoje", porque a IA não tinha como expressar uma data absoluta.
    const dataLimite = typeof p.dataLimite === 'string' ? new Date(`${p.dataLimite}T12:00:00Z`) : null
    const dias = Number(p.dias)
    const due =
      dataLimite && !isNaN(dataLimite.getTime())
        ? dataLimite
        : new Date(Date.now() + (Number.isFinite(dias) ? dias : 15) * 86400000)
    await db.insert(deadlines).values({
      organizationId,
      executionCaseId: caseId,
      title: titulo,
      description: String(p.descricao ?? '') + (p.porque ? `\n\nPor quê (específico deste caso): ${String(p.porque)}` : ''),
      dueAt: due,
      deadlineClass: DL_CLASSES.has(p.classe) ? p.classe : 'legal',
      origin: 'rule',
      priority: 'normal',
      status: 'open',
      createdByUserId: userId,
    } as any)
    prazosCriados++
  }

  return {
    snapshotId,
    resumoPena: pena?.resumo ?? null,
    oportunidadesCriadas,
    prazosCriados,
    incremental: isIncremental,
    documentosLidos: docsForFullRead.length + growthBlocks.length,
  }
}
