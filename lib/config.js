import fs from 'fs'
import path from 'path'
import os from 'os'

const CONFIG_PATH = path.join(os.homedir(), '.claunch.json')

const DEFAULT_CONFIG = {
  terminal: null,
  monitor: null,
  presets: {},
}

export function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG }
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
  } catch (err) {
    throw new Error(`설정 저장 실패: ${err.message}`)
  }
}

export function savePreset(name, preset) {
  const config = loadConfig()
  config.presets = config.presets ?? {}
  config.presets[name] = preset
  saveConfig(config)
}

export function getPreset(name) {
  const config = loadConfig()
  return config.presets?.[name] ?? null
}

export function listPresets() {
  const config = loadConfig()
  return Object.keys(config.presets ?? {})
}

export function hasDefaultConfig(config) {
  return (
    config.terminal !== null &&
    config.monitor !== null &&
    Array.isArray(config.paths) &&
    config.paths.length > 0
  )
}

export { CONFIG_PATH }
