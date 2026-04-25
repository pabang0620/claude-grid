#!/usr/bin/env node
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 스크립트 자신의 폴더에서 실행 시 한 단계 위 디렉토리를 기본으로 사용
const START_DIR = process.cwd() === __dirname ? path.dirname(__dirname) : process.cwd()
import { input, select } from '@inquirer/prompts'
import search from '@inquirer/search'
import {
  loadConfig,
  saveConfig,
  savePreset,
  getPreset,
  listPresets,
  hasDefaultConfig,
  CONFIG_PATH,
} from './lib/config.js'
import { detectOS, detectTerminal, detectMonitors, monitorLabel } from './lib/detect.js'
import { calculateLayout } from './lib/layout.js'
import { spawnWindows } from './lib/spawn.js'

const args = process.argv.slice(2)

async function main() {
  const flag = args[0]

  // --list: 프리셋 목록 출력
  if (flag === '--list') {
    const names = listPresets()
    if (names.length === 0) {
      console.log('저장된 프리셋이 없습니다.')
      console.log('npx claunch 를 실행해 설정을 저장해보세요.')
    } else {
      console.log('저장된 프리셋:')
      names.forEach((n) => console.log(`  - ${n}`))
    }
    return
  }

  // --config: 강제 재설정
  if (flag === '--config') {
    await runInteractive()
    return
  }

  // <프리셋 이름>: 해당 프리셋 바로 실행
  if (flag && !flag.startsWith('--')) {
    const preset = getPreset(flag)
    if (!preset) {
      console.error(`프리셋 "${flag}"을 찾을 수 없습니다.`)
      console.log('npx claunch --list 로 저장된 프리셋을 확인하세요.')
      process.exit(1)
    }
    const config = loadConfig()
    const platform = detectOS()
    const terminal = config.terminal ?? detectTerminal(platform)
    await runWithSettings({
      terminal,
      os: platform,
      monitor: null,
      count: preset.count,
      paths: preset.paths,
    })
    return
  }

  // 기본 실행: 저장된 기본 설정이 있으면 바로 실행
  const config = loadConfig()
  if (hasDefaultConfig(config)) {
    const platform = detectOS()
    const monitors = await detectMonitors(platform)
    const monitor = pickMonitorById(monitors, config.monitor) ?? monitors[0]
    await runWithSettings({
      terminal: config.terminal ?? detectTerminal(platform),
      os: platform,
      monitor,
      count: config.paths.length,
      paths: config.paths,
    })
    return
  }

  // 최초 실행: 인터랙티브 설정
  await runInteractive()
}

async function runInteractive() {
  console.log('\nWelcome to claunch\n')

  const platform = detectOS()
  let terminal = detectTerminal(platform)
  const monitors = await detectMonitors(platform)

  // 감지된 터미널을 기본값으로 제시하고 변경 가능하게 선택
  const allChoices = terminalChoices(platform)
  const otherChoices = allChoices
    .filter((t) => t !== terminal)
    .map((t) => ({ name: terminalDisplayName(t), value: t }))

  terminal = await select({
    message: `터미널 감지됨: ${terminalDisplayName(terminal)} — 맞나요?`,
    choices: [
      { name: `${terminalDisplayName(terminal)} (감지됨)`, value: terminal },
      ...otherChoices,
    ],
  })

  // 모니터 선택 (2개 이상일 때)
  let selectedMonitor = monitors[0]
  if (monitors.length >= 2) {
    const monitorIdx = await select({
      message: '사용할 모니터를 선택하세요:',
      choices: monitors.map((m, idx) => ({
        name: monitorLabel(m, idx, monitors.length),
        value: idx,
      })),
    })
    selectedMonitor = monitors[monitorIdx]
  }

  // 창 개수
  const countStr = await input({
    message: '창 개수 (1~6):',
    default: '4',
    validate: (v) => {
      const n = parseInt(v)
      if (isNaN(n) || n < 1 || n > 6) return '1~6 사이의 숫자를 입력하세요.'
      return true
    },
  })
  const count = parseInt(countStr)

  // 각 창 경로 입력 (search 기반 자동완성)
  const paths = []
  for (let i = 0; i < count; i++) {
    const dir = await promptPath(`창 ${i + 1} 경로 (엔터 = 현재 경로):`, START_DIR)
    paths.push(dir?.trim() ?? '')
  }

  // 프리셋 저장 여부
  const saveChoice = await select({
    message: '이 설정을 저장할까요?',
    choices: [
      { name: '저장 안 함', value: 'no' },
      { name: '기본 설정으로 저장 (다음번 바로 실행)', value: 'default' },
      { name: '프리셋으로 저장 (이름 지정)', value: 'preset' },
    ],
  })

  const config = loadConfig()
  config.terminal = terminal
  config.monitor = selectedMonitor.id

  if (saveChoice === 'default') {
    config.paths = paths
    saveConfig(config)
    console.log(`설정이 저장되었습니다. (${CONFIG_PATH})`)
  } else if (saveChoice === 'preset') {
    const presetName = await input({
      message: '프리셋 이름:',
      validate: (v) => (v.trim() ? true : '이름을 입력하세요.'),
    })
    config.presets = config.presets ?? {}
    config.presets[presetName.trim()] = { count, paths }
    saveConfig(config)
    console.log(`프리셋 "${presetName.trim()}"이 저장되었습니다.`)
  } else {
    saveConfig(config)
  }

  await runWithSettings({
    terminal,
    os: platform,
    monitor: selectedMonitor,
    count,
    paths,
  })

  printAliasHint(platform)
}

/**
 * search 프롬프트로 디렉토리 자동완성
 */
async function promptPath(message, defaultPath) {
  let currentInput = ''

  const dir = await search({
    message,
    source: async (input) => {
      currentInput = input ?? ''

      if (!currentInput) {
        return [
          { name: `(현재 경로) ${defaultPath}`, value: '' },
          ...listDirs(defaultPath).slice(0, 14),
        ]
      }

      // 절대 경로 또는 상대 경로에 따라 탐색
      const base = currentInput.endsWith(path.sep) || currentInput.endsWith('/')
        ? currentInput
        : path.dirname(currentInput)

      const fragment = currentInput.endsWith(path.sep) || currentInput.endsWith('/')
        ? ''
        : path.basename(currentInput)

      const dirs = listDirs(base)
      const filtered = fragment
        ? dirs.filter((d) => d.value.toLowerCase().includes(fragment.toLowerCase()))
        : dirs

      return [
        { name: `↵  ${currentInput} (이 경로 사용)`, value: currentInput },
        { name: `(현재 경로) ${defaultPath}`, value: '' },
        ...filtered.slice(0, 13),
      ]
    },
  })

  return dir
}

/**
 * 지정 경로의 하위 디렉토리 목록 반환
 */
function listDirs(basePath) {
  try {
    const resolved = path.resolve(basePath)
    if (!fs.existsSync(resolved)) return []
    const stat = fs.statSync(resolved)
    if (!stat.isDirectory()) return []

    const entries = fs.readdirSync(resolved, { withFileTypes: true })
    return entries
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith('.') &&
          e.name !== 'node_modules' &&
          e.name !== '__pycache__'
      )
      .map((e) => {
        const full = path.join(resolved, e.name)
        return { name: full, value: full }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

async function runWithSettings({ terminal, os: platform, monitor, count, paths }) {
  // monitor가 null이면 재감지
  let activeMonitor = monitor
  if (!activeMonitor) {
    const monitors = await detectMonitors(platform)
    const config = loadConfig()
    activeMonitor = pickMonitorById(monitors, config.monitor) ?? monitors[0]
  }

  const resolvedPaths = paths.map((p) => (p?.trim() ? p.trim() : process.cwd()))
  const layout = calculateLayout(activeMonitor, resolvedPaths.length)

  const windows = resolvedPaths.map((p, i) => ({
    path: p,
    cell: layout[i],
  }))

  console.log(`\n배치 중... (${windows.length}개 창)`)

  await spawnWindows(terminal, platform, windows)

  console.log('완료')
}

function pickMonitorById(monitors, id) {
  if (id === null || id === undefined) return null
  return monitors.find((m) => m.id === id) ?? null
}

function terminalDisplayName(terminal) {
  const map = {
    windowsterminal: 'Windows Terminal',
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

function terminalChoices(platform) {
  if (platform === 'windows' || platform === 'wsl') {
    return ['windowsterminal', 'powershell', 'cmd']
  }
  if (platform === 'mac') {
    return ['iterm2', 'terminal']
  }
  return ['gnome-terminal', 'konsole', 'xterm']
}

function printAliasHint(os) {
  console.log('\n더 빠르게 실행하려면 alias를 추가하세요:')
  if (os === 'windows') {
    console.log('  PowerShell: Set-Alias cl "npx claunch"')
    console.log('  $PROFILE 파일에 추가하면 영구 적용됩니다.')
  } else {
    console.log('  alias cl="npx claunch"')
    console.log('  ~/.zshrc 또는 ~/.bashrc에 추가하면 cl 한 글자로 실행 가능합니다.')
  }
  console.log('  자세한 방법: README 참고\n')
}

main().catch((err) => {
  if (err.name === 'ExitPromptError' || err.message?.includes('User force closed')) {
    process.exit(0)
  }
  console.error('오류:', err.message)
  process.exit(1)
})
