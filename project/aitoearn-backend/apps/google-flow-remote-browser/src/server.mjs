import express from "express"
import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"

const app = express()
app.use(express.json({ limit: "1mb" }))

const PORT = Number(process.env.PORT || 4320)
const FLOW_URL = process.env.GOOGLE_FLOW_URL || "https://labs.google/fx/tools/flow"
const DISPLAY = process.env.DISPLAY || ":99"
const CDP_PORT = Number(process.env.CDP_PORT || 9222)
const CDP_PROXY_PORT = Number(process.env.CDP_PROXY_PORT || 9223)
const PROFILES_ROOT_DIR = process.env.GOOGLE_FLOW_PROFILES_ROOT_DIR || "/data/google-flow-user-data"
const LOGIN_PUBLIC_URL = process.env.GOOGLE_FLOW_REMOTE_LOGIN_PUBLIC_URL || "/flow-login/vnc.html?autoconnect=1&resize=scale"
const DEFAULT_PROFILE_ID = process.env.GOOGLE_FLOW_DEFAULT_PROFILE_ID || "legacy-default"

let chromeProc = null
let activeProfileId = ""
let activeUrl = FLOW_URL

// Track when Chrome last exited so worker can detect stale CDP
let chromeExitedAt = 0
let chromeStartedAt = 0

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function safeFilename(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 128)
}

function profileUserDataDir(profileId) {
  const id = safeFilename(profileId || DEFAULT_PROFILE_ID)
  // IMPORTANT: must use the SAME path as the playwright worker so the login
  // session saved here is reused by the headless generation worker.
  // Worker uses: {PROFILES_ROOT_DIR}/{profileId}/user-data
  return path.join(PROFILES_ROOT_DIR, id, "user-data")
}

function cleanupChromeSingletonLocks(userDataDir) {
  const lockFiles = [
    "SingletonLock",
    "SingletonSocket",
    "SingletonCookie",
  ]
  for (const filename of lockFiles) {
    try {
      fs.rmSync(path.join(userDataDir, filename), { force: true })
    }
    catch {
      // ignore stale lock cleanup errors
    }
  }
}

async function stopChrome() {
  if (!chromeProc) {
    return
  }
  const proc = chromeProc
  chromeProc = null
  proc.kill("SIGTERM")
  await new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (!settled) {
        settled = true
        resolve()
      }
    }
    proc.once("exit", done)
    setTimeout(() => {
      try {
        proc.kill("SIGKILL")
      }
      catch {
        // ignore
      }
      done()
    }, 5000)
  })
}

async function waitForCdpReady(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, {
        signal: AbortSignal.timeout(1500),
      })
      if (response.ok) {
        return true
      }
    }
    catch {
      // retry
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return false
}

async function openChrome(profileId, url) {
  const nextProfileId = String(profileId || DEFAULT_PROFILE_ID).trim() || DEFAULT_PROFILE_ID
  const nextUrl = String(url || FLOW_URL).trim() || FLOW_URL
  const userDataDir = profileUserDataDir(nextProfileId)
  ensureDir(userDataDir)
  await stopChrome()
  cleanupChromeSingletonLocks(userDataDir)

  const args = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    "--window-size=1440,900",
    `--remote-debugging-address=0.0.0.0`,
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    nextUrl,
  ]
  const proc = spawn("google-chrome", args, {
    env: {
      ...process.env,
      DISPLAY,
    },
    stdio: ["ignore", "ignore", "pipe"],
  })
  chromeProc = proc
  chromeStartedAt = Date.now()

  proc.stderr?.on("data", (chunk) => {
    const text = String(chunk || "").trim()
    if (text) {
      console.log(`[chrome] ${text}`)
    }
  })
  proc.on("exit", (code, signal) => {
    // Only clear if this is still the active process
    if (chromeProc === proc) {
      chromeProc = null
    }
    chromeExitedAt = Date.now()
    console.log(`[chrome] process exited (code=${code} signal=${signal}). Session saved to disk in ${userDataDir}`)
  })

  const cdpReady = await waitForCdpReady()
  activeProfileId = nextProfileId
  activeUrl = nextUrl

  console.log(`[remote-browser] Chrome opened for profile=${nextProfileId} cdpReady=${cdpReady} userDataDir=${userDataDir}`)

  return {
    ok: cdpReady,
    profileId: nextProfileId,
    loginUrl: nextUrl,
    noVncUrl: LOGIN_PUBLIC_URL,
    cdpUrl: `http://127.0.0.1:${CDP_PROXY_PORT}`,
    userDataDir,
  }
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    chromeRunning: Boolean(chromeProc),
    activeProfileId: activeProfileId || null,
    chromeStartedAt: chromeStartedAt || null,
    chromeExitedAt: chromeExitedAt || null,
  })
})

app.get("/v1/login/info", (_req, res) => {
  res.json({
    activeProfileId: activeProfileId || null,
    loginUrl: activeUrl,
    noVncUrl: LOGIN_PUBLIC_URL,
    cdpUrl: `http://127.0.0.1:${CDP_PROXY_PORT}`,
    chromeRunning: Boolean(chromeProc),
    chromeStartedAt: chromeStartedAt || null,
    chromeExitedAt: chromeExitedAt || null,
  })
})

app.get("/v1/cdp/version", async (_req, res) => {
  try {
    const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, {
      signal: AbortSignal.timeout(3000),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      return res.status(response.status).json(payload)
    }
    return res.json(payload)
  }
  catch (error) {
    return res.status(500).json({ message: error instanceof Error ? error.message : String(error) })
  }
})

app.post("/v1/login/open", async (req, res) => {
  try {
    const result = await openChrome(req.body?.profileId, req.body?.url)
    return res.json(result)
  }
  catch (error) {
    return res.status(500).json({ message: error instanceof Error ? error.message : String(error) })
  }
})

app.post("/v1/login/close", (_req, res) => {
  stopChrome()
    .then(() => res.json({ ok: true, note: "Chrome stopped. Session data preserved on disk." }))
    .catch(error => res.status(500).json({ message: error instanceof Error ? error.message : String(error) }))
})

app.listen(PORT, () => {
  console.log(`google-flow-remote-browser listening on :${PORT}`)
  console.log(`  PROFILES_ROOT_DIR = ${PROFILES_ROOT_DIR}`)
  console.log(`  user-data path pattern = ${PROFILES_ROOT_DIR}/{profileId}/user-data`)
  console.log(`  (same as playwright worker — sessions are shared)`)
})
