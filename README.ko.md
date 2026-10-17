# oh-my-statusline

[![test](https://github.com/m16khb-org/oh-my-statusline/actions/workflows/test.yml/badge.svg)](https://github.com/m16khb-org/oh-my-statusline/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh)

**AI 코딩 에이전트 네 개에 쓰는 상태 줄 하나입니다.** [Claude Code](https://code.claude.com/docs/en/statusline),
[Codex CLI](https://developers.openai.com/codex/cli), [omp](https://github.com/can1357/oh-my-pi)(oh-my-pi),
[OpenCode](https://opencode.ai)에서 파워라인 칩과 게이지 두 줄을 똑같은 모양으로 그립니다. 어떤 모델이 어느
디렉터리와 브랜치에서 일하는지, 세션 비용이 얼마인지, 컨텍스트와 요금제 한도가 얼마나 남았는지 한눈에 보입니다.

![어두운 터미널에서 본 네 하네스](docs/demo-dark.png)

[English](README.md) · [설치 가이드](INSTALL.md) · [아키텍처](docs/architecture.md) · [기능 표](docs/feature-matrix.md)

## 특징

- **렌더러 하나로 네 에이전트를 그립니다.** 각 에이전트가 자기 세션 데이터를 같은 규칙에 넘기므로 칩의 모양과
  동작이 어디서나 같습니다. 에이전트에 없는 데이터는 그 부분을 비워 두고, 값을 지어내지 않습니다.
- **어떤 폭에도 맞춥니다.** 터미널이 좁으면 덜 중요한 항목부터 빠지고, 게이지는 없애기 전에 막대부터 줄입니다.
  20칸보다 좁으면 아무것도 그리지 않습니다.
- **작업을 방해하지 않습니다.** git, PR, 사용량 한도처럼 느린 조회는 백그라운드에서 돌고 결과를 캐시합니다.
  렌더는 가진 값으로 바로 그리고, 다음 렌더를 위해 값을 새로 받아 둡니다.
- **plain, ascii, 무색 모드가 있습니다.** 파워라인 글리프가 없는 글꼴, 단순한 터미널,
  [`NO_COLOR`](https://no-color.org) 환경에서도 깨지지 않습니다.
- **사용량 통계를 냅니다.** `stats` 명령이 네 에이전트의 세션 수, 비용, 토큰을 모델별로 보여 주고, 원하면
  오늘 쓴 비용 합계를 `Σ` 칩으로 띄웁니다.
- **설치기가 하나입니다.** 예전 설치를 찾아서 원래 설정을 보관하고, 제거할 때 그대로 되돌려 놓습니다.
- **런타임 의존성이 없습니다.** [Bun](https://bun.sh) 위에서 도는 TypeScript이고, 설치할 때 아무것도 내려받지
  않습니다.

## 빠르게 시작하기

macOS나 Linux에 [Bun](https://bun.sh)과 쓰려는 에이전트가 있으면 됩니다. Codex에는 `tmux`도 필요하고,
`gh`나 `glab`이 있으면 PR 칩이 나타납니다. Windows에서는 WSL2 안에 모두 설치해서 쓰세요. Windows에서 바로
실행하는 것은 지원하지 않습니다([자세히](INSTALL.md#windows-use-wsl2)).

```sh
git clone https://github.com/m16khb-org/oh-my-statusline.git
cd oh-my-statusline
./install.sh                   # 터미널에서 실행하면 체크리스트가 뜹니다(이 머신에 있는 에이전트는 미리 선택됨)
./install.sh claude omp        # 이름을 직접 지정해도 됩니다. `all`은 네 개 모두입니다
./install.sh all --dry-run     # 아무것도 쓰지 않고 단계만 보여 줍니다
```

설치한 뒤에는 각 에이전트에서 새 세션을 시작하세요. Codex는 `codex-statusline`으로 실행합니다. 설치할 때
`--wrap-codex`를 주면 `codex` 명령도 상태 줄과 함께 뜹니다. 이때 `PATH`에서 `~/.local/bin`이 앞에 있어야 합니다.

파워라인 글꼴이 없으면 `--plain`으로 설치하거나 [docs/display-modes.md](docs/display-modes.md)를 참고하세요.
하네스마다 어떤 파일을 어디에 쓰는지는 [INSTALL.md](INSTALL.md)에 있습니다.

업데이트는 `git pull && ./install.sh <에이전트>`, 제거는 `./uninstall.sh <에이전트>`입니다.

## 두 줄에 나오는 것

**1행**: 파워라인 화살표로 이어진 칩 뒤에 세션 수치가 붙습니다.

| 칩 | 내용 | 색 |
|---|---|---|
| 모델 | `Opus 5.5`, `GPT-5.5` 등 | 계열별: 보라 Opus·GPT·o 시리즈·DeepSeek, 하늘 Sonnet·Kimi, 청록 Haiku·GLM, 주황 Fable·Qwen, 파랑 Gemini, 회청 Grok, 은색 그 밖 |
| effort | `max`, `xhigh`, `high`, `medium` 등. fast 티어가 켜져 있으면 `·fast`가 붙습니다 | 빨강 `max`, 주황 `xhigh`, 노랑 `high`, 청록 `medium`, 회청 그 밖 |
| 디렉터리 | 저장소 이름, 루트 아래 경로(깊으면 `…/상위/폴더`), 연결된 워크트리 이름 | 파랑 |
| git | 브랜치, `⇡` 앞섬, `⇣` 뒤처짐, `✘` 충돌, `+` 스테이징, `~` 수정, `?` 추적 안 함 | 초록 깨끗함, 노랑 변경 있음, 빨강 충돌 |
| PR / MR | GitHub는 `#512`, GitLab은 `!512`. `✓` 승인, `✗` 변경 요청, `draft`. Cmd/Ctrl+클릭으로 PR을 엽니다 | 청록, 빨강, 회청, 대기 중이면 하늘 |
| 실행 중 | `◈ 2` 서브에이전트, `⌘ 1` 셸 | 하늘 |
| 환경 | `ssh <호스트>`, `tmux <세션>:<창>`, `venv <이름>`, `k8s <컨텍스트>`(k8s는 직접 켜야 합니다) | 주황, 은색, 청록, 보라 |

칩 뒤에는 세션 비용, 경과 시간(1분부터), `HEAD` 대비 추가·삭제 줄 수, 프롬프트 캐시(`cache 42m` 남음 또는
`cache hit 87%`)가 붙습니다. 통계 칩을 켜면 네 에이전트를 합친 오늘 비용(`Σ $12.34`)도 나옵니다. 0이거나 알 수
없는 값은 표시하지 않습니다.

**2행**: 게이지입니다. 초록에서 빨강으로 물드는 막대, 사용 비율, 초기화까지 남은 시간이 나옵니다.

- `ctx`: 컨텍스트 창과 사용한 토큰 수(`283k/1M`). 장문 컨텍스트 요금이 붙는 20만 토큰을 넘으면 노랗게 바뀝니다.
- `5h`, `7d`: 요금제 사용량 한도와 초기화까지 남은 시간(`↻1h12m`). `Fable`처럼 티어별로 묶인 창도 나옵니다.
- `⚠~45m`: 지금까지의 속도라면 초기화 전에 약 45분 뒤 한도에 닿는다는 경고입니다.
- `ctx —`, `7d —`: 창은 있지만 아직 읽은 값이 없습니다.

비율은 50% 미만이면 초록, 50%부터 노랑, 65%부터 주황, 80%부터 빨강입니다.

![plain 글리프로 그린 같은 줄](docs/demo-plain.png)

자리가 모자라면 1행은 환경 칩과 `Σ`부터 빼고, 이어서 캐시, 줄 수, 경과 시간, 비용, PR, effort를 뺍니다.
그다음 브랜치와 디렉터리를 줄이고, 마지막에 디렉터리 칩을 뺍니다. 2행은 막대를 먼저 줄이고, 토큰 수,
초기화 시간, 티어별 창 순으로 뺀 뒤 마지막에는 줄 전체를 숨깁니다.

```
 Opus 5.5   max   my-app   main   #512 ✓   $4.21 · 23m · +156 −23 · cache 42m        (120칸)
ctx ▆▆▆▁▁▁▁▁▁▁ 28% 283k/1M │ 5h ▆▆▆▁▁▁▁▁ 41% ↻1h12m │ 7d ▆▁▁▁▁▁▁▁ 18% ↻3d5h │ Fable ▆▆▁▁▁▁▁▁ 25% ↻3d5h

 Opus 5.5   max   my-app   main   #512 ✓   $4.21 · 23m · +156 −23                     (70칸)
ctx 28% 283k/1M │ 5h 41% ↻1h12m │ 7d 18% ↻3d5h │ Fable 25% ↻3d5h
```

<sub>여기서는 `plain` 글리프와 무색으로 그렸습니다. 실제 화면에는 파워라인 화살표와 위 표의 색이 들어갑니다.</sub>

## 에이전트별 지원 범위

| | Claude Code | Codex | omp | OpenCode |
|---|:-:|:-:|:-:|:-:|
| 모델, effort, 디렉터리, git, 줄 수, 경과 시간 | ✓ | ✓ | ✓ | ✓ |
| PR 칩 | ✓ | ✓ | ✓ | ✓ |
| 세션 비용 | ✓ | – | ✓ | ✓ |
| 프롬프트 캐시 | 남은 시간 | 적중률 | 남은 시간, 없으면 적중률 | – |
| `ctx` 게이지 | ✓ | ✓ | ✓ | ✓ |
| `5h` / `7d` 한도 | ✓ | ✓ | ✓ | – |
| 티어별 한도 | ✓ | – | ✓ | – |
| 서브에이전트 | 패널 | – | `◈` 칩 | `◈`, `⌘` 칩 |
| ssh, tmux, venv, k8s 칩과 `Σ` | ✓ | ✓ | ✓ | ✓ |

`–`는 그 에이전트가 해당 데이터를 내주지 않는다는 뜻입니다. 칸마다 이유는
[docs/feature-matrix.md](docs/feature-matrix.md)에 적어 두었습니다.

Claude Code에서는 서브에이전트 패널이 에이전트 패널의 줄을 대신합니다. 실행 중인 서브에이전트마다 모델, effort,
작업 내용, 컨텍스트 게이지, 실행 시간을 보여 주고, 끝나면 `✓`나 `✘`를 표시합니다.

## 설정

설정 없이도 바로 동작합니다. 바꾸고 싶으면 `~/.config/oh-my-statusline/config.toml`을 만드세요
(`$XDG_CONFIG_HOME`을 따릅니다). 네 에이전트가 이 파일 하나를 함께 읽습니다.

```toml
theme = "auto"          # auto | dark | light
glyphs = "powerline"    # powerline | plain | ascii
colors = "auto"         # auto | truecolor | 256 | none
subagents = true        # Claude Code의 서브에이전트 패널과 ◈ 칩

[chips]
ssh = true
tmux = true
venv = true
k8s = false             # 60초마다 kubectl에 현재 컨텍스트를 묻습니다

[stats]
chip = false            # Σ $12.34: 네 에이전트를 합친 오늘 비용

[pr]
enabled = true          # gh / glab으로 읽는 PR 칩

[harness.codex]         # 위의 키를 에이전트 하나에만 적용합니다(claude, codex, omp, opencode)
glyphs = "plain"
```

| 키 | 기본값 | 환경 변수 |
|---|---|---|
| `theme` | `auto`: 에이전트나 시스템의 라이트/다크 모드 | `STATUSLINE_THEME` |
| `glyphs` | `powerline` | `STATUSLINE_GLYPHS` |
| `colors` | `auto`: `COLORTERM`이 `truecolor`면 24비트, 아니면 256색 | `STATUSLINE_COLORS` |
| `subagents`, `chips.*`, `stats.chip`, `pr.enabled` | 위 예시와 같음 | – |

뒤에 오는 값이 앞의 값을 덮어씁니다. 순서는 내장 기본값, `./install.sh`가 기록한 선택(`--plain` 등), 설정 파일
(최상위 다음 `[harness.<id>]`), 환경 변수입니다. `NO_COLOR`에 값이 있으면 모든 에이전트에서 색이 꺼지고, 어떤
설정도 이를 되돌리지 않습니다. 잘못된 값은 그 항목만 건너뛰고 나머지는 그대로 적용합니다.

에이전트 하나에만 해당하는 스위치도 있습니다. `OMP_STATUSLINE_NATIVE=keep`은 omp 자체 상태 바를 건드리지 않고,
`CODEX_STATUSLINE_DISABLE=1`은 상태 줄 없이 Codex를 실행합니다. OpenCode의 칩별 스위치는 `cli.json`의 플러그인
옵션에 있습니다([INSTALL.md](INSTALL.md#opencode)).

## 사용량 통계

```sh
bun src/cli/stats.ts                          # 모든 에이전트, 전체 기간
bun src/cli/stats.ts --since 7d               # 오늘을 포함한 최근 7일
bun src/cli/stats.ts --harness codex --since today
bun src/cli/stats.ts --json
```

에이전트와 모델별로 세션 수, 저장된 비용, 토큰(입력, 출력, 캐시 읽기, 캐시 쓰기), 처음과 마지막 활동 시각을
보여 줍니다. 에이전트가 남긴 세션 파일을 읽기만 하고, 캐시를 두어 다음 실행에서는 새로 생긴 부분만 읽습니다.
비용을 저장하지 않는 에이전트는 `–`로 표시하고, 일부 세션에만 비용이 남아 있으면 `*`를 붙입니다. 각 수치의
출처는 [docs/stats-sources.md](docs/stats-sources.md)에 정리했습니다.

## 에이전트 없이 미리 보기

```sh
bun run demo                          # 지금 터미널 폭으로 모든 에이전트
bun run demo --case chips --width 100
bun run demo --glyphs ascii --colors none
```

옵션은 `--case all|claude|codex|omp|opencode|chips|agents`, `--width N`, `--theme dark|light`,
`--glyphs powerline|plain|ascii`, `--colors 24|256|none`입니다.

![밝은 터미널](docs/demo-light.png)

## 예전 프로젝트에서 넘어오기

이 저장소는 `claude-code-statusline`, `codex-statusline`, `omp-statusline`, `opencode-statusline`을 대신합니다.
네 저장소는 2026-10-17에 삭제했습니다. 이 중 하나가 아직 설치되어 있으면 `./install.sh`가 넘겨받습니다. 예전
설치 전에 쓰던 설정을 보관하고, 글리프 선택(Codex는 실행 경로와 래퍼, OpenCode는 옵션까지)을 이어받은 뒤
예전 사본을 지웁니다. 그래서 상태 줄이 두 번 그려지는 에이전트가 생기지 않습니다. 먼저 `--dry-run`으로 계획을
확인하세요. 자세한 규칙은 [INSTALL.md](INSTALL.md#migrating-from-the-old-installs)에 있습니다.

## 제거

```sh
./uninstall.sh                  # 설치된 것 중에서 고릅니다
./uninstall.sh all
./uninstall.sh claude --dry-run
```

Claude Code의 `statusLine` 항목과 OpenCode의 플러그인 목록은 설치 전 상태로 돌아갑니다. 이 프로젝트가 만든
파일과 런처만 지우고, 설치 뒤에 직접 고친 것은 남겨 둡니다. 원래 Codex 설치는 건드리지 않습니다.

## 개발

```sh
bun install            # 타입 정의만 받습니다. 런타임 npm 의존성은 없습니다
bun run typecheck
bun test
bun run bench          # 성능 수치, docs/performance.md 참고
```

코드는 계층으로 나뉩니다. 순수한 도메인(스냅샷과 렌더 규칙), 애플리케이션 계층(설정과 유스케이스), 인프라
어댑터(git, 캐시, 프로세스), 에이전트마다 하나씩 있는 어댑터입니다. `test/architecture.test.ts`가 도메인과
애플리케이션 계층에 I/O가 들어가지 않도록 막습니다. CI는 Ubuntu와 macOS에서 타입 검사와 전체 테스트를 돌립니다.

더 읽을거리: [아키텍처](docs/architecture.md) · [표시 모드](docs/display-modes.md) ·
[기능 표](docs/feature-matrix.md) · [예전 프로젝트와의 차이](docs/parity.md) ·
[성능](docs/performance.md) · [용어집](docs/glossary.md)

## 라이선스

[MIT](LICENSE)
