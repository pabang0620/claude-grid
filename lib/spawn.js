import { execSync, spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildMacTerminalScript, buildMacITermScript } from './layout.js'
import { detectOS } from './detect.js'

const IS_WSL = detectOS() === 'wsl'
const POWERSHELL_CMD = IS_WSL ? 'powershell.exe' : 'powershell'

const OPEN_DELAY_MS = 800

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

/**
 * 현재 실행 중인 WindowsTerminal.exe PID 목록을 Set으로 반환
 * spawnWindows 시작 시 호출해 기존 PID 스냅샷을 확보한다.
 */
function captureWTPids() {
  try {
    const out = execSync(
      `${POWERSHELL_CMD} -Command "Get-Process -Name WindowsTerminal -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id | ForEach-Object { $_ }"`,
      { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 }
    ).trim()
    const pids = out
      ? out.split(/\r?\n/).map(s => parseInt(s.trim())).filter(n => !isNaN(n))
      : []
    return new Set(pids)
  } catch {
    return new Set()
  }
}

/**
 * 각 cell의 x/y/width/height를 SetWindowPos로 적용하는 PowerShell 스크립트를 문자열로 생성
 * prePids: spawnWindows 시작 전 캡처한 기존 PID Set
 * cells: windows 배열에서 추출한 cell 객체 배열 (순서 = 창 열린 순서)
 */
function buildBatchPositionScript(prePids, cells) {
  const count = cells.length
  const preList = [...prePids].length > 0 ? [...prePids].join(', ') : '0'
  const cellLines = cells.map((c, i) =>
    `  @{ idx = ${i}; x = ${c.x}; y = ${c.y}; w = ${c.width}; h = ${c.height} }`
  ).join(",\n")

  // Win+Arrow key sequences per window index (for counts 2-4)
  const snapMap = {
    2: [['LEFT'], ['RIGHT']],
    3: [['LEFT', 'UP'], ['RIGHT', 'UP'], ['LEFT', 'DOWN']],
    4: [['LEFT', 'UP'], ['RIGHT', 'UP'], ['LEFT', 'DOWN'], ['RIGHT', 'DOWN']],
  }
  const sequences = snapMap[count] || null
  const useSnap = sequences !== null

  // Build PowerShell snap sequence table (index → array of VK names)
  const snapTableLines = useSnap
    ? sequences.map((keys, i) => `  ${i} = @("${keys.join('","')}")`).join("\n")
    : ''

  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Batch {
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);
}
"@

$prePids = @(${preList})
$cells = @(
${cellLines}
)
$useSnap = $${useSnap ? 'true' : 'false'}
$snapTable = @{
${snapTableLines}
}
$vkMap = @{ LEFT = [byte]0x25; RIGHT = [byte]0x27; UP = [byte]0x26; DOWN = [byte]0x28 }
$VK_LWIN = [byte]0x5B
$KEYEVENTF_KEYUP = [uint32]0x0002

function Send-WinArrow([IntPtr]$hwnd, [string[]]$keys) {
    [Win32Batch]::SetForegroundWindow($hwnd)
    Start-Sleep -Milliseconds 300
    foreach ($k in $keys) {
        $vk = $vkMap[$k]
        [Win32Batch]::keybd_event($VK_LWIN, 0, 0, [IntPtr]::Zero)
        [Win32Batch]::keybd_event($vk, 0, 0, [IntPtr]::Zero)
        [Win32Batch]::keybd_event($vk, 0, $KEYEVENTF_KEYUP, [IntPtr]::Zero)
        [Win32Batch]::keybd_event($VK_LWIN, 0, $KEYEVENTF_KEYUP, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 500
    }
}

$newProcs = Get-Process -Name "WindowsTerminal" -ErrorAction SilentlyContinue |
            Where-Object { $_.Id -notin $prePids } |
            Sort-Object StartTime

$pidHwnd = @{}
$maxTries = 20
$try = 0
while ($try -lt $maxTries) {
    $pidHwnd = @{}
    [Win32Batch]::EnumWindows([Win32Batch+EnumWindowsProc]{
        param($hwnd, $lParam)
        if ([Win32Batch]::IsWindowVisible($hwnd)) {
            $pid = [uint32]0
            [Win32Batch]::GetWindowThreadProcessId($hwnd, [ref]$pid)
            if (-not $script:pidHwnd.ContainsKey([int]$pid)) {
                $script:pidHwnd[[int]$pid] = $hwnd
            }
        }
        return $true
    }, [IntPtr]::Zero)
    $allFound = $true
    foreach ($proc in $newProcs) {
        if (-not $pidHwnd.ContainsKey([int]$proc.Id)) { $allFound = $false; break }
    }
    if ($allFound -or $newProcs.Count -eq 0) { break }
    Start-Sleep -Milliseconds 300
    $try++
}

for ($i = 0; $i -lt [Math]::Min($newProcs.Count, $cells.Count); $i++) {
    $hwnd = $pidHwnd[[int]$newProcs[$i].Id]
    if (-not $hwnd) { continue }
    if ($useSnap -and $snapTable.ContainsKey($i)) {
        Send-WinArrow $hwnd $snapTable[$i]
    } else {
        $cell = $cells[$i]
        [Win32Batch]::SetWindowPos($hwnd, [IntPtr]::Zero, $cell.x, $cell.y, $cell.w, $cell.h, 0x0044)
    }
}
`.trim()
}

/**
 * temp .ps1 파일을 작성하고 PowerShell을 detached로 실행해 비동기 창 위치 조정
 * 30초 후 temp 파일 자동 삭제
 */
function positionAllWindowsAsync(prePids, cells) {
  const script = buildBatchPositionScript(prePids, cells)
  const tempFile = path.join(os.tmpdir(), `claunch-pos-${Date.now()}.ps1`)
  try {
    fs.writeFileSync(tempFile, script, 'utf-8')
    const child = spawn(POWERSHELL_CMD, ['-ExecutionPolicy', 'Bypass', '-File', tempFile], {
      detached: true,
      stdio: 'ignore',
      shell: false,
    })
    child.unref()
    setTimeout(() => { try { fs.unlinkSync(tempFile) } catch {} }, 30000)
  } catch {}
}

/**
 * 모든 창을 열고 위치/크기 조정
 * @param {string} terminal - 터미널 종류
 * @param {string} platform - 운영체제
 * @param {Array<{path: string, cell: object}>} windows - 창 설정 목록
 */
export async function spawnWindows(terminal, platform, windows) {
  // Snapshot existing WT PIDs so we can identify which new processes are ours
  let prePids = new Set()
  if (platform === 'windows' || platform === 'wsl') {
    prePids = captureWTPids()
  }

  for (let i = 0; i < windows.length; i++) {
    const { path: workDir, cell } = windows[i]
    const label = `Claude ${i + 1}`
    await openWindow(terminal, platform, workDir, label, i, cell)
    await sleep(OPEN_DELAY_MS)
  }

  if (platform === 'windows' || platform === 'wsl') {
    await sleep(2000)  // let the last window fully initialize before positioning
    positionAllWindowsAsync(prePids, windows.map(w => w.cell))
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

    const posArgs = cell ? ['--pos', `${cell.x},${cell.y}`] : []

    const child = spawn('wt.exe', [
      '--window', 'new',
      ...posArgs,
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
    const posFlag = cell ? `--pos ${cell.x},${cell.y} ` : ''
    const cmd = `wt.exe --window new ${posFlag}new-tab --title "${label}" --startingDirectory "${workDir}" cmd /k claude`
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
