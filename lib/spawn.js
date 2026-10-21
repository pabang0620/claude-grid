import { execSync, spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildMacTerminalScript, buildMacITermScript } from './layout.js'
import { WIN32_PRELUDE, runPowerShell, psQuote } from './winps.js'

// 새 창이 뜰 때까지 기다리는 최대 시간(초)과 창 사이 간격(ms)
const WINDOW_WAIT_SEC = 20
const MAC_LINUX_DELAY_MS = 400

/**
 * windows: [{ path, cell }] 를 열고 각 칸에 배치한다
 * 반환: { opened, placed } 배치에 성공한 창 수
 */
export async function spawnWindows({ terminal, platform, claudeCmd, windows }) {
  if (platform === 'windows' || platform === 'wsl') {
    return launchOnWindows({ terminal, platform, claudeCmd, windows })
  }
  for (let i = 0; i < windows.length; i++) {
    const { path: workDir, cell } = windows[i]
    if (platform === 'mac') openMacTerminal(terminal, workDir, cell, claudeCmd)
    else openLinuxTerminal(terminal, workDir, cell, `Claude ${i + 1}`, claudeCmd)
    if (i < windows.length - 1) await sleep(MAC_LINUX_DELAY_MS)
  }
  return { opened: windows.length, placed: windows.length }
}

// ─────────────────────────────────────────────
// Windows / WSL
// 하나의 PowerShell 안에서 창을 하나씩 띄우고, 새로 생긴 창을 찾아 정확한 위치로 옮긴다
// Windows Terminal은 뜬 직후 스스로 크기를 한 번 더 바꾸므로 끝에 다시 맞춘다
// ─────────────────────────────────────────────

function launchOnWindows({ terminal, platform, claudeCmd, windows }) {
  const jobs = windows.map((w, i) =>
    platform === 'wsl'
      ? wslJob(terminal, w.path, `Claude ${i + 1}`, w.cell, claudeCmd)
      : windowsJob(terminal, w.path, `Claude ${i + 1}`, w.cell, claudeCmd)
  )
  return runJobs(jobs)
}

/**
 * 탭 모드: Windows Terminal 창 하나에 탭을 count개 열고 탭마다 claude를 띄운다
 * 창은 고른 모니터를 꽉 채우고, 첫 탭이 선택된 상태로 끝난다
 */
export function spawnTabs({ platform, claudeCmd, monitor, paths }) {
  const tabs = paths.map((p, i) => `new-tab --title ${wtArg(`Claude ${i + 1}`)} ${tabCommand(platform, p, claudeCmd)}`)
  const args = `-w -1 ${tabs.join(' ; ')} ; focus-tab -t 0`
  const result = runJobs([{ file: 'wt.exe', args, cell: monitor }])
  return { opened: paths.length, placed: result.placed ? paths.length : 0 }
}

function tabCommand(platform, workDir, claudeCmd) {
  if (platform === 'wsl') {
    const distro = process.env.WSL_DISTRO_NAME || 'Ubuntu'
    return `-- wsl.exe -d ${wtArg(distro)} bash -l ${wtArg(writeWslScript(workDir, claudeCmd))}`
  }
  return `-d ${wtArg(workDir)} -- cmd /k ${winArg(claudeCmd)}`
}

function runJobs(jobs) {
  const jobLines = jobs
    .map((j) => {
      const wd = j.workDir ? `; wd = ${psQuote(j.workDir)}` : ''
      return `@{ file = ${psQuote(j.file)}; args = ${psQuote(j.args)}${wd}; x = ${j.cell.x}; y = ${j.cell.y}; w = ${j.cell.width}; h = ${j.cell.height} }`
    })
    .join(',\n  ')

  const script = `${WIN32_PRELUDE}
$jobs = @(
  ${jobLines}
)
$placed = @()
foreach ($j in $jobs) {
  $before = [CgWin]::Terminals()
  $sp = @{ FilePath = $j.file; ArgumentList = $j.args }
  if ($j.wd) { $sp.WorkingDirectory = $j.wd }
  Start-Process @sp
  $hwnd = 0
  $deadline = (Get-Date).AddSeconds(${WINDOW_WAIT_SEC})
  while (-not $hwnd -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 150
    $new = [CgWin]::Terminals() | Where-Object { $before -notcontains $_ }
    if ($new) { $hwnd = @($new)[0] }
  }
  if ($hwnd) {
    [CgWin]::Place($hwnd, $j.x, $j.y, $j.w, $j.h)
    $placed += ,@($hwnd, $j)
    'ok'
  } else {
    'miss'
  }
}
foreach ($delay in 800, 1500) {
  Start-Sleep -Milliseconds $delay
  foreach ($p in $placed) { $j = $p[1]; [CgWin]::Place($p[0], $j.x, $j.y, $j.w, $j.h) }
}
`
  const timeout = (jobs.length * (WINDOW_WAIT_SEC + 2) + 30) * 1000
  const out = runPowerShell(script, { timeout })
  const lines = out.split(/\r?\n/).map((l) => l.trim())
  return {
    opened: jobs.length,
    placed: lines.filter((l) => l === 'ok').length,
  }
}

// Windows 명령줄 인자 하나를 큰따옴표로 감싼다 (끝의 역슬래시는 두 번 써야 따옴표가 안 깨진다)
function winArg(value) {
  const s = String(value)
  if (s && !/[\s"]/.test(s)) return s
  return `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`
}

// Windows Terminal은 ';'를 명령 구분자로 쓴다
function wtArg(value) {
  return winArg(String(value).replace(/;/g, '\\;'))
}

function wslJob(terminal, workDir, label, cell, claudeCmd) {
  const script = writeWslScript(workDir, claudeCmd)
  const distro = process.env.WSL_DISTRO_NAME || 'Ubuntu'
  const inner = ['-d', wtArg(distro), 'bash', '-l', wtArg(script)].join(' ')
  if (terminal === 'windowsterminal') {
    return {
      file: 'wt.exe',
      args: `-w -1 new-tab --title ${wtArg(label)} -- wsl.exe ${inner}`,
      cell,
    }
  }
  return { file: 'wsl.exe', args: inner, cell }
}

function windowsJob(terminal, workDir, label, cell, claudeCmd) {
  const claude = winArg(claudeCmd)
  if (terminal === 'windowsterminal') {
    return {
      file: 'wt.exe',
      args: `-w -1 new-tab --title ${wtArg(label)} --startingDirectory ${wtArg(workDir)} cmd /k ${claude}`,
      cell,
    }
  }
  if (terminal === 'powershell') {
    return {
      file: 'powershell.exe',
      args: `-NoExit -Command "& ${psQuote(claudeCmd)}"`,
      workDir,
      cell,
    }
  }
  return { file: 'cmd.exe', args: `/k ${claude}`, workDir, cell }
}

// 새 창에서 실행할 bash 스크립트. 실행되면 스스로 지운다
function writeWslScript(workDir, claudeCmd) {
  const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`
  const scriptPath = path.join(os.tmpdir(), `claude-grid-${process.pid}-${Math.random().toString(36).slice(2)}.sh`)
  const content = [
    'rm -f "$0"',
    '[ -f ~/.bashrc ] && . ~/.bashrc >/dev/null 2>&1',
    'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"',
    '[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1',
    `cd ${q(workDir)} || echo "폴더를 열 수 없습니다: ${workDir.replace(/"/g, '')}"`,
    `${q(claudeCmd)} || echo "claude를 실행하지 못했습니다. 설치되어 있는지 확인하세요."`,
    'exec bash -l',
  ].join('\n') + '\n'
  fs.writeFileSync(scriptPath, content, { encoding: 'utf-8', mode: 0o700 })
  return scriptPath
}

// ─────────────────────────────────────────────
// Mac
// ─────────────────────────────────────────────

function openMacTerminal(terminal, workDir, cell, claudeCmd) {
  const script = terminal === 'iterm2'
    ? buildMacITermScript(cell, workDir, claudeCmd)
    : buildMacTerminalScript(cell, workDir, claudeCmd)
  execSync('osascript -', { input: script, stdio: ['pipe', 'pipe', 'pipe'] })
}

// ─────────────────────────────────────────────
// Linux (X11에서는 --geometry로 위치를 준다)
// ─────────────────────────────────────────────

const CELL_WIDTH_PX = 9
const CELL_HEIGHT_PX = 19

function geometry(cell) {
  const cols = Math.max(20, Math.floor((cell.width - 20) / CELL_WIDTH_PX))
  const rows = Math.max(8, Math.floor((cell.height - 60) / CELL_HEIGHT_PX))
  return `${cols}x${rows}+${cell.x}+${cell.y}`
}

function openLinuxTerminal(terminal, workDir, cell, label, claudeCmd) {
  // 경로·명령은 bash 인자로 넘겨서 따옴표 문제를 피한다
  const run = ['bash', '-lc', 'cd "$1" && "$2"; exec bash', 'claude-grid', workDir, claudeCmd]
  let args
  if (terminal === 'gnome-terminal') {
    args = ['gnome-terminal', `--geometry=${geometry(cell)}`, `--title=${label}`, '--', ...run]
  } else if (terminal === 'konsole') {
    args = ['konsole', '--workdir', workDir, '-e', ...run]
  } else {
    args = ['xterm', '-geometry', geometry(cell), '-title', label, '-e', ...run]
  }
  const child = spawn(args[0], args.slice(1), { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
