# claude-grid

**Open several Claude Code sessions at once, tiled across your monitors, with one command.**

```bash
npx claude-grid
```

Pick a monitor, how many windows, and a folder for each. claude-grid opens that many terminal windows, snaps them into a grid, and starts `claude` in each one. Save the setup as a preset and bring the whole workspace back with `npx claude-grid <preset>`.

- Windows Terminal / PowerShell / CMD, WSL, macOS (Terminal.app, iTerm2), Linux (GNOME Terminal, Konsole, xterm)
- Layouts for 2 to 6 windows, multi-monitor aware
- Presets stored in `~/.claunch.json` (file name kept for backward compatibility)

> The npm package named `claunch` is an unrelated project. Use `claude-grid`.

(한국어 설명은 아래에 있습니다.)

---

## 한국어

터미널 창을 자동으로 지정 모니터에 배치하고, 각 창에서 `claude` 명령어를 실행해주는 CLI 도구.

---

## Install

별도 설치 없이 바로 실행:

```bash
npx claude-grid
```

또는 전역 설치:

```bash
npm install -g claude-grid
claude-grid
```

---

## Quick Start

1. `npx claude-grid` 실행
2. 모니터 선택 (멀티 모니터 환경), 창 개수 입력, 각 창 경로 입력
3. 설정 저장 여부 선택 → 자동으로 창 배치 및 claude 실행

---

## Commands

| 커맨드 | 설명 |
|--------|------|
| `npx claude-grid` | 저장된 설정으로 바로 실행 (최초엔 인터랙티브 설정) |
| `npx claude-grid --config` | 설정 다시 하기 |
| `npx claude-grid --list` | 저장된 프리셋 목록 보기 |
| `npx claude-grid <프리셋이름>` | 특정 프리셋 바로 실행 |

---

## Presets

자주 쓰는 창 구성을 프리셋으로 저장할 수 있습니다.

```bash
# 저장된 프리셋 목록
npx claude-grid --list

# 특정 프리셋 실행
npx claude-grid fullstack
```

---

## Config

설정 파일 위치: `~/.claunch.json`

```json
{
  "terminal": "windowsterminal",
  "monitor": 0,
  "paths": ["/myapp/frontend", "/myapp/backend", "", ""],
  "presets": {
    "fullstack": {
      "count": 4,
      "paths": ["/myapp/frontend", "/myapp/backend", "", ""]
    },
    "research": {
      "count": 2,
      "paths": ["/notes", ""]
    }
  }
}
```

`paths` 항목에서 빈 문자열(`""`)은 실행 시 현재 경로(`process.cwd()`)를 사용합니다.

---

## Alias 설정

`cl` 한 글자로 실행하려면 alias를 추가하세요.

### zsh (`~/.zshrc`)

```zsh
alias cl="npx claude-grid"
```

적용:

```bash
source ~/.zshrc
```

### bash (`~/.bashrc`)

```bash
alias cl="npx claude-grid"
```

적용:

```bash
source ~/.bashrc
```

### fish (`~/.config/fish/config.fish`)

```fish
alias cl "npx claude-grid"
```

### PowerShell (`$PROFILE`)

```powershell
function cl { npx claude-grid @args }
```

또는 alias:

```powershell
Set-Alias cl "npx claude-grid"
```

`$PROFILE` 파일 경로 확인: `echo $PROFILE`

---

## Supported Terminals

| 터미널 | OS | 지원 여부 |
|--------|-----|---------|
| Windows Terminal | Windows | 지원 |
| PowerShell | Windows | 지원 |
| CMD | Windows | 지원 |
| Terminal.app | macOS | 지원 |
| iTerm2 | macOS | 지원 |
| GNOME Terminal | Linux | 지원 |
| Konsole | Linux | 지원 |
| xterm | Linux | 지원 (폴백) |

---

## Window Layout

창 개수에 따른 자동 레이아웃:

| 개수 | 레이아웃 |
|------|---------|
| 2 | 좌/우 (가로 모니터) 또는 위/아래 |
| 3 | 2x2 그리드 (3칸 사용) |
| 4 | 2x2 그리드 |
| 5 | 좌 2개 + 우 3개 |
| 6 | 3x2 또는 2x3 그리드 |

---

## Requirements

- Node.js 18+
- `claude` CLI가 PATH에 설치되어 있어야 합니다.
