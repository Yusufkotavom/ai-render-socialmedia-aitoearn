// Playwright Inspector session dengan profile + bypass Google
// Run: node src/inspect-paused.mjs
// Ini akan buka Playwright Inspector — gunakan "Pick locator" untuk klik element

import { chromium } from 'playwright'

const PROFILE_DIR = 'C:/tmp/google-flow-profiles/legacy-default'
const FLOW_URL = 'https://labs.google/fx/tools/image-fx'

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  args: [
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--window-size=1440,900',
  ],
})

const page = ctx.pages()[0] || await ctx.newPage()
await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)

// Buka Playwright Inspector — dari sini Anda bisa:
// 1. Klik "Record" untuk record actions
// 2. Klik "Pick locator" untuk inspect element
// 3. Interaksi manual di browser window
console.log('\n✅ Browser terbuka dengan profil login.')
console.log('📋 Instruksi:')
console.log('  1. Di browser: klik pill button (Nano Banana 2 x2)')
console.log('  2. Di dropdown: klik model sub-button (arrow_drop_down)')
console.log('  3. Di Playwright Inspector: klik "Pick locator" lalu hover element')
console.log('  4. Atau manual klik dan screenshot hasilnya')
console.log('\nPress Ctrl+C to close.\n')

// Pause membuka Inspector window
await page.pause()

await ctx.close()
