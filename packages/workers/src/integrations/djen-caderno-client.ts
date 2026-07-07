/**
 * Cliente DJEN via "caderno" diário (comunicaapi.pje.jus.br/api/v1/caderno) —
 * ALTERNATIVA ao endpoint filtrado por OAB (`djen-client.ts`), que passou a ser
 * bloqueado por proteção anti-bot (WAF na frente do CloudFront): testado ao
 * vivo em 06/07/2026 de 3 redes diferentes (residencial BR, datacenter Render,
 * infraestrutura Anthropic) — todas bloqueadas (403 ou travamento em
 * renegociação TLS). O endpoint de CADERNO (baixa o Diário do dia inteiro em
 * ZIP) NÃO tem esse bloqueio — testado ao vivo, HTTP 200 em <1s, mesmo
 * conjunto de campos (inclusive `destinatarioadvogados[].numero_oab/uf_oab`).
 *
 * Trade-off: baixa o diário INTEIRO de um tribunal num dia (dezenas de
 * milhares de comunicações, ~150MB) e filtra localmente pela(s) OAB(s) do
 * escritório — mais pesado que uma busca filtrada no servidor, mas é grátis e
 * funciona. Roda 1x/dia (não 2x — o conteúdo de um dia já publicado não muda).
 */

import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import type { DjenIntimacao } from './djen-client.ts'

const BASE_URL = 'https://comunicaapi.pje.jus.br/api/v1/caderno'

export type DjenOabTarget = { numero: string; uf: string }

export type CadernoFetchResult = {
  ok: boolean
  networkError: boolean
  /** true quando o CNJ ainda não processou o caderno deste dia (tenta de novo depois). */
  notReady: boolean
  intimacoes: DjenIntimacao[]
}

type CadernoMeta = {
  status: string
  url: string
  total_comunicacoes: number
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function fetchCadernoMeta(tribunal: string, date: string): Promise<CadernoMeta | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const res = await fetch(`${BASE_URL}/${tribunal}/${date}/D`, {
      headers: { Accept: 'application/json', 'User-Agent': 'ExecFlow/1.0' },
      signal: controller.signal,
    })
    if (!res.ok) return null
    const body = (await res.json()) as Partial<CadernoMeta>
    if (!body.url || !body.status) return null
    return { status: body.status, url: body.url, total_comunicacoes: body.total_comunicacoes ?? 0 }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function downloadToTempFile(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok || !res.body) throw new Error(`Falha ao baixar caderno: HTTP ${res.status}`)
  const path = join(tmpdir(), `djen-caderno-${randomUUID()}.zip`)
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(path))
  return path
}

/** Lê uma entry do ZIP inteira para um Buffer (cada página do caderno tem poucos MB). */
function readEntryToBuffer(zipfile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(err ?? new Error('sem stream'))
      const chunks: Buffer[] = []
      stream.on('data', (c: Buffer) => chunks.push(c))
      stream.on('end', () => resolve(Buffer.concat(chunks)))
      stream.on('error', reject)
    })
  })
}

type CadernoItem = {
  data_disponibilizacao?: string
  siglaTribunal?: string
  tipoComunicacao?: string
  nomeOrgao?: string
  texto?: string
  numero_processo?: string
  link?: string
  hash?: string
  destinatarioadvogados?: Array<{ advogado?: { numero_oab?: string; uf_oab?: string } }>
}

/** Processa o ZIP do caderno, entry por entry (streaming — nunca extrai tudo de uma vez). */
async function extractMatchingIntimacoes(
  zipPath: string,
  targets: DjenOabTarget[]
): Promise<DjenIntimacao[]> {
  const wanted = new Set(targets.map((t) => `${t.numero}/${t.uf}`.toUpperCase()))
  const out: DjenIntimacao[] = []

  await new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('zip inválido'))
      zipfile.readEntry()
      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (!entry.fileName.endsWith('.json')) {
          zipfile.readEntry()
          return
        }
        readEntryToBuffer(zipfile, entry)
          .then((buf) => {
            try {
              const page = JSON.parse(buf.toString('utf8')) as { items?: CadernoItem[] }
              for (const it of page.items ?? []) {
                const advs = it.destinatarioadvogados ?? []
                const hit = advs.some((a) => {
                  const numero = a.advogado?.numero_oab
                  const uf = a.advogado?.uf_oab
                  return numero && uf && wanted.has(`${numero}/${uf.toUpperCase()}`)
                })
                if (!hit) continue
                const processNumber = String(it.numero_processo ?? '').replace(/\D/g, '')
                const dataRaw = it.data_disponibilizacao ?? ''
                const dt = dataRaw ? new Date(`${dataRaw}T12:00:00Z`) : null
                if (!processNumber || !dt || isNaN(dt.getTime()) || !it.hash) continue
                out.push({
                  processNumber,
                  tipoComunicacao: it.tipoComunicacao ?? 'Intimação',
                  dataDisponibilizacao: dt,
                  siglaTribunal: it.siglaTribunal ?? null,
                  nomeOrgao: it.nomeOrgao ?? null,
                  texto: it.texto ?? '',
                  link: it.link ?? null,
                  hash: it.hash,
                })
              }
            } catch (e) {
              console.warn(`[djen-caderno] Falha ao ler página ${entry.fileName}:`, e instanceof Error ? e.message : e)
            }
            zipfile.readEntry()
          })
          .catch((e) => {
            console.warn(`[djen-caderno] Falha ao abrir página ${entry.fileName}:`, e instanceof Error ? e.message : e)
            zipfile.readEntry()
          })
      })
      zipfile.on('end', () => resolve())
      zipfile.on('error', reject)
    })
  })

  return out
}

/**
 * Busca as intimações de um tribunal/dia que batem com alguma das OABs alvo.
 * Nunca lança — erros viram { networkError: true }. Um dia ainda não
 * processado pelo CNJ vira { notReady: true } (tenta de novo no próximo run).
 */
export async function fetchCadernoIntimacoes(
  tribunal: string,
  date: Date,
  targets: DjenOabTarget[]
): Promise<CadernoFetchResult> {
  const empty: CadernoFetchResult = { ok: false, networkError: false, notReady: false, intimacoes: [] }
  if (targets.length === 0) return empty

  const dateStr = isoDate(date)
  const meta = await fetchCadernoMeta(tribunal, dateStr)
  if (!meta) return { ...empty, networkError: true }
  if (meta.status !== 'Processado') return { ...empty, notReady: true }

  let zipPath: string | null = null
  try {
    zipPath = await downloadToTempFile(meta.url)
    const intimacoes = await extractMatchingIntimacoes(zipPath, targets)
    return { ok: true, networkError: false, notReady: false, intimacoes }
  } catch (e) {
    console.warn(`[djen-caderno] Falha ao processar caderno ${tribunal}/${dateStr}:`, e instanceof Error ? e.message : e)
    return { ...empty, networkError: true }
  } finally {
    if (zipPath) await unlink(zipPath).catch(() => {})
  }
}
