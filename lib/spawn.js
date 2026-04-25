import { execSync, spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildMacTerminalScript, buildMacITermScript } from './layout.js'
import { detectOS } from './detect.js'

const IS_WSL = detectOS() === 'wsl'
const POWERSHELL_CMD = IS_WSL ? 'powershell.exe' : 'powershell'

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

const OPEN_DELAY_MS = 600
const POSITION_DELAY_MS = 800

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

  // 모든 창 열린 뒤 위치 조정
  await sleep(POSITION_DELAY_MS)

  if (platform === 'windows' || platform === 'wsl') {
    await positionWindowsAll(terminal, windows)
  }
  // Mac은 osascript 내에서 창 오픈 + 위치 조정을 한 번에 처리
}

async function openWindow(terminal, platform, workDir, label, index, cell) {
  if (platform === 'windows' || platform === 'wsl') {
    openWindowsTerminal(terminal, workDir, label, index)
  } else if (platform === 'mac') {
    openMacTerminal(terminal, workDir, label, index, cell)
  } else {
    openLinuxTerminal(terminal, workDir, label)
  }
}

// ─────────────────────────────────────────────
// Windows
// ─────────────────────────────────────────────

function openWindowsTerminal(terminal, workDir, label, index) {
  switch (terminal) {
    case 'windowsterminal':
      openWindowsTerminalApp(workDir, label, index)
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

function openWindowsTerminalApp(workDir, label, index) {
  // 첫 창은 새 창으로, 이후는 탭으로 열어도 되지만
  // 배치 편의를 위해 모두 새 창으로 열기
  const resolvedDir = IS_WSL ? toWindowsPath(workDir) : workDir
  const cmd = `wt.exe --window new new-tab --title "${label}" --startingDirectory "${resolvedDir}" cmd /k claude`
  spawnDetached(cmd)
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

async function positionWindowsAll(terminal, windows) {
  // Windows Terminal은 창이 열린 뒤 GetForegroundWindow로 각각 위치 조정이 어려움
  // 프로세스 목록에서 PID로 hwnd를 찾는 방식 사용
  for (let i = 0; i < windows.length; i++) {
    const { cell } = windows[i]
    try {
      const titleScript = buildWindowsPosScriptByTitle(`Claude ${i + 1}`, cell)
      runPowerShellScript(titleScript)
    } catch {
      // 위치 조정 실패는 무시 (창은 이미 열림)
    }
    await sleep(200)
  }
}

function buildWindowsPosScriptByTitle(title, cell) {
  const { x, y, width, height } = cell
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@
$targetTitle = "${title}"
$found = $null
[Win32]::EnumWindows([Win32+EnumWindowsProc]{
    param($hwnd, $lParam)
    $sb = New-Object System.Text.StringBuilder 256
    [void][Win32]::GetWindowText($hwnd, $sb, 256)
    $t = $sb.ToString()
    if ([Win32]::IsWindowVisible($hwnd) -and $t -like "*$targetTitle*") {
        $script:found = $hwnd
        return $false
    }
    return $true
}, [IntPtr]::Zero)
if ($found) {
    [Win32]::SetWindowPos($found, [IntPtr]::Zero, ${x}, ${y}, ${width}, ${height}, 0x0040)
}
`.trim()
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

function runPowerShellScript(script) {
  const tempFile = path.join(os.tmpdir(), `claunch-${Date.now()}.ps1`)
  try {
    fs.writeFileSync(tempFile, script, 'utf-8')
    execSync(`${POWERSHELL_CMD} -ExecutionPolicy Bypass -File "${tempFile}"`, { stdio: 'pipe' })
  } catch {
    // 위치 조정 실패 무시
  } finally {
    try { fs.unlinkSync(tempFile) } catch {}
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
