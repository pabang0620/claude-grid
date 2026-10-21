import fs from 'fs'
import path from 'path'
import os from 'os'

// 설정 파일. CLAUDE_GRID_CONFIG 환경변수로 다른 위치를 쓸 수 있다
const CONFIG_PATH = process.env.CLAUDE_GRID_CONFIG || path.join(os.homedir(), '.claude-grid.json')
// 0.2.0 이하가 쓰던 파일. 새 파일이 없으면 한 번 읽어서 옮긴다
const LEGACY_PATH = path.join(os.homedir(), '.claunch.json')

export const MAX_WINDOWS = 20

const DEFAULT_CONFIG = {
  terminal: null,
  // 'all' = 모든 모니터에 나눠서, 객체 = 모니터 한 대 { name, x, y, width, height }, null = 주 모니터
  monitor: null,
  count: null,
  // '' = 실행한 위치, 그 밖에는 모든 창이 여는 폴더
  folder: '',
  // 창마다 폴더를 다르게 쓸 때만 채운다 (count개)
  paths: [],
  presets: {},
}

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

// 예전 형식 { terminal, monitor: 번호, paths: [...] } 을 새 형식으로 바꾼다
function migrateLegacy(old) {
  const paths = Array.isArray(old.paths) ? old.paths : []
  return {
    ...DEFAULT_CONFIG,
    terminal: old.terminal ?? null,
    count: paths.length || null,
    paths: paths.some((p) => p?.trim()) ? paths : [],
    presets: old.presets ?? {},
  }
}

export function loadConfig() {
  const current = readJson(CONFIG_PATH)
  if (current) return { ...DEFAULT_CONFIG, ...current }
  if (!process.env.CLAUDE_GRID_CONFIG) {
    const legacy = readJson(LEGACY_PATH)
    if (legacy) return migrateLegacy(legacy)
  }
  return { ...DEFAULT_CONFIG }
}

export function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  } catch (err) {
    throw new Error(`설정 저장 실패: ${err.message}`)
  }
}

export function getPreset(name) {
  return loadConfig().presets?.[name] ?? null
}

export function listPresets() {
  return Object.keys(loadConfig().presets ?? {})
}

export function hasSettings(config) {
  return Boolean(config.terminal) && Number.isInteger(config.count) && config.count > 0
}

export { CONFIG_PATH }
