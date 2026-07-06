/**
 * Smoke-test de conectividade IMAP com a caixa dedicada do Astrea.
 *
 * Uso:
 *   pnpm tsx --env-file=.env.local scripts/test-astrea-imap-connection.ts
 *
 * Faz login, lista as pastas existentes, cria as subpastas ExecFlow/* se
 * ainda não existirem, e reporta quantos e-mails não lidos há na pasta de
 * origem. Não move nem altera nenhum e-mail.
 */

import {
  createAstreaImapConfig,
  withAstreaImapSession,
  getAstreaFolders,
} from '../src/integrations/astrea-imap-client.ts'

const config = createAstreaImapConfig()

if (!config) {
  console.error('❌ ASTREA_IMAP_HOST/USER/PASS ausentes no .env.local.')
  console.log('Configure essas três variáveis e rode o script de novo.')
  process.exit(1)
}

console.log(`\nTestando conexão IMAP com ${config.user}@${config.host}:${config.port}...`)
const folders = getAstreaFolders()

try {
  await withAstreaImapSession(config, async (client) => {
    console.log('✅ Login bem-sucedido.')

    const mailboxes = await client.list()
    console.log(`\nPastas existentes (${mailboxes.length}):`)
    for (const mb of mailboxes) {
      console.log(`  - ${mb.path}`)
    }

    console.log(`\n✅ Pastas ExecFlow/* confirmadas/criadas: ${folders.processed}, ${folders.orphan}, ${folders.error}`)

    const lock = await client.getMailboxLock(config.sourceFolder)
    try {
      const unseen = await client.search({ seen: false }, { uid: true })
      const count = unseen ? unseen.length : 0
      console.log(`\n📬 E-mails não lidos em "${config.sourceFolder}": ${count}`)
    } finally {
      lock.release()
    }
  })
  console.log('\n✅ Teste concluído sem erros. O poller automático deve funcionar normalmente.')
} catch (e: any) {
  console.error('\n❌ Falha na conexão IMAP:', e.message)
  if (String(e.message).toLowerCase().includes('auth')) {
    console.log('\nIsso geralmente significa senha de app inválida/expirada. Gere uma nova em:')
    console.log('https://myaccount.google.com/apppasswords')
    console.log('(requer verificação em duas etapas ativada na conta Gmail dedicada)')
  }
  process.exit(1)
}
