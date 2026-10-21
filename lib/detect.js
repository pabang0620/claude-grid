import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import { WIN32_PRELUDE, runPowerShell } from './winps.js'

const FALLBACK_MONITOR = { name: 'default', x: 0, y: 0, width: 1920, height: 1080, primary: true }

function isWSL() {
  try {
    if (process.env.WSL_DISTRO_NAME) return true
    const version = fs.readFileSync('/proc/version', 'utf-8').toLowerCase()
    return version.includes('microsoft')
  } catch {
    return false
  }
}

export function detectOS() {
  const platform = process.platform
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'mac'
  if (isWSL()) return 'wsl'
  return 'linux'
}

function hasCommand(cmd, platform) {
  const finder = platform === 'windows' ? 'where' : 'which'
  const result = spawnSync(finder, [cmd], { stdio: 'pipe' })
  return result.status === 0
}

/**
 * 이 OS에서 고를 수 있는 터미널 목록 (설치된 것만, 추천 순)
 */
export function availableTerminals(platform) {
  if (platform === 'windows') {
    const list = []
    if (hasCommand('wt.exe', platform)) list.push('windowsterminal')
    list.push('powershell', 'cmd')
    return list
  }
  if (platform === 'wsl') {
    const list = []
    if (hasCommand('wt.exe', platform)) list.push('windowsterminal')
    list.push('console')
    return list
  }
  if (platform === 'mac') {
    const list = []
    if (fs.existsSync('/Applications/iTerm.app')) list.push('iterm2')
    list.push('terminal')
    return list
  }
  const list = ['gnome-terminal', 'konsole', 'xterm'].filter((t) => hasCommand(t, platform))
  return list.length ? list : ['xterm']
}

export function detectTerminal(platform) {
  return availableTerminals(platform)[0]
}

export function terminalDisplayName(terminal) {
  const map = {
    windowsterminal: 'Windows Terminal',
    console: '기본 콘솔 창',
    powershell: 'PowerShell',
    cmd: 'CMD',
    terminal: 'Terminal.app',
    iterm2: 'iTerm2',
    'gnome-terminal': 'GNOME Terminal',
    konsole: 'Konsole',
    xterm: 'xterm',
  }
  return map[terminal] ?? terminal
}

/**
 * 모니터 목록 (작업 표시줄을 뺀 영역, 왼쪽 → 오른쪽 순)
 */
export function detectMonitors(platform) {
  let monitors = []
  try {
    if (platform === 'windows' || platform === 'wsl') monitors = detectWindowsMonitors()
    else if (platform === 'mac') monitors = detectMacMonitors()
    else monitors = detectLinuxMonitors()
  } catch {
    monitors = []
  }
  if (!monitors.length) return [{ ...FALLBACK_MONITOR }]
  return monitors.sort((a, b) => a.x - b.x || a.y - b.y)
}

function detectWindowsMonitors() {
  const script = `${WIN32_PRELUDE}
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  $w = $_.WorkingArea
  "$($_.DeviceName)|$($w.X)|$($w.Y)|$($w.Width)|$($w.Height)|$($_.Primary)"
}`
  return runPowerShell(script, { timeout: 30000 })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, x, y, width, height, primary] = line.trim().split('|')
      return {
        name,
        x: parseInt(x, 10),
        y: parseInt(y, 10),
        width: parseInt(width, 10),
        height: parseInt(height, 10),
        primary: primary?.toLowerCase() === 'true',
      }
    })
    .filter((m) => m.width > 0 && m.height > 0)
}

function detectMacMonitors() {
  // NSScreen visibleFrame: 메뉴 막대·Dock을 뺀 영역. 좌표를 위→아래 기준으로 바꾼다
  const script = `
ObjC.import('AppKit')
const screens = $.NSScreen.screens
const main = screens.objectAtIndex(0).frame
const out = []
for (let i = 0; i < screens.count; i++) {
  const s = screens.objectAtIndex(i)
  const v = s.visibleFrame
  out.push([i, v.origin.x, main.size.height - v.origin.y - v.size.height, v.size.width, v.size.height].join('|'))
}
out.join('\\n')`
  const raw = execSync('osascript -l JavaScript -', { input: script, encoding: 'utf-8', stdio: 'pipe' })
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [idx, x, y, width, height] = line.split('|').map(Number)
      return { name: `screen${idx}`, x, y, width, height, primary: idx === 0 }
    })
}

function detectLinuxMonitors() {
  // 예: "DP-1 connected primary 1920x1080+0+0 ..."
  const raw = execSync('xrandr --query', { encoding: 'utf-8', stdio: 'pipe' })
  return raw
    .split('\n')
    .map((line) => line.match(/^(\S+) connected (primary )?(\d+)x(\d+)\+(-?\d+)\+(-?\d+)/))
    .filter(Boolean)
    .map((m) => ({
      name: m[1],
      x: parseInt(m[5], 10),
      y: parseInt(m[6], 10),
      width: parseInt(m[3], 10),
      height: parseInt(m[4], 10),
      primary: Boolean(m[2]),
    }))
}

export function monitorLabel(monitor, idx, total) {
  const size = `${monitor.width}x${monitor.height}`
  const main = monitor.primary ? ', 주 모니터' : ''
  if (total === 1) return `기본 모니터 (${size})`
  if (total === 2) return `${idx === 0 ? '왼쪽' : '오른쪽'} 모니터 (${size}${main})`
  return `모니터 ${idx + 1} (왼쪽부터, ${size}${main})`
}

/**
 * claude 실행 파일 위치. 못 찾으면 null
 */
export function findClaude(platform) {
  try {
    if (platform === 'windows') {
      const r = spawnSync('where', ['claude'], { encoding: 'utf-8', stdio: 'pipe' })
      return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null
    }
    const r = spawnSync('bash', ['-lc', 'command -v claude'], { encoding: 'utf-8', stdio: 'pipe', timeout: 10000 })
    const found = (r.stdout || '').trim().split('\n').pop()
    return found && found.startsWith('/') ? found : null
  } catch {
    return null
  }
}
