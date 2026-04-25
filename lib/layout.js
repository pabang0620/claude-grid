/**
 * count에 따른 격자 레이아웃 계산
 * 반환: [{ x, y, width, height }, ...]
 */
export function calculateLayout(monitor, count) {
  const { x: monX, y: monY, width: monW, height: monH } = monitor

  const grid = getGrid(count, monW, monH)
  const cells = []

  for (let i = 0; i < count; i++) {
    const col = i % grid.cols
    const row = Math.floor(i / grid.cols)

    // 5개 레이아웃 특수 처리: 좌 2개 + 우 3개
    if (count === 5) {
      cells.push(fiveLayout(i, monX, monY, monW, monH))
      continue
    }

    const cellW = Math.floor(monW / grid.cols)
    const cellH = Math.floor(monH / grid.rows)

    cells.push({
      x: monX + col * cellW,
      y: monY + row * cellH,
      width: cellW,
      height: cellH,
    })
  }

  return cells
}

function getGrid(count, monW, monH) {
  const isLandscape = monW >= monH

  switch (count) {
    case 1:
      return { cols: 1, rows: 1 }
    case 2:
      return isLandscape ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 }
    case 3:
      return { cols: 2, rows: 2 } // 4칸 중 3칸 사용 (마지막 칸 비움)
    case 4:
      return { cols: 2, rows: 2 }
    case 5:
      return { cols: 2, rows: 3 } // 특수 처리
    case 6:
      return isLandscape ? { cols: 3, rows: 2 } : { cols: 2, rows: 3 }
    default:
      return { cols: 2, rows: Math.ceil(count / 2) }
  }
}

/**
 * 5개 레이아웃: 좌 2개(위/아래) + 우 3개(위/중/아래)
 */
function fiveLayout(i, monX, monY, monW, monH) {
  const halfW = Math.floor(monW / 2)
  const thirdH = Math.floor(monH / 3)
  const halfH = Math.floor(monH / 2)

  if (i === 0) return { x: monX, y: monY, width: halfW, height: halfH }
  if (i === 1) return { x: monX, y: monY + halfH, width: halfW, height: monH - halfH }
  if (i === 2) return { x: monX + halfW, y: monY, width: monW - halfW, height: thirdH }
  if (i === 3) return { x: monX + halfW, y: monY + thirdH, width: monW - halfW, height: thirdH }
  return {
    x: monX + halfW,
    y: monY + thirdH * 2,
    width: monW - halfW,
    height: monH - thirdH * 2,
  }
}

/**
 * Windows: PowerShell로 SetWindowPos 실행
 * hwnd가 null이면 GetForegroundWindow 사용
 */
export function buildWindowsPosScript(cell) {
  const { x, y, width, height } = cell
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
}
"@
$hwnd = [Win32]::GetForegroundWindow()
[Win32]::SetWindowPos($hwnd, [IntPtr]::Zero, ${x}, ${y}, ${width}, ${height}, 0x0040)
`.trim()
}

/**
 * Mac Terminal.app: osascript 창 배치
 */
export function buildMacTerminalScript(cell, workDir) {
  const { x, y, width, height } = cell
  const right = x + width
  const bottom = y + height
  const escapedPath = workDir.replace(/"/g, '\\"')
  return `
tell application "Terminal"
  activate
  do script "cd \\"${escapedPath}\\" && claude"
  delay 0.3
  set bounds of front window to {${x}, ${y}, ${right}, ${bottom}}
end tell
`.trim()
}

/**
 * Mac iTerm2: osascript 창 배치
 */
export function buildMacITermScript(cell, workDir) {
  const { x, y, width, height } = cell
  const right = x + width
  const bottom = y + height
  const escapedPath = workDir.replace(/"/g, '\\"')
  return `
tell application "iTerm"
  activate
  create window with default profile
  tell current session of current window
    write text "cd \\"${escapedPath}\\" && claude"
  end tell
  set bounds of current window to {${x}, ${y}, ${right}, ${bottom}}
end tell
`.trim()
}
