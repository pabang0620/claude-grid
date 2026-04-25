# claunch

터미널 창을 자동으로 지정 모니터에 배치하고, 각 창에서 `claude` 명령어를 실행해주는 CLI 도구.

![demo](demo.gif)

---

## Install

별도 설치 없이 바로 실행:

```bash
npx claunch
```

또는 전역 설치:

```bash
npm install -g claunch
claunch
```

---

## Quick Start

1. `npx claunch` 실행
2. 모니터 선택 (멀티 모니터 환경), 창 개수 입력, 각 창 경로 입력
3. 설정 저장 여부 선택 → 자동으로 창 배치 및 claude 실행

---

## Commands

| 커맨드 | 설명 |
|--------|------|
| `npx claunch` | 저장된 설정으로 바로 실행 (최초엔 인터랙티브 설정) |
| `npx claunch --config` | 설정 다시 하기 |
| `npx claunch --list` | 저장된 프리셋 목록 보기 |
| `npx claunch <프리셋이름>` | 특정 프리셋 바로 실행 |

---

## Presets

자주 쓰는 창 구성을 프리셋으로 저장할 수 있습니다.

```bash
# 저장된 프리셋 목록
npx claunch --list

# 특정 프리셋 실행
npx claunch fullstack
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
alias cl="npx claunch"
```

적용:

```bash
source ~/.zshrc
```

### bash (`~/.bashrc`)

```bash
alias cl="npx claunch"
```

적용:

```bash
source ~/.bashrc
```

### fish (`~/.config/fish/config.fish`)

```fish
alias cl "npx claunch"
```

### PowerShell (`$PROFILE`)

```powershell
function cl { npx claunch @args }
```

또는 alias:

```powershell
Set-Alias cl "npx claunch"
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
