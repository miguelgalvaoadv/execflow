import { Job } from 'pg-boss'
import { WorkersDb } from '../lib/db.js'
import { BrowserAgent } from '../services/browser-agent.js'
import { executionCases } from '@execflow/db/schema'
import { eq, and } from 'drizzle-orm'
import path from 'path'
import fs from 'fs'

export interface CourtScraperRequestedEvent {
  executionCaseId: string
  organizationId: string
  url: string
}

export async function handleCourtScraperRequested(db: WorkersDb, job: Job<CourtScraperRequestedEvent>) {
  const { executionCaseId, organizationId, url } = job.data

  console.log(`[Court Scraper] Iniciando robô navegador para o caso ${executionCaseId}`)

  // Buscar caso
  const [execCase] = await db
    .select()
    .from(executionCases)
    .where(and(eq(executionCases.id, executionCaseId), eq(executionCases.organizationId, organizationId)))

  if (!execCase || !execCase.executionProcessNumber) {
    throw new Error('Caso não encontrado ou sem número de processo.')
  }

  const cpf = process.env['COURT_CPF'] || '000.000.000-00'
  const password = process.env['COURT_PASSWORD'] || 'senha123'

  const instruction = `Você é um robô de automação jurídica.
Seu objetivo é entrar no tribunal (URL: ${url}), fazer login com o CPF ${cpf} e a senha ${password}.
Depois de logado, busque o processo número ${execCase.executionProcessNumber}.
Navegue até a área de documentos/autos do processo.
Encontre o PDF contendo a íntegra dos autos ou a última decisão importante.
Baixe o documento e, quando finalizar com sucesso, chame a ferramenta finish_task.`

  const storageDir = path.join(process.cwd(), '.storage', organizationId, executionCaseId)
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true })
  }

  const agent = new BrowserAgent()
  try {
    const { success, resultFilePath } = await agent.runTask({
      url,
      instruction,
      storagePath: storageDir,
      maxSteps: 15
    })

    if (!success) {
      throw new Error('Robô não conseguiu concluir a tarefa de raspar os autos.')
    }

    if (resultFilePath) {
      console.log(`[Court Scraper] Autos baixados com sucesso em: ${resultFilePath}`)
      // O documento já estaria salvo localmente, mas poderíamos registrar na tabela documents
      // Simulação do registro na base de dados
    }

  } finally {
    await agent.close()
  }

  console.log(`[Court Scraper] Tarefa do robô finalizada com sucesso!`)
}
