import { execSync } from 'child_process'
import fs from 'fs'

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

export function detectTerminal(os) {
  if (os === 'windows') return detectWindowsTerminal()
  if (os === 'wsl') return detectWSLTerminal()
  if (os === 'mac') return detectMacTerminal()
  return detectLinuxTerminal()
}

function detectWSLTerminal() {
  try {
    execSync('which wt.exe', { stdio: 'pipe' })
    return 'windowsterminal'
  } catch {}
  try {
    execSync('which powershell.exe', { stdio: 'pipe' })
    return 'powershell'
  } catch {}
  return 'cmd'
}

function detectWindowsTerminal() {
  // Windows Terminal 감지: wt.exe 존재 여부
  try {
    execSync('where wt.exe', { stdio: 'pipe' })
    return 'windowsterminal'
  } catch {
    // fallback: PowerShell
    try {
      execSync('where powershell.exe', { stdio: 'pipe' })
      return 'powershell'
    } catch {
      return 'cmd'
    }
  }
}

function detectMacTerminal() {
  // iTerm2 감지
  if (fs.existsSync('/Applications/iTerm.app')) {
    return 'iterm2'
  }
  return 'terminal'
}

function detectLinuxTerminal() {
  const candidates = [
    ['gnome-terminal', 'gnome-terminal'],
    ['konsole', 'konsole'],
    ['xterm', 'xterm'],
  ]
  for (const [cmd, name] of candidates) {
    try {
      execSync(`which ${cmd}`, { stdio: 'pipe' })
      return name
    } catch {
      // 계속 시도
    }
  }
  return 'xterm'
}

export async function detectMonitors(os) {
  if (os === 'windows') return detectWindowsMonitors()
  if (os === 'wsl') return detectWSLMonitors()
  if (os === 'mac') return detectMacMonitors()
  // Linux: 기본 단일 모니터로 처리
  return [{ id: 0, x: 0, y: 0, width: 1920, height: 1080, primary: true }]
}

function detectWSLMonitors() {
  try {
    const script = `Add-Type -AssemblyName System.Windows.Forms; $screens = [System.Windows.Forms.Screen]::AllScreens; $result = @(); foreach ($s in $screens) { $result += "$($s.Bounds.X),$($s.Bounds.Y),$($s.Bounds.Width),$($s.Bounds.Height),$($s.Primary)" }; $result -join ';'`
    const raw = execSync(`powershell.exe -Command "${script}"`, {
      stdio: 'pipe',
      encoding: 'utf-8',
    }).trim()
    if (!raw) throw new Error('empty')
    const monitors = raw.split(';').filter(Boolean).map((line, idx) => {
      const [x, y, width, height, primary] = line.split(',')
      return {
        id: idx,
        x: parseInt(x),
        y: parseInt(y),
        width: parseInt(width),
        height: parseInt(height),
        primary: primary?.trim().toLowerCase() === 'true',
      }
    })
    monitors.sort((a, b) => a.x - b.x)
    return monitors
  } catch {
    return [{ id: 0, x: 0, y: 0, width: 1920, height: 1080, primary: true }]
  }
}

function detectWindowsMonitors() {
  try {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$screens = [System.Windows.Forms.Screen]::AllScreens
$result = @()
foreach ($s in $screens) {
  $result += "$($s.Bounds.X),$($s.Bounds.Y),$($s.Bounds.Width),$($s.Bounds.Height),$($s.Primary)"
}
$result -join ';'
`
    const raw = execSync(`powershell -Command "${script.replace(/\n/g, ' ')}"`, {
      stdio: 'pipe',
      encoding: 'utf-8',
    }).trim()

    if (!raw) throw new Error('모니터 정보 없음')

    const monitors = raw.split(';').filter(Boolean).map((line, idx) => {
      const [x, y, width, height, primary] = line.split(',')
      return {
        id: idx,
        x: parseInt(x),
        y: parseInt(y),
        width: parseInt(width),
        height: parseInt(height),
        primary: primary?.trim().toLowerCase() === 'true',
      }
    })

    // x 좌표 기준 정렬 (왼쪽 → 오른쪽)
    monitors.sort((a, b) => a.x - b.x)
    return monitors
  } catch {
    // 감지 실패 시 기본값
    return [{ id: 0, x: 0, y: 0, width: 1920, height: 1080, primary: true }]
  }
}

function detectMacMonitors() {
  try {
    const script = `
tell application "Finder"
  set _screens to {}
  set desktopBounds to bounds of window of desktop
  return desktopBounds
end tell
`
    // system_profiler로 디스플레이 개수 확인
    const raw = execSync('system_profiler SPDisplaysDataType 2>/dev/null | grep "Resolution"', {
      stdio: 'pipe',
      encoding: 'utf-8',
    })
    const resolutions = raw.trim().split('\n').filter(Boolean)

    if (resolutions.length <= 1) {
      return [{ id: 0, x: 0, y: 0, width: 1920, height: 1080, primary: true }]
    }

    // 멀티 모니터: osascript로 정확한 좌표 조회 시도
    try {
      const boundsRaw = execSync(
        `osascript -e 'tell application "Finder" to get bounds of window of desktop'`,
        { stdio: 'pipe', encoding: 'utf-8' }
      ).trim()
      const [x, y, w, h] = boundsRaw.split(', ').map(Number)
      const monitors = [{ id: 0, x: 0, y: 0, width: w, height: h, primary: true }]
      if (resolutions.length >= 2) {
        monitors.push({ id: 1, x: w, y: 0, width: w, height: h, primary: false })
      }
      return monitors
    } catch {
      return resolutions.map((_, idx) => ({
        id: idx,
        x: idx * 1920,
        y: 0,
        width: 1920,
        height: 1080,
        primary: idx === 0,
      }))
    }
  } catch {
    return [{ id: 0, x: 0, y: 0, width: 1920, height: 1080, primary: true }]
  }
}

export function monitorLabel(monitor, idx, total) {
  if (total === 1) return '기본 모니터'
  if (total === 2) return idx === 0 ? '왼쪽 모니터' : '오른쪽 모니터'
  return `모니터 ${idx + 1}`
}
