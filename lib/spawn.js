import { execSync, spawnSync, spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildMacTerminalScript, buildMacITermScript } from './layout.js'
import { detectOS } from './detect.js'

const IS_WSL = detectOS() === 'wsl'
const POWERSHELL_CMD = IS_WSL ? 'powershell.exe' : 'powershell'

const OPEN_DELAY_MS = 800

function toWindowsPath(p) {
  try {
    return execSync(`wslpath -w "${p}"`, { stdio: 'pipe', encoding: 'utf-8' }).trim()
  } catch {
    return p
  }
}

// PS1 파일을 /tmp 에 쓰고 spawnSync(shell:false) 로 실행 — shell이 \\ → \ 로 망가뜨리는 것 방지
function runPs1Sync(script, timeout = 10000) {
  const linuxTemp = path.join(os.tmpdir(), `claunch-${Date.now()}.ps1`)
  try {
    fs.writeFileSync(linuxTemp, script, 'utf-8')
    const ps1Path = IS_WSL ? toWindowsPath(linuxTemp) : linuxTemp
    const result = spawnSync(POWERSHELL_CMD, ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', ps1Path], {
      encoding: 'utf-8', timeout, stdio: 'pipe',
    })
    return (result.stdout || '').trim()
  } finally {
    try { fs.unlinkSync(linuxTemp) } catch {}
  }
}

function spawnPs1Async(script) {
  const linuxTemp = path.join(os.tmpdir(), `claunch-pos-${Date.now()}.ps1`)
  try {
    fs.writeFileSync(linuxTemp, script, 'utf-8')
    const ps1Path = IS_WSL ? toWindowsPath(linuxTemp) : linuxTemp
    const child = spawn(POWERSHELL_CMD, ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', ps1Path], {
      detached: true, stdio: 'ignore', shell: false,
    })
    child.unref()
    setTimeout(() => { try { fs.unlinkSync(linuxTemp) } catch {} }, 30000)
  } catch {}
}

// 현재 화면의 모든 WindowsTerminal 창 HWND 목록을 숫자 배열로 반환
function captureWTHwnds() {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinSnapA {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@
$wtPids = Get-Process -Name "WindowsTerminal" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id
$list = New-Object System.Collections.Generic.List[long]
[void][WinSnapA]::EnumWindows([WinSnapA+EnumWindowsProc]{
    param($hwnd, $lParam)
    if ([WinSnapA]::IsWindowVisible($hwnd)) {
        $p = [uint32]0
        [WinSnapA]::GetWindowThreadProcessId($hwnd, [ref]$p)
        if ($script:wtPids -contains [int]$p) { [void]$script:list.Add([long]$hwnd) }
    }
    return $true
}, [IntPtr]::Zero)
if ($list.Count -gt 0) { $list -join ',' } else { '' }
`.trim()
  try {
    const result = runPs1Sync(script)
    return result ? result.split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s)) : []
  } catch {
    return []
  }
}

function buildBatchPositionScript(preHwnds, cells) {
  const preList = preHwnds.length > 0 ? preHwnds.join(', ') : '-1'
  const cellLines = cells.map((c, i) =>
    `  @{ idx = ${i}; x = ${c.x}; y = ${c.y}; w = ${c.width}; h = ${c.height} }`
  ).join(",\n")

  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinPosB {
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@

$preHwnds = [long[]]@(${preList})
$cells = @(
${cellLines}
)
$wtPids = Get-Process -Name "WindowsTerminal" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id

function Get-NewWTHwnds {
    $all = New-Object System.Collections.Generic.List[long]
    [void][WinPosB]::EnumWindows([WinPosB+EnumWindowsProc]{
        param($hwnd, $lParam)
        if ([WinPosB]::IsWindowVisible($hwnd)) {
            $p = [uint32]0
            [WinPosB]::GetWindowThreadProcessId($hwnd, [ref]$p)
            if ($script:wtPids -contains [int]$p) { [void]$script:all.Add([long]$hwnd) }
        }
        return $true
    }, [IntPtr]::Zero)
    # preHwnds 에 없는 것만 남기고, Z-order 역순(오래된 창부터)
    $filtered = @($all | Where-Object { $script:preHwnds -notcontains $_ })
    [array]::Reverse($filtered)
    return $filtered
}

# 충분한 HWND가 모일 때까지 최대 6초 대기
$newHwnds = @()
for ($i = 0; $i -lt 20; $i++) {
    $newHwnds = Get-NewWTHwnds
    if ($newHwnds.Count -ge $cells.Count) { break }
    Start-Sleep -Milliseconds 300
}

for ($i = 0; $i -lt [Math]::Min($newHwnds.Count, $cells.Count); $i++) {
    $cell = $cells[$i]
    [WinPosB]::SetWindowPos([IntPtr]$newHwnds[$i], [IntPtr]::Zero, $cell.x, $cell.y, $cell.w, $cell.h, 0x0044)
}
`.trim()
}

export async function spawnWindows(terminal, platform, windows) {
  let preHwnds = []
  if (platform === 'windows' || platform === 'wsl') {
    preHwnds = captureWTHwnds()
  }

  for (let i = 0; i < windows.length; i++) {
    const { path: workDir, cell } = windows[i]
    const label = `Claude ${i + 1}`
    await openWindow(terminal, platform, workDir, label, i, cell)
    await sleep(OPEN_DELAY_MS)
  }

  if (platform === 'windows' || platform === 'wsl') {
    await sleep(2000)
    spawnPs1Async(buildBatchPositionScript(preHwnds, windows.map(w => w.cell)))
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

    const posArgs = cell ? ['--pos', `${cell.x},${cell.y}`] : []
    const child = spawn('wt.exe', [
      '--window', 'new',
      ...posArgs,
      'new-tab', '--title', label,
      '--', 'wsl.exe', '-d', distro, 'bash', '-l', scriptPath,
    ], { detached: true, stdio: 'ignore', shell: false })
    child.unref()
    setTimeout(() => { try { fs.unlinkSync(scriptPath) } catch {} }, 60000)
  } else {
    const posFlag = cell ? `--pos ${cell.x},${cell.y} ` : ''
    spawnDetached(`wt.exe --window new ${posFlag}new-tab --title "${label}" --startingDirectory "${workDir}" cmd /k claude`)
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

export { sleep }
