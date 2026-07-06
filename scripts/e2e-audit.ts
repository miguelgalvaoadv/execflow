import { chromium } from 'playwright'

async function runAudit() {
  console.log('[Audit] Launching browser...')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    console.log('[Audit] Navigating to http://127.0.0.1:3000/sign-in')
    await page.goto('http://127.0.0.1:3000/sign-in', { waitUntil: 'networkidle' })

    console.log('[Audit] Filling login form...')
    await page.fill('input[type="email"]', 'demo@execflow.app')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"], button:has-text("Entrar")')

    console.log('[Audit] Waiting for dashboard...')
    await page.waitForURL('**/dashboard', { timeout: 15000 }).catch(() => {
      console.log('[Audit] Could not navigate to /dashboard. Checking for errors...')
    })

    const currentUrl = page.url()
    console.log('[Audit] Current URL:', currentUrl)
    
    if (currentUrl.includes('/dashboard')) {
      console.log('[Audit] Login successful! Navigating to Cases...')
      await page.goto('http://127.0.0.1:3000/cases', { waitUntil: 'networkidle' })
      console.log('[Audit] Cases page loaded.')
      
      const caseLinks = await page.$$('a[href*="/cases/"]')
      if (caseLinks.length > 0) {
        console.log(`[Audit] Found ${caseLinks.length} cases. Clicking the first one...`)
        const href = await caseLinks[0].getAttribute('href')
        await page.goto(`http://127.0.0.1:3000${href}`, { waitUntil: 'networkidle' })
        console.log(`[Audit] Case details page (${href}) loaded.`)
      } else {
        console.log('[Audit] No cases found in the list.')
      }

      console.log('[Audit] Navigating to Deadlines...')
      await page.goto('http://127.0.0.1:3000/deadlines', { waitUntil: 'networkidle' })
      console.log('[Audit] Deadlines page loaded.')
    } else {
      console.log('[Audit] Failed to login. DOM snapshot:')
      const body = await page.innerHTML('body')
      console.log(body.substring(0, 1000))
    }

  } catch (err) {
    console.error('[Audit] Error during audit:', err)
  } finally {
    await browser.close()
    console.log('[Audit] Done.')
  }
}

runAudit().catch(console.error)
