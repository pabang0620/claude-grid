import { execSync, spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildMacTerminalScript, buildMacITermScript } from './layout.js'
import { detectOS } from './detect.js'

const IS_WSL = detectOS() === 'wsl'
const POWERSHELL_CMD = IS_WSL ? 'powershell.exe' : 'powershell'

const CHAR_W = 8    // px per column (Cascadia Mono default)
const CHAR_H = 18   // px per row
const CHROME_H = 72 // title bar + tab bar height in px

/**
 * WSL 경로(/home/...) → Windows 경로(C:\...) 변환
 * Windows Terminal 등 Windows 네이티브 프로세스에 경로를 넘길 때 사용
 */
function toWindowsPath(p) {
  try {
    return execSync(`wslpath -w "${p}"`, { stdio: 'pipe', encoding: 'utf-8' }).trim()
  } catch {
    return p
  }
}

function cellToSize(cell) {
  const cols = Math.max(80, Math.floor(cell.width / CHAR_W) - 2)
  const rows = Math.max(20, Math.floor((cell.height - CHROME_H) / CHAR_H) - 1)
  return { cols, rows }
}

const OPEN_DELAY_MS = 800

/**
 * 모든 창을 열고 위치/크기 조정
 * @param {string} terminal - 터미널 종류
 * @param {string} platform - 운영체제
 * @param {Array<{path: string, cell: object}>} windows - 창 설정 목록
 */
export async function spawnWindows(terminal, platform, windows) {
  for (let i = 0; i < windows.length; i++) {
    const { path: workDir, cell } = windows[i]
    const label = `Claude ${i + 1}`
    await openWindow(terminal, platform, workDir, label, i, cell)
    await sleep(OPEN_DELAY_MS)
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
  if (IS_WSL) {
    // WSL: shell 우회해서 args 배열로 직접 전달 (따옴표/세미콜론 파싱 오류 방지)
    // temp 스크립트로 명령 분리
    const scriptPath = path.join(os.tmpdir(), `claude-grid-${Date.now()}-${index}.sh`)
    const escapedPath = workDir.replace(/'/g, "'\\''")
    const distro = process.env.WSL_DISTRO_NAME || 'Ubuntu'

    // claude 절대 경로 탐색 (WSL login shell 경로 문제 방지)
    let claudeCmd = 'claude'
    try {
      const found = execSync(
        `wsl.exe -d ${distro} bash -l -c "which claude 2>/dev/null || echo"`,
        { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 }
      ).trim()
      if (found && found.length > 0 && found.startsWith('/')) {
        claudeCmd = found
      }
    } catch {
      // 탐색 실패 시 bare 명령 + fallback PATH 사용
    }

    // -l (login shell) 플래그로 ~/.profile, ~/.bashrc 로드 → claude PATH 확보
    // which 로 절대경로를 못 찾은 경우를 위해 공통 npm global bin 경로를 fallback으로 추가
    const scriptContent = [
      '#!/bin/bash -l',
      `. ~/.profile 2>/dev/null`,
      `. ~/.bashrc 2>/dev/null`,
      'export PATH="$HOME/.npm-global/bin:$HOME/.local/share/npm/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node/ 2>/dev/null | tail -1)/bin:$HOME/.local/bin:$PATH"',
      `cd '${escapedPath}'`,
      claudeCmd,
      'exec bash',
    ].join('\n') + '\n'
    fs.writeFileSync(scriptPath, scriptContent, 'utf-8')
    fs.chmodSync(scriptPath, '755')

    const { cols, rows } = cellToSize(cell)
    const posArgs = cell ? ['--pos', `${cell.x},${cell.y}`] : []
    const sizeArgs = cell ? ['--size', `${cols}c${rows}r`] : []

    const child = spawn('wt.exe', [
      '--window', 'new',
      ...posArgs,
      ...sizeArgs,
      'new-tab',
      '--title', label,
      '--',
      'wsl.exe', '-d', distro,
      'bash', '-l', scriptPath,
    ], { detached: true, stdio: 'ignore', shell: false })
    child.unref()

    // 60초 후 temp 스크립트 삭제 (Windows Terminal 프로세스가 파일을 읽을 충분한 시간 확보)
    setTimeout(() => { try { fs.unlinkSync(scriptPath) } catch {} }, 60000)
  } else {
    const { cols, rows } = cellToSize(cell)
    const posFlag = cell ? `--pos ${cell.x},${cell.y} ` : ''
    const sizeFlag = cell ? `--size ${cols}c${rows}r ` : ''
    const cmd = `wt.exe --window new ${posFlag}${sizeFlag}new-tab --title "${label}" --startingDirectory "${workDir}" cmd /k claude`
    spawnDetached(cmd)
  }
}

function openPowerShell(workDir, label) {
  // 작은따옴표를 PowerShell 싱글쿼트 안에서 ''로 이스케이프
  const resolvedDir = IS_WSL ? toWindowsPath(workDir) : workDir
  const escapedDir = resolvedDir.replace(/'/g, "''")
  const cmd = `Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '${escapedDir}'; claude"`
  runPowerShell(cmd)
}

function openCmd(workDir, label) {
  // 경로에 공백이나 특수문자가 있을 때를 대비해 따옴표로 감쌈
  const resolvedDir = IS_WSL ? toWindowsPath(workDir) : workDir
  const cmd = `Start-Process cmd /ArgumentList "/k cd /d \\"${resolvedDir}\\" && claude"`
  runPowerShell(cmd)
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
  const child = spawn(cmd, [], {
    shell: true,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

function runPowerShell(cmd) {
  try {
    execSync(`${POWERSHELL_CMD} -Command "${cmd.replace(/"/g, '\\"')}"`, { stdio: 'pipe' })
  } catch {
    // 비동기 실행 실패 무시
  }
}

function runOsascript(script) {
  const tempFile = path.join(os.tmpdir(), `claunch-${Date.now()}.applescript`)
  try {
    fs.writeFileSync(tempFile, script, 'utf-8')
    execSync(`osascript "${tempFile}"`, { stdio: 'pipe' })
  } catch {
    // 무시
  } finally {
    try { fs.unlinkSync(tempFile) } catch {}
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export { sleep }
