/**
 * NOTA: O Jusbrasil não usa certificado digital cadastrado via API como o Escavador.
 * O acesso a processos em segredo de justiça no Jusbrasil é negociado diretamente
 * com o suporte (suportesolucoes@jusbrasil.com.br) e configurado no contrato.
 *
 * Se o Jusbrasil oferecer certificado digital no futuro, este script precisará
 * ser atualizado com o endpoint correto.
 *
 * Por enquanto, este script serve apenas para verificar a conectividade com a API:
 *   pnpm tsx --env-file=.env.local scripts/upload-cert.ts
 */

const apiKey = process.env['JUSBRASIL_API_KEY']
const apiUrl = process.env['JUSBRASIL_API_URL'] ?? 'https://api.jusbrasil.com.br'

if (!apiKey) {
  console.error('JUSBRASIL_API_KEY não configurada no .env.local')
  process.exit(1)
}

console.log(`\nTestando conectividade com a API Jusbrasil...`)
console.log(`URL: ${apiUrl}`)

try {
  const res = await fetch(`${apiUrl}/`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  console.log(`\nResposta: ${res.status} ${res.statusText}`)
  if (res.status === 401) {
    console.error('❌ Token inválido. Verifique JUSBRASIL_API_KEY.')
  } else {
    console.log('✅ Conexão bem-sucedida.')
  }
} catch (e: any) {
  console.error('❌ Falha de rede:', e.message)
  console.log('\nVerifique se JUSBRASIL_API_URL está correto.')
  console.log('URL padrão: https://api.jusbrasil.com.br')
  console.log('Alternativa Digesto: https://op.digesto.com.br/api')
}
