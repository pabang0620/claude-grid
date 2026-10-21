import { spawnSync } from 'child_process'
import fs from 'fs'

// Windows/WSL 공용 PowerShell 실행기
// 스크립트를 -EncodedCommand로 넘겨 임시 파일·따옴표 이스케이프 문제를 피한다

const POWERSHELL = 'powershell.exe'

// 창 찾기·배치용 Win32 API. DPI 인식을 켜서 실제 픽셀 좌표로 다룬다
export const WIN32_PRELUDE = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class CgWin {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

  public static void DpiAware() {
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch {}
    try { SetProcessDPIAware(); } catch {}
  }

  public static List<long> Terminals() {
    var o = new List<long>();
    EnumWindows((h, p) => {
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      var n = c.ToString();
      if ((n == "CASCADIA_HOSTING_WINDOW_CLASS" || n == "ConsoleWindowClass") && IsWindowVisible(h)) o.Add(h.ToInt64());
      return true;
    }, IntPtr.Zero);
    return o;
  }

  // 보이는 테두리 기준으로 x,y,w,h에 맞춘다 (Windows 10/11의 투명 테두리 보정)
  public static void Place(long hv, int x, int y, int w, int h) {
    var hw = new IntPtr(hv);
    if (IsZoomed(hw)) ShowWindow(hw, 9);
    RECT r, e;
    GetWindowRect(hw, out r);
    int bl = 0, bt = 0, br = 0, bb = 0;
    if (DwmGetWindowAttribute(hw, 9, out e, Marshal.SizeOf(typeof(RECT))) == 0) {
      bl = e.L - r.L; bt = e.T - r.T; br = r.R - e.R; bb = r.B - e.B;
    }
    SetWindowPos(hw, IntPtr.Zero, x - bl, y - bt, w + bl + br, h + bt + bb, 0x0014);
  }
}
"@
[CgWin]::DpiAware()
`

export function runPowerShell(script, { timeout = 120000 } = {}) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  // WSL 폴더(UNC 경로)에서 띄우면 경고가 나므로 C 드라이브에서 실행한다
  const cwd = process.platform !== 'win32' && fs.existsSync('/mnt/c') ? '/mnt/c' : undefined
  const result = spawnSync(
    POWERSHELL,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { encoding: 'utf-8', timeout, windowsHide: true, cwd }
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error((result.stderr || '').trim() || `PowerShell 종료 코드 ${result.status}`)
  }
  return (result.stdout || '').trim()
}

// PowerShell 작은따옴표 문자열 리터럴
export function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}
