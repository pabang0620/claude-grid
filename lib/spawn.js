import { execSync, spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildMacTerminalScript, buildMacITermScript } from './layout.js'
import { detectOS } from './detect.js'

const IS_WSL = detectOS() === 'wsl'

const OPEN_DELAY_MS = 1000

// ─────────────────────────────────────────────
// 픽셀 → terminal cells 변환
// 기본 가정: Cascadia Mono 12pt
//   한 cell 너비 ≈ 9px
//   한 cell 높이 ≈ 19px
//   창 chrome: 위쪽(title bar + tab bar) ≈ 80px, 좌우 ≈ 16px
// ─────────────────────────────────────────────
const CELL_WIDTH_PX = 9
const CELL_HEIGHT_PX = 19
const CHROME_TOP_PX = 80
const CHROME_SIDE_PX = 16

function pxToCells(widthPx, heightPx) {
  const cols = Math.max(20, Math.floor((widthPx - CHROME_SIDE_PX * 2) / CELL_WIDTH_PX))
  const rows = Math.max(10, Math.floor((heightPx - CHROME_TOP_PX) / CELL_HEIGHT_PX))
  return { cols, rows }
}

function toWindowsPath(p) {
  try {
    return execSync(`wslpath -w "${p}"`, { stdio: 'pipe', encoding: 'utf-8' }).trim()
  } catch {
    return p
  }
}

export async function spawnWindows(terminal, platform, windows) {
  for (let i = 0; i < windows.length; i++) {
    const { path: workDir, cell } = windows[i]
    const label = `Claude ${i + 1}`
    await openWindow(terminal, platform, workDir, label, i, cell)
    if (i < windows.length - 1) {
      await sleep(OPEN_DELAY_MS)
    }
  }
}

async function openWindow(terminal, platform, workDir, label, index, cell) {
  if (platform === 'windows' || platform === 'wsl') {
    openWindowsTerminal(terminal, workDir, label, index, cell)
  } else if (platform === 'mac') {
    openMacTerminal(terminal, workDir, label, index, cell)
  } else {
    openLinuxTerminal(terminal, workDir, label)
  }
}

// ─────────────────────────────────────────────
// Windows
// ─────────────────────────────────────────────

function openWindowsTerminal(terminal, workDir, label, index, cell) {
  switch (terminal) {
    case 'windowsterminal':
      openWindowsTerminalApp(workDir, label, index, cell)
      break
    case 'powershell':
      openPowerShell(workDir, label)
      break
    case 'cmd':
    default:
      openCmd(workDir, label)
      break
  }
}

function openWindowsTerminalApp(workDir, label, index, cell) {
  // --pos, --size 인자 구성 (픽셀 → cells 변환)
  const posArgs = cell ? ['--pos', `${cell.x},${cell.y}`] : []
  const sizeArgs = cell ? (() => {
    const { cols, rows } = pxToCells(cell.width, cell.height)
    return ['--size', `${cols},${rows}`]
  })() : []

  if (IS_WSL) {
    const scriptPath = path.join(os.tmpdir(), `claude-grid-${Date.now()}-${index}.sh`)
    const escapedPath = workDir.replace(/'/g, "'\\''")
    const distro = process.env.WSL_DISTRO_NAME || 'Ubuntu'

    let claudeCmd = 'claude'
    try {
      const found = execSync(
        `wsl.exe -d ${distro} bash -l -c "which claude 2>/dev/null || echo"`,
        { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 }
      ).trim()
      if (found && found.startsWith('/')) claudeCmd = found
    } catch {}

    const scriptContent = [
      '#!/bin/bash -l',
      '. ~/.profile 2>/dev/null',
      '. ~/.bashrc 2>/dev/null',
      'export PATH="$HOME/.npm-global/bin:$HOME/.local/share/npm/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node/ 2>/dev/null | tail -1)/bin:$HOME/.local/bin:$PATH"',
      `cd '${escapedPath}'`,
      claudeCmd,
      'exec bash',
    ].join('\n') + '\n'
    fs.writeFileSync(scriptPath, scriptContent, 'utf-8')
    fs.chmodSync(scriptPath, '755')

    const child = spawn('wt.exe', [
      '-w', '-1',
      ...posArgs,
      ...sizeArgs,
      'new-tab', '--title', label,
      '--', 'wsl.exe', '-d', distro, 'bash', '-l', scriptPath,
    ], { detached: true, stdio: 'ignore', shell: false })
    child.unref()
    setTimeout(() => { try { fs.unlinkSync(scriptPath) } catch {} }, 60000)
  } else {
    // native Windows (non-WSL)
    const args = [
      '-w', '-1',
      ...posArgs,
      ...sizeArgs,
      'new-tab', '--title', label,
      '--startingDirectory', workDir,
      'cmd', '/k', 'claude',
    ]
    const child = spawn('wt.exe', args, { detached: true, stdio: 'ignore', shell: false })
    child.unref()
  }
}

function openPowerShell(workDir, label) {
  const resolvedDir = IS_WSL ? toWindowsPath(workDir) : workDir
  const escapedDir = resolvedDir.replace(/'/g, "''")
  runPowerShell(`Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '${escapedDir}'; claude"`)
}

function openCmd(workDir, label) {
  const resolvedDir = IS_WSL ? toWindowsPath(workDir) : workDir
  runPowerShell(`Start-Process cmd /ArgumentList "/k cd /d \\"${resolvedDir}\\" && claude"`)
}

// ─────────────────────────────────────────────
// Mac
// ─────────────────────────────────────────────

function openMacTerminal(terminal, workDir, label, index, cell) {
  if (terminal === 'iterm2') {
    runOsascript(buildMacITermScript(cell, workDir))
  } else {
    runOsascript(buildMacTerminalScript(cell, workDir))
  }
}

// ─────────────────────────────────────────────
// Linux
// ─────────────────────────────────────────────

function openLinuxTerminal(terminal, workDir, label) {
  const escapedPath = workDir.replace(/'/g, "'\\''")
  switch (terminal) {
    case 'gnome-terminal':
      spawnDetached(`gnome-terminal --title="${label}" --working-directory="${workDir}" -- bash -c "claude; bash"`)
      break
    case 'konsole':
      spawnDetached(`konsole --new-tab --workdir "${workDir}" -e bash -c "claude; bash"`)
      break
    case 'xterm':
    default:
      spawnDetached(`xterm -title "${label}" -e bash -c "cd '${escapedPath}' && claude; bash"`)
      break
  }
}

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

function spawnDetached(cmd) {
  const child = spawn(cmd, [], { shell: true, detached: true, stdio: 'ignore' })
  child.unref()
}

function runPowerShell(cmd) {
  const POWERSHELL_CMD = IS_WSL ? 'powershell.exe' : 'powershell'
  try {
    execSync(`${POWERSHELL_CMD} -Command "${cmd.replace(/"/g, '\\"')}"`, { stdio: 'pipe' })
  } catch {}
}

function runOsascript(script) {
  const tempFile = path.join(os.tmpdir(), `claunch-${Date.now()}.applescript`)
  try {
    fs.writeFileSync(tempFile, script, 'utf-8')
    execSync(`osascript "${tempFile}"`, { stdio: 'pipe' })
  } catch {} finally {
    try { fs.unlinkSync(tempFile) } catch {}
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export { sleep, pxToCells }
