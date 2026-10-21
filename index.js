#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadConfig, saveConfig, getPreset, listPresets, hasSettings, CONFIG_PATH, MAX_WINDOWS } from './lib/config.js'
import { detectOS, availableTerminals, detectMonitors, findClaude, terminalDisplayName } from './lib/detect.js'
import { calculateLayout, calculateMultiLayout } from './lib/layout.js'
import { askSettings, isValidCount } from './lib/setup.js'
import { spawnWindows } from './lib/spawn.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 도구 폴더 안에서 실행하면 한 단계 위를 기본 폴더로 쓴다
const START_DIR = process.cwd() === __dirname ? path.dirname(__dirname) : process.cwd()
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'))

const HELP = `
claude-grid ${PKG.version}  Claude Code 창 여러 개를 한 번에 띄워 화면에 나눠 배치합니다

  claude-grid               저장된 설정으로 바로 실행 (처음엔 설정을 한 번 묻습니다)
  claude-grid 8             이번만 창 8개로 실행 (설정은 그대로)
  claude-grid --config      설정 다시 하기 (터미널·모니터·창 개수·폴더)
  claude-grid --show        지금 설정 보기
  claude-grid --config 이름  설정을 "이름" 프리셋으로 따로 저장
  claude-grid 이름          프리셋으로 실행
  claude-grid --list        프리셋 목록

설정 파일: ${CONFIG_PATH}
`

async function main() {
  const [flag, arg] = process.argv.slice(2)
  const platform = detectOS()

  if (flag === '--help' || flag === '-h') return console.log(HELP)
  if (flag === '--version' || flag === '-v') return console.log(PKG.version)
  if (flag === '--list') return printPresets()
  if (flag === '--show') return printSettings(loadConfig())

  if (flag === '--config') {
    const settings = await setup(platform, loadConfig())
    if (arg) {
      const config = loadConfig()
      config.presets = { ...config.presets, [arg]: settings }
      saveConfig(config)
      console.log(`프리셋 "${arg}"을 저장했습니다. 실행: claude-grid ${arg}`)
    } else {
      saveConfig({ ...loadConfig(), ...settings })
      console.log(`설정을 저장했습니다. 다음부터는 claude-grid 만 치면 바로 뜹니다. (${CONFIG_PATH})`)
    }
    return launch(platform, settings)
  }

  let config = loadConfig()
  if (!hasSettings(config) || !availableTerminals(platform).includes(config.terminal)) {
    console.log('\n처음 한 번만 설정합니다. 바꾸고 싶으면 나중에 claude-grid --config\n')
    const settings = await setup(platform, config)
    config = { ...config, ...settings }
    saveConfig(config)
    console.log(`설정을 저장했습니다. (${CONFIG_PATH})`)
  }

  if (flag && isValidCount(flag)) {
    return launch(platform, { ...config, count: parseInt(flag, 10), paths: [] })
  }

  if (flag && !flag.startsWith('-')) {
    const preset = getPreset(flag)
    if (!preset) {
      if (/^\d+$/.test(flag)) throw new Error(`창 개수는 1~${MAX_WINDOWS} 사이로 입력하세요.`)
      throw new Error(`프리셋 "${flag}"이 없습니다. claude-grid --list 로 확인하세요.`)
    }
    // 예전 프리셋은 { count, paths }만 있으므로 기본 설정 위에 덮는다
    return launch(platform, { ...config, ...preset, count: preset.count ?? preset.paths?.length ?? config.count })
  }

  if (flag) throw new Error(`알 수 없는 옵션: ${flag}\n${HELP}`)
  return launch(platform, config)
}

async function setup(platform, current) {
  const monitors = detectMonitors(platform)
  return askSettings({ platform, monitors, startDir: START_DIR, current })
}

function resolveMonitors(platform, saved) {
  const monitors = detectMonitors(platform)
  if (saved === 'all') return monitors
  if (saved && typeof saved === 'object') {
    const byName = monitors.find((m) => m.name === saved.name && m.width === saved.width && m.height === saved.height)
    const byPos = monitors.find((m) => m.x === saved.x && m.y === saved.y)
    const found = byName ?? byPos
    if (found) return [found]
    console.log('저장한 모니터를 찾지 못해 주 모니터에 띄웁니다. (claude-grid --config 로 다시 고를 수 있습니다)')
  }
  return [monitors.find((m) => m.primary) ?? monitors[0]]
}

async function launch(platform, settings) {
  const count = settings.count
  const paths = Array.from({ length: count }, (_, i) => {
    const p = settings.paths?.[i]?.trim() || settings.folder?.trim() || process.cwd()
    return path.resolve(p)
  })
  const missing = [...new Set(paths.filter((p) => !fs.existsSync(p)))]
  if (missing.length) throw new Error(`폴더가 없습니다: ${missing.join(', ')}\nclaude-grid --config 로 폴더를 다시 고르세요.`)

  const monitors = resolveMonitors(platform, settings.monitor)
  const cells = monitors.length > 1 ? calculateMultiLayout(monitors, count) : calculateLayout(monitors[0], count)

  const found = findClaude(platform)
  if (!found) console.log('주의: claude 명령을 찾지 못했습니다. 창은 열리지만 claude가 실행되지 않을 수 있습니다.')

  console.log(`\n${terminalDisplayName(settings.terminal)} 창 ${count}개를 띄우는 중...`)
  const { opened, placed } = await spawnWindows({
    terminal: settings.terminal,
    platform,
    claudeCmd: found ?? 'claude',
    windows: paths.map((p, i) => ({ path: p, cell: cells[i] })),
  })

  if (placed < opened) {
    console.log(`창 ${opened}개 중 ${placed}개만 자리를 맞췄습니다. 나머지는 직접 옮겨 주세요.`)
  } else {
    console.log(`창 ${opened}개를 띄웠습니다.`)
  }
  console.log('설정 바꾸기: claude-grid --config   도움말: claude-grid --help\n')
}

function printSettings(config) {
  if (!hasSettings(config)) return console.log('아직 설정이 없습니다. claude-grid 를 실행하면 처음 한 번 묻습니다.')
  const monitor = config.monitor === 'all'
    ? '모든 모니터에 나눠서'
    : config.monitor
      ? `${config.monitor.width}x${config.monitor.height} (x=${config.monitor.x}, y=${config.monitor.y})`
      : '주 모니터'
  const folder = config.paths?.length
    ? `창마다 다름: ${config.paths.map((p) => p || '(실행한 위치)').join(', ')}`
    : config.folder || '실행한 위치'
  console.log(`
터미널   ${terminalDisplayName(config.terminal)}
모니터   ${monitor}
창 개수  ${config.count}
폴더     ${folder}
프리셋   ${listPresets().join(', ') || '없음'}

설정 파일: ${CONFIG_PATH}`)
}

function printPresets() {
  const names = listPresets()
  if (!names.length) return console.log('저장된 프리셋이 없습니다. 만들기: claude-grid --config 이름')
  console.log('저장된 프리셋:')
  names.forEach((n) => console.log(`  - ${n}`))
}

main().catch((err) => {
  if (err.name === 'ExitPromptError' || err.message?.includes('User force closed')) process.exit(0)
  console.error(`오류: ${err.message}`)
  process.exit(1)
})
