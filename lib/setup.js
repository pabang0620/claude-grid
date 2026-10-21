import fs from 'fs'
import path from 'path'
import { input, select } from '@inquirer/prompts'
import search from '@inquirer/search'
import { availableTerminals, terminalDisplayName, monitorLabel } from './detect.js'
import { MAX_WINDOWS } from './config.js'

/**
 * 처음 한 번(또는 --config) 묻는 설정. 결과는 호출한 쪽이 저장한다
 * 반환: { terminal, monitor, count, folder, paths }
 */
export async function askSettings({ platform, monitors, startDir, current = {} }) {
  // ① 터미널: 하나뿐이면 묻지 않는다
  const terminals = availableTerminals(platform)
  const terminal = terminals.length === 1
    ? terminals[0]
    : await select({
        message: '어떤 터미널로 띄울까요?',
        choices: terminals.map((t, i) => ({
          name: i === 0 ? `${terminalDisplayName(t)} (추천)` : terminalDisplayName(t),
          value: t,
        })),
        default: terminals.includes(current.terminal) ? current.terminal : terminals[0],
      })

  // ② 모니터: 한 대면 묻지 않는다
  let monitor = null
  if (monitors.length > 1) {
    const choice = await select({
      message: '어느 모니터에 띄울까요?',
      choices: [
        ...monitors.map((m, idx) => ({ name: monitorLabel(m, idx, monitors.length), value: idx })),
        { name: '모든 모니터에 나눠서', value: 'all' },
      ],
    })
    if (choice === 'all') {
      monitor = 'all'
    } else {
      const m = monitors[choice]
      monitor = { name: m.name, x: m.x, y: m.y, width: m.width, height: m.height }
    }
  }

  // ③ 창 개수
  const countStr = await input({
    message: `창 몇 개를 띄울까요? (1~${MAX_WINDOWS})`,
    default: String(current.count ?? 4),
    validate: (v) => (isValidCount(v) ? true : `1~${MAX_WINDOWS} 사이 숫자를 입력하세요.`),
  })
  const count = parseInt(countStr, 10)

  // ④ 폴더
  const folderMode = await select({
    message: '창들을 어느 폴더에서 열까요?',
    choices: [
      { name: '실행한 위치 (그때그때 지금 폴더)', value: 'cwd' },
      { name: '항상 같은 폴더 (지금 고르기)', value: 'fixed' },
      { name: '창마다 다른 폴더', value: 'each' },
    ],
  })

  let folder = ''
  let paths = []
  if (folderMode === 'fixed') {
    folder = await promptPath('폴더:', startDir)
  } else if (folderMode === 'each') {
    for (let i = 0; i < count; i++) {
      paths.push(await promptPath(`창 ${i + 1} 폴더 (엔터 = 실행한 위치):`, startDir, true))
    }
  }

  return { terminal, monitor, count, folder, paths }
}

export function isValidCount(v) {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= MAX_WINDOWS
}

/**
 * 폴더 자동완성 입력. allowEmpty면 '' (= 실행한 위치)를 고를 수 있다
 */
async function promptPath(message, startDir, allowEmpty = false) {
  const picked = await search({
    message,
    source: async (term) => {
      const text = term ?? ''
      const head = allowEmpty ? [{ name: '(실행한 위치)', value: '' }] : []
      if (!text) {
        return [...head, { name: `${startDir} (여기)`, value: startDir }, ...listDirs(startDir).slice(0, 13)]
      }
      const endsWithSep = text.endsWith('/') || text.endsWith(path.sep)
      const base = endsWithSep ? text : path.dirname(text)
      const fragment = endsWithSep ? '' : path.basename(text).toLowerCase()
      const dirs = listDirs(base).filter((d) => !fragment || path.basename(d.value).toLowerCase().includes(fragment))
      const typed = path.resolve(startDir, text)
      return [
        { name: `↵  ${typed} (이 경로 사용)`, value: typed },
        ...head,
        ...dirs.slice(0, 13),
      ]
    },
  })
  return picked
}

function listDirs(basePath) {
  try {
    const resolved = path.resolve(basePath)
    return fs
      .readdirSync(resolved, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== '__pycache__')
      .map((e) => path.join(resolved, e.name))
      .sort((a, b) => a.localeCompare(b))
      .map((full) => ({ name: full, value: full }))
  } catch {
    return []
  }
}
