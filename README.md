# claude-grid

**Open several Claude Code sessions at once, tiled across your monitors, with one command.**

<p align="center">
  <img src="https://raw.githubusercontent.com/pabang0620/claude-grid/main/promo/demo.gif" alt="claude-grid opening 8 Claude Code sessions tiled on screen, then 12, then across two monitors, then as tabs in one window" width="800">
</p>

```bash
npx claude-grid
```

The first run asks a few questions (terminal, tiled windows or tabs, monitor, how many, which folder) and saves the answers. Every run after that opens the windows right away. claude-grid launches each terminal, finds the new window, and moves it into its grid cell, so 4, 8 or 20 windows line up edge to edge.

- Windows Terminal on Windows and WSL, macOS Terminal.app / iTerm2, Linux GNOME Terminal / Konsole / xterm
- 1 to 20 windows, on one monitor or spread across all of them
- Tabs mode (Windows Terminal): one window with a tab per session, switch like browser tabs
- `npx claude-grid 8` opens 8 windows this time without changing your saved setup

Video version (MP4, 17s): [promo/claude-grid-promo.mp4](promo/claude-grid-promo.mp4)

> The npm package named `claunch` is an unrelated project. Use `claude-grid`.

---

## 설명서 (한국어)

Claude Code 창 여러 개를 한 번에 띄워 모니터에 빈틈없이 나눠 배치합니다.

### 처음 실행

```bash
npx claude-grid
```

처음 한 번만 아래를 묻고 저장합니다. 설치된 터미널이 하나뿐이거나 모니터가 한 대면 그 질문은 건너뜁니다.

1. 터미널 (Windows Terminal 추천)
2. 띄우는 방식 (Windows Terminal일 때만 묻습니다)
   - 창 여러 개로 나눠 배치: 한눈에 다 보기
   - 창 하나에 탭 여러 개: 크롬 탭처럼 위쪽 탭으로 넘겨 보기 (Ctrl+Tab)
3. 모니터 (한 대 고르기, 또는 "모든 모니터에 나눠서")
4. 개수 (1~20)
5. 폴더
   - 실행한 위치: 명령을 친 폴더에서 엽니다
   - 항상 같은 폴더: 지금 고른 폴더에서 항상 엽니다
   - 창마다 다른 폴더: 창별로 고릅니다

### 다음부터

```bash
npx claude-grid        # 저장한 설정 그대로 바로 실행
npx claude-grid 10     # 이번만 10개 (설정은 그대로)
```

### 설정 바꾸기

| 명령 | 하는 일 |
|------|---------|
| `claude-grid --config` | 처음 질문을 다시 묻고 저장한 뒤 실행 |
| `claude-grid --tabs` | 이번만 창 하나에 탭 여러 개로 |
| `claude-grid --windows` | 이번만 창 여러 개로 나눠 배치 |
| `claude-grid --show` | 지금 설정 보기 |
| `claude-grid --config 이름` | 설정을 "이름" 프리셋으로 따로 저장 |
| `claude-grid 이름` | 프리셋으로 실행 |
| `claude-grid --list` | 프리셋 목록 |
| `claude-grid --help` | 도움말 |

설정 파일은 `~/.claude-grid.json`입니다. 직접 고쳐도 됩니다.

```json
{
  "terminal": "windowsterminal",
  "layout": "windows",
  "monitor": "all",
  "count": 8,
  "folder": "/home/me/project",
  "paths": [],
  "presets": {
    "fullstack": { "count": 2, "paths": ["/home/me/app/front", "/home/me/app/back"] }
  }
}
```

- `layout`: `"windows"`는 창 여러 개, `"tabs"`는 창 하나에 탭 여러 개
- `monitor`: `"all"`은 모든 모니터에 나눠서, `null`은 주 모니터 (탭 방식은 고른 모니터 하나에 창을 꽉 채웁니다)
- `folder`: `""`이면 실행한 위치
- `paths`: 창마다 폴더를 다르게 쓸 때만 채웁니다. 비어 있는 칸은 `folder`를 씁니다

예전 버전 설정(`~/.claunch.json`)이 있으면 그대로 읽어 씁니다.

### 배치 방식

모니터 크기에 맞춰 칸이 너무 좁거나 납작해지지 않게 줄·칸 수를 고르고, 마지막 줄이 덜 차면 그 줄 창을 가로로 늘립니다. Windows Terminal 창은 폭 466px보다 좁아지지 않으므로, 그보다 좁아질 배치는 피합니다.

1920x1080 모니터 한 대 기준: 4개는 2x2, 6개는 3x2, 8개는 4x2, 10개는 4x3(마지막 줄 2개), 20개는 4x5

"모든 모니터에 나눠서"는 모니터 넓이 비율대로 나눕니다. 예: 같은 크기 두 대에 10개면 5개씩

### 짧게 치기

```bash
alias cl="npx claude-grid"          # ~/.bashrc 또는 ~/.zshrc
```

```powershell
function cl { npx claude-grid @args }   # PowerShell $PROFILE
```

### 필요한 것

- Node.js 18 이상
- `claude` 명령 (Claude Code CLI)
- WSL에서는 Windows Terminal(`wt.exe`) 권장

### 안 될 때

- 창이 열리는데 claude가 안 뜸: 그 창에서 `claude`를 직접 쳐 보세요. 안 되면 Claude Code 설치나 PATH 문제입니다
- 창 자리가 어긋남: `claude-grid --config`로 모니터를 다시 고르세요. 모니터 연결을 바꾸면 저장한 모니터를 못 찾아 주 모니터에 띄웁니다
- 맥: 처음 실행 때 "터미널 제어 허용" 창이 뜨면 허용해야 창을 옮길 수 있습니다
