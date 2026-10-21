// 창 칸 하나의 목표 가로:세로 비율. 터미널은 약간 가로로 긴 칸이 읽기 편하다
const TARGET_ASPECT = 1.2
// 빈 칸 1개당 감점. 칸이 남는 배치보다 꽉 찬 배치를 우선한다
const EMPTY_CELL_PENALTY = 0.35
// Windows Terminal은 보이는 폭 466px보다 좁아지지 않는다. 이보다 좁은 칸은 겹치므로 피한다
const MIN_CELL_WIDTH = 470

/**
 * 모니터 한 대를 count칸으로 나눈다
 * 마지막 줄이 덜 차면 그 줄의 칸을 가로로 늘려 빈 공간을 없앤다
 * 반환: [{ x, y, width, height }, ...] (왼쪽 위부터 가로 순서)
 */
export function calculateLayout(monitor, count) {
  if (count < 1) return []
  const { x: monX, y: monY, width: monW, height: monH } = monitor
  const { cols, rows } = chooseGrid(count, monW, monH)
  const cells = []

  for (let row = 0; row < rows; row++) {
    const inRow = Math.min(cols, count - row * cols)
    const top = monY + Math.round((row * monH) / rows)
    const bottom = monY + Math.round(((row + 1) * monH) / rows)
    for (let col = 0; col < inRow; col++) {
      const left = monX + Math.round((col * monW) / inRow)
      const right = monX + Math.round(((col + 1) * monW) / inRow)
      cells.push({ x: left, y: top, width: right - left, height: bottom - top })
    }
  }
  return cells
}

export function chooseGrid(count, monW, monH) {
  let best = { cols: 1, rows: count, score: Infinity }
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols)
    const empty = cols * rows - count
    const aspect = monW / cols / (monH / rows)
    const tooNarrow = cols > 1 && monW / cols < MIN_CELL_WIDTH ? 10 : 0
    const score = Math.abs(Math.log(aspect / TARGET_ASPECT)) + empty * EMPTY_CELL_PENALTY + tooNarrow
    if (score < best.score) best = { cols, rows, score }
  }
  return { cols: best.cols, rows: best.rows }
}

/**
 * 여러 모니터에 count개를 넓이 비율대로 나눈 뒤 모니터별로 배치
 */
export function calculateMultiLayout(monitors, count) {
  const shares = splitByArea(monitors, count)
  return monitors.flatMap((m, i) => calculateLayout(m, shares[i]))
}

function splitByArea(monitors, count) {
  const areas = monitors.map((m) => m.width * m.height)
  const total = areas.reduce((a, b) => a + b, 0)
  const exact = areas.map((a) => (a / total) * count)
  const shares = exact.map(Math.floor)
  let left = count - shares.reduce((a, b) => a + b, 0)
  // 나머지는 소수점이 큰 모니터부터, 같으면 주 모니터부터
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v), primary: monitors[i].primary }))
    .sort((a, b) => b.frac - a.frac || Number(b.primary) - Number(a.primary))
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) shares[order[k].i]++
  return shares
}

// AppleScript 문자열 리터럴 안에 넣을 값
function appleString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Mac Terminal.app: 새 창에서 claude 실행 후 배치
 */
export function buildMacTerminalScript(cell, workDir, claudeCmd) {
  const { x, y, width, height } = cell
  return `
tell application "Terminal"
  activate
  do script "cd " & quoted form of ${appleString(workDir)} & " && " & ${appleString(claudeCmd)}
  delay 0.3
  set bounds of front window to {${x}, ${y}, ${x + width}, ${y + height}}
end tell
`.trim()
}

/**
 * Mac iTerm2: 새 창에서 claude 실행 후 배치
 */
export function buildMacITermScript(cell, workDir, claudeCmd) {
  const { x, y, width, height } = cell
  return `
tell application "iTerm"
  activate
  set newWindow to (create window with default profile)
  tell current session of newWindow
    write text "cd " & quoted form of ${appleString(workDir)} & " && " & ${appleString(claudeCmd)}
  end tell
  set bounds of newWindow to {${x}, ${y}, ${x + width}, ${y + height}}
end tell
`.trim()
}
