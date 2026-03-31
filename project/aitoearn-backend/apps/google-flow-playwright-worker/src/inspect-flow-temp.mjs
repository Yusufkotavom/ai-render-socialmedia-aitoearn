// Temp diagnostic script — inspect model picker HTML
// Run from worker dir: node src/inspect-flow-temp.mjs

import { chromium } from 'playwright'
import { writeFileSync } from 'fs'

const PROFILE_DIR = 'C:/tmp/google-flow-profiles/legacy-default'
const FLOW_URL = 'https://labs.google/fx/tools/image-fx'

console.log('Opening browser with profile...')
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  args: [
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1440,900',
  ],
})

const page = ctx.pages()[0] || await ctx.newPage()
await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded' })
console.log('Page loaded. Waiting 3s...')
await page.waitForTimeout(3000)

// ---- Step 1: Click pill button (open main dropdown) ----
console.log('\n[Step 1] Opening main dropdown...')
const pill = page.locator('button[aria-haspopup="menu"]').filter({ hasText: /banana|imagen/i }).filter({ hasText: /x[0-9]/ })
const pillCount = await pill.count()
console.log(`  Found pill buttons: ${pillCount}`)
if (pillCount > 0) {
  await pill.first().click()
  await page.waitForTimeout(700)
  console.log('  Main dropdown opened.')

  // ---- Step 2: Click model sub-button inside dropdown ----
  console.log('\n[Step 2] Clicking model sub-button inside dropdown...')
  const subBtn = page.locator('[data-radix-popper-content-wrapper] button[aria-haspopup="menu"]').filter({ hasText: /banana|imagen/i })
  const subCount = await subBtn.count()
  console.log(`  Found model sub-buttons in popper: ${subCount}`)
  if (subCount > 0) {
    await subBtn.first().click()
    await page.waitForTimeout(1000)
    console.log('  Model sub-picker should be open.')
  } else {
    // Try any button inside popper with arrow_drop_down text
    const arrowBtn = page.locator('[data-radix-popper-content-wrapper] button').filter({ hasText: /arrow_drop_down/i })
    const arrowCnt = await arrowBtn.count()
    console.log(`  arrow_drop_down buttons in popper: ${arrowCnt}`)
    if (arrowCnt > 0) {
      await arrowBtn.first().click()
      await page.waitForTimeout(1000)
    }
  }

  // ---- Step 3: Dump all popper HTML ----
  console.log('\n[Step 3] Dumping all popper HTML...')
  const html = await page.evaluate(() => {
    const poppers = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'))
    const results = poppers.map((p, i) => `\n========= POPPER ${i} =========\n${p.innerHTML.substring(0, 5000)}`)
    const items = Array.from(document.querySelectorAll('[role="menuitem"],[role="option"],[role="radio"],[role="listitem"]'))
    results.push(`\n========= MENUITEMS (${items.length}) =========`)
    items.forEach(el => results.push(el.outerHTML.substring(0, 600)))
    return results.join('\n')
  })
  writeFileSync('C:/tmp/flow-model-picker-html.txt', html)
  console.log('\n✅ HTML dumped to: C:/tmp/flow-model-picker-html.txt')
} else {
  console.log('  ERROR: pill button not found!')
}

console.log('\nBrowser stays open. Press Ctrl+C to close.')
await new Promise(() => { })
