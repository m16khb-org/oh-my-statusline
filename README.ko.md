# oh-my-statusline

[![test](https://github.com/m16khb-org/oh-my-statusline/actions/workflows/test.yml/badge.svg)](https://github.com/m16khb-org/oh-my-statusline/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh)

AI 코딩 에이전트 네 가지에서 같은 모양으로 쓰는 2행 파워라인 상태줄입니다. 대상은 [Claude Code](https://code.claude.com/docs/en/statusline),
[Codex CLI](https://developers.openai.com/codex/cli), [omp](https://github.com/can1357/oh-my-pi)(oh-my-pi),
[OpenCode](https://opencode.ai)입니다. 에이전트마다 자기 세션 데이터를 공용 렌더러에 넘기므로 칩, 색, 레이아웃이 어디서나 같습니다.

![다크 터미널 데모](docs/demo-dark.png)

[English](README.md) · [설치 가이드](INSTALL.md) · [아키텍처](docs/architecture.md)

`claude-code-statusline`, `codex-statusline`, `omp-statusline`, `opencode-statusline` 네 프로젝트를
TypeScript + Bun 코드베이스 하나로 합쳤고, 런타임 npm 의존성은 없습니다. 기존 설치는 설치 스크립트가
넘겨받습니다. 자세한 내용은 [기존 4개 프로젝트에서 옮기기](#기존-4개-프로젝트에서-옮기기)에 있습니다.
기존 4개 저장소는 전환을 마친 뒤 2026-10-17에 삭제했고, 지금은 이 저장소만 남아 있습니다.

## 레이아웃

**1행**: 파워라인 화살표로 이어진 칩 뒤에 세션 통계가 붙습니다.

| 칩 | 내용 | 색 |
|---|---|---|
| 모델 | `Opus 5.5`, `GPT-5.5` 등 | Opus·GPT·o 시리즈·DeepSeek 보라, Sonnet·Kimi 하늘, Haiku·GLM 청록, Fable·Qwen 주황, Gemini 파랑, Grok 회청, 그 밖의 모델 은색 |
| effort | `max`, `xhigh`, `high`, `medium` 등. fast 티어이면 `·fast`가 붙습니다 | `max` 빨강, `xhigh` 주황, `high` 노랑, `medium` 청록, 나머지 회청 |
| 디렉터리 | 저장소 이름과 체크아웃 루트 아래 경로(깊은 경로는 `…/상위/폴더`로 줄임), 브랜치와 이름이 다른 워크트리 이름 | 파랑 |
| git | 브랜치, `⇡` ahead, `⇣` behind, `✘` 충돌, `+` 스테이징, `~` 수정, `?` 미추적 | 깨끗하면 초록, 변경이 있으면 노랑, 충돌이 있으면 빨강 |
| PR / MR | GitHub는 `#512`, GitLab은 `!512`. 승인이면 `✓`, 변경 요청이면 `✗`, 초안이면 `draft`가 붙고 Cmd/Ctrl+클릭하면 열립니다 | 승인 청록, 변경 요청 빨강, 리뷰 대기 하늘, 초안 회청 |
| 실행 중 | `◈ 2` 서브에이전트, `⌘ 1` 셸(하네스가 알려 주는 경우만) | 하늘 |
| 환경 | `ssh <호스트>`, `tmux <세션>:<윈도우>`, `venv <이름>`, `k8s <컨텍스트>` | 주황, 은색, 청록, 보라 |

칩 뒤에는 세션 통계가 붙습니다. 각 항목은 보여 줄 값이 없으면 나타나지 않습니다. 순서는 비용(0이면 숨김), 세션 시간(1분 미만이면 숨김),
추가·삭제한 줄 수, 프롬프트 캐시가 만료되기까지 남은 시간(`cache 42m`) 또는 마지막 요청의 캐시 적중률(`cache hit 87%`)입니다.
켜 두었다면 네 하네스 전체의 오늘 비용(`Σ $12.34`)도 마지막에 나옵니다.

줄 수는 저장소에서 스테이징했거나 아직 스테이징하지 않은 변경을 `HEAD`와 비교한 값입니다
(`git diff HEAD --shortstat`, 미추적 파일은 세지 않습니다).

**2행**: 게이지를 보여 줍니다. 게이지마다 칸별로 초록에서 빨강까지 칠한 막대, 사용 비율, 리셋까지 남은 시간이 나옵니다.

- `ctx`: 사용한 컨텍스트 비율과 토큰 수(`283k/1M`)입니다. 토큰 수는 20만을 넘으면 노란색으로 바뀝니다.
- `5h` / `7d`: 요금제 사용 한도와 리셋까지 남은 시간(`↻1h12m`)입니다.
- 요금제에 모델 티어 전용 주간 한도가 있으면 `Fable`처럼 따로 나옵니다.
- `⚠~45m`: 지금까지의 평균 속도로 계속 쓰면 리셋 전에 약 45분 뒤 한도가 찬다는 뜻입니다.
- 퍼센트 숫자는 50% 미만이면 초록, 50%부터 노랑, 65%부터 주황, 80%부터 빨강입니다.
- `ctx —`, `7d —`는 창은 있지만 아직 읽은 값이 없다는 표시입니다.

![plain 글리프, 다크 터미널](docs/demo-plain.png)

![라이트 터미널 데모](docs/demo-light.png)

### 좁은 터미널

폭이 20열 미만이면 아무것도 출력하지 않습니다(OpenCode는 `minimumWidth` 옵션이 따로 있고 기본값은 44입니다).
그 이상에서는 덜 중요한 항목부터 다음 순서로 뺍니다.

1. 1행: 환경 칩과 `Σ`를 함께 먼저 빼고, 이어서 캐시, 줄 수, 세션 시간, 비용, PR, effort를 뺍니다. 그다음 브랜치를 20칸으로 자르고,
   디렉터리를 저장소 이름만 남기고, 마지막에 디렉터리를 뺍니다.
2. 2행: 막대를 먼저 줄입니다(ctx 10 → 8 → 6 → 0칸, 한도 8 → 6 → 4 → 0칸). 이어서 토큰 수, 리셋 시간, 티어 전용 창을 빼고, 마지막에 행 전체를 숨깁니다.

```
 Opus 5.5   max   my-app   main   #512 ✓   $4.21 · 23m · +156 −23 · cache 42m   (120열)
ctx ▆▆▆▁▁▁▁▁▁▁ 28% 283k/1M │ 5h ▆▆▆▁▁▁▁▁ 41% ↻1h12m │ 7d ▆▁▁▁▁▁▁▁ 18% ↻3d5h │ Fable ▆▆▁▁▁▁▁▁ 25% ↻3d5h

 Opus 5.5   max   my-app   main   #512 ✓   $4.21 · 23m · +156 −23                    (70열)
ctx 28% 283k/1M │ 5h 41% ↻1h12m │ 7d 18% ↻3d5h │ Fable 25% ↻3d5h
```

(화살표와 브랜치 아이콘은 사설 영역(private-use) 글리프라서 텍스트로 옮길 수 없습니다. 위 예시는 색을 뺀 `plain` 글리프 세트입니다.)

## 하네스별로 보여 주는 정보

각 하네스는 자기가 아는 값만 그리고 나머지는 생략합니다. 없는 값을 지어내지 않습니다.

| 기능 | Claude Code | Codex | omp | OpenCode |
|---|:-:|:-:|:-:|:-:|
| 모델, effort | ✓ | ✓ | ✓ | ✓ |
| 디렉터리, git, 줄 수, 세션 시간 | ✓ | ✓ | ✓ | ✓ |
| PR / MR (`gh` / `glab`) | ✓ | ✓ | ✓ | ✓ |
| 세션 비용 | ✓ | – | ✓ | ✓ |
| 캐시 남은 시간 / 적중률 | 남은 시간 | 적중률 | 남은 시간, 없으면 적중률 | – |
| `ctx` 게이지 | ✓ | ✓ | ✓ | ✓ |
| `5h` / `7d` 한도 | ✓ | ✓ | ✓ | – |
| 티어 전용 한도 | ✓ | – | ✓ | – |
| 서브에이전트 | 패널 | – | `◈` 칩 | `◈`, `⌘` 칩 |
| ssh / tmux / venv / k8s 칩, `Σ` | ✓ | ✓ | ✓ | ✓ |

`–`가 붙은 이유와 각주를 포함한 전체 표는 [docs/feature-matrix.md](docs/feature-matrix.md)에 있습니다.
기존 렌더러 네 개와 달라진 점은 [docs/parity.md](docs/parity.md)에 정리했습니다.

## 빠른 시작

필요한 것은 [Bun](https://bun.sh), macOS 또는 Linux, 그리고 설치할 에이전트입니다. Codex에는 `tmux`도 필요합니다.
PR/MR 칩에는 `gh` 또는 `glab`이, 선택 사항인 `k8s` 칩에는 `kubectl`이 필요합니다.

```sh
git clone https://github.com/m16khb-org/oh-my-statusline.git
cd oh-my-statusline
./install.sh claude                      # Claude Code
./install.sh claude codex omp opencode   # 원하는 조합. `all`은 네 개 전부입니다
./install.sh                             # 터미널에서는 체크리스트가 뜨고, 이 컴퓨터에서 발견한 하네스에 표시가 붙습니다
./install.sh all --dry-run               # 모든 단계를 출력만 하고 아무것도 쓰지 않습니다
```

`./install.sh --plain`은 파워라인용 사설 글리프 없이 칩을 따로 떨어진 배지로 그립니다. 파워라인 패치가 안 된 폰트에서 쓰면 됩니다.
하네스별 설치 내용, 파일이 쓰이는 위치, 문제 해결은 [INSTALL.md](INSTALL.md)에 있습니다.

설치 스크립트는 하네스 각자의 디렉터리에 런타임을 복사합니다. 업데이트하려면 `git pull && ./install.sh <하네스>`를 다시 실행합니다.

## 설정

설정은 다섯 겹으로 적용되고, 나중 것이 앞의 것을 덮어씁니다.

1. 내장 기본값
2. 설치 선택: `./install.sh`가 기록한 값(예: `--plain`)
3. 설정 파일: 최상위 키, 그다음 지금 그리는 하네스의 `[harness.<id>]` 테이블(`claude`, `codex`, `omp`, `opencode`)
4. 환경 변수(`STATUSLINE_*`, `NO_COLOR`)
5. 명령줄 플래그: 지금은 어떤 하네스 진입점도 플래그를 받지 않습니다. `bun run demo`는 자체 옵션(`--theme`, `--glyphs`, `--colors`)과 환경 변수만 읽고 설정 파일은 읽지 않습니다

설정 파일은 `$XDG_CONFIG_HOME/oh-my-statusline/config.toml`이고, 변수가 없으면 `~/.config/oh-my-statusline/config.toml`입니다.
파일은 없어도 됩니다. 잘못된 값은 그 항목만 건너뛰고 나머지는 그대로 적용하며, 파싱이 안 되는 파일은 통째로 무시합니다.

```toml
theme = "auto"          # "auto" | "dark" | "light"
glyphs = "powerline"    # "powerline" | "plain" | "ascii"
colors = "auto"         # "auto" | "truecolor" (또는 "24bit") | "256" | "none"
subagents = true        # Claude의 에이전트 패널, omp와 OpenCode의 ◈ 칩

[chips]
ssh = true
tmux = true
venv = true
k8s = false             # 60초마다 `kubectl config current-context`를 실행합니다

[stats]
chip = false            # 모든 하네스의 오늘 비용을 `Σ $12.34`로 표시

[pr]
enabled = true          # gh / glab으로 PR/MR 칩 표시

# 하네스별 덮어쓰기: 같은 키를 쓰되 해당 하네스에만 적용됩니다.
[harness.codex]
glyphs = "plain"

[harness.omp.chips]
k8s = true
```

| 키 | 값 | 기본값 | 환경 변수 |
|---|---|---|---|
| `theme` | `auto`, `dark`, `light` | `auto`(하네스의 라이트/다크 모드) | `STATUSLINE_THEME` |
| `glyphs` | `powerline`, `plain`, `ascii` | `powerline` | `STATUSLINE_GLYPHS` |
| `colors` | `auto`, `truecolor`(`24bit`), `256`, `none` | `auto`: `COLORTERM`이 `truecolor`나 `24bit`이면 24비트, 아니면 256색 | `STATUSLINE_COLORS` |
| `subagents` | `true`, `false` | `true` | – |
| `chips.ssh` | `true`, `false` | `true` | – |
| `chips.tmux` | `true`, `false` | `true` | – |
| `chips.venv` | `true`, `false` | `true` | – |
| `chips.k8s` | `true`, `false` | `false` | – |
| `stats.chip` | `true`, `false` | `false` | – |
| `pr.enabled` | `true`, `false` | `true` | – |

`NO_COLOR`가 비어 있지 않은 값으로 설정되어 있으면 모든 하네스에서 색과 굵게 표시를 모두 없애고, 무엇도 이를 덮어쓰지 못합니다
(<https://no-color.org>). 글리프 세트 세 가지, 색 깊이, 무색 모드는 폰트 안내와 함께
[docs/display-modes.md](docs/display-modes.md)에 설명해 두었습니다.

하네스마다 다른 점은 다음과 같습니다.

- **테마 `auto`**: Claude Code와 Codex는 macOS 외관 설정을 읽고(다른 OS에서는 다크), omp는 활성 테마를, OpenCode는 TUI의 라이트/다크 모드를 따릅니다.
- **설치 선택**: `./install.sh --plain`은 각 하네스가 읽을 수 있는 곳에 기록됩니다. Codex(`install.json`), omp(`config.json`),
  OpenCode(`cli.json`의 `options.glyphs`)에서는 가장 낮은 계층이라서 `config.toml`과 환경 변수가 덮어씁니다. Claude Code에서는 명령 앞에 붙는
  `STATUSLINE_GLYPHS=plain`이 일반 환경 변수이므로 `config.toml`보다 우선합니다. Codex는 tmux가 24비트 색을 그린다는 사실도 함께 기록하며,
  `colors`와 `NO_COLOR`가 이를 덮어씁니다.
- **OpenCode**: `glyphs`(`ascii` 포함)와 `colors = "none"` / `NO_COLOR`는 다른 하네스와 똑같이 적용됩니다. 그 밖의 색 깊이는 TUI가 RGB를 직접 그리므로
  영향이 없습니다. `cli.json`의 플러그인 `options`에는 칩별 스위치와 레이아웃 설정이 있습니다. [INSTALL.md](INSTALL.md#opencode)를 참고합니다.
- **omp**: `OMP_STATUSLINE_NATIVE=keep`을 주면 omp 기본 상태 바를 그대로 둡니다.
- **Codex**: `CODEX_STATUSLINE_DISABLE=1`이면 상태줄 없이 진짜 Codex를 실행합니다.

환경 변수는 하네스가 읽는 곳에 지정합니다. Claude는 `settings.json`의 명령 앞에, 나머지는 `codex-statusline`, `omp`, `opencode`를 실행하는 셸에서 지정합니다.

## `stats`: 하네스 전체의 비용과 토큰

```sh
bun src/cli/stats.ts                          # 모든 하네스, 전체 기간
bun src/cli/stats.ts --since 7d               # 오늘을 포함한 최근 7일
bun src/cli/stats.ts --harness codex --since today
bun src/cli/stats.ts --json                   # 같은 데이터를 JSON으로
```

| 플래그 | 값 | 기본값 |
|---|---|---|
| `--harness` | `all`, `claude`, `codex`, `omp`, `opencode` | `all` |
| `--since` | `today`, `Nd`(예: `7d`, `30d`), `all` | `all` |
| `--json` | 표 대신 JSON 출력 | 꺼짐 |

각 하네스의 세션 파일을 읽기 전용으로 열어 하네스와 모델별로 세션 수, 저장된 비용, 토큰(입력, 출력, 캐시 읽기, 캐시 쓰기), 처음과 마지막 활동 시각을 보여 줍니다.
비용을 저장하지 않는 하네스는 `0`이 아니라 `–`로 표시하고, 비용 뒤의 `*`는 일부 세션만 비용을 저장했다는 뜻입니다.
날짜 경계는 `$TZ`를 따르고, 없으면 시스템 시간대를 씁니다. 파싱 결과는 `$XDG_CACHE_HOME/oh-my-statusline/stats-cache.json`(없으면 `~/.cache/…`)에 캐시하므로
다음 실행에서는 새로 생긴 부분만 읽습니다. 각 수치의 출처는 [docs/stats-sources.md](docs/stats-sources.md)에 있습니다.

## 데모

세션 없이 모든 하네스의 모양을 미리 볼 수 있습니다.

```sh
bun run demo                                  # 터미널 폭에 맞춰 모든 케이스 출력
bun run demo --case omp --width 80
bun run demo --glyphs ascii --colors none --width 80
bun run demo --theme light --colors 256
```

플래그는 `--case all|claude|codex|omp|opencode|chips|agents`, `--width N`, `--theme dark|light`, `--glyphs powerline|plain|ascii`,
`--colors 24|256|none`입니다. 폭의 기본값은 `$COLUMNS`, 그다음 터미널 폭, 그것도 없으면 120입니다. 위 스크린샷은 이 출력을 `tools/render_png.py`로 렌더링한 것입니다
([docs/architecture.md](docs/architecture.md#regenerating-the-screenshots) 참고).

## 기존 4개 프로젝트에서 옮기기

예전에 쓰던 하네스마다 `./install.sh`를 실행합니다. 설치 스크립트가 기존 설치를 찾아 설치 전 설정을 보존하고, 글리프 모드(Codex는 경로와 `codex` 래퍼 선택,
OpenCode는 옵션)를 넘겨받고, 기존 디렉터리를 지워서 한 하네스에 상태줄이 두 개 생기지 않게 합니다. `--dry-run`으로 계획을 먼저 확인할 수 있습니다.
하네스별 감지 조건과 이월 규칙은 [INSTALL.md](INSTALL.md#migrating-from-the-old-installs)에 정확히 적어 두었습니다. 기존 저장소 네 개는 설치 스크립트가 건드리지 않으므로,
충분히 확인한 뒤에 직접 지우면 됩니다.

## 제거

```sh
./uninstall.sh                  # 설치된 항목을 체크리스트로 보여 줍니다
./uninstall.sh all              # 또는 하네스를 직접 지정
./uninstall.sh claude --dry-run
```

설치 전의 `settings.json` 항목(Claude)과 `plugins` 목록(OpenCode)을 되돌리고, oh-my-statusline이 만든 런처와 디렉터리만 지웁니다.
설치 이후에 직접 바꾼 것은 그대로 둡니다. 공식 Codex는 건드리지 않습니다. 자세한 내용은 [INSTALL.md](INSTALL.md#uninstall)에 있습니다.

## 개발

```sh
bun install            # TypeScript와 Bun 타입, OpenCode 플러그인 타입. 런타임에는 번들되지 않습니다
bun run typecheck      # tsc --noEmit
bun test               # 단위, 골든, 설치, 아키텍처 테스트
bun run demo
```

런타임 npm 의존성은 없습니다. domain과 application 계층은 순수하게 유지하고, 그 경계를 `test/architecture.test.ts`가 강제합니다.
계층 구조, 포트, 칩을 추가하는 위치는 [docs/architecture.md](docs/architecture.md)를 참고합니다. CI는 Ubuntu와 macOS에서 타입 검사와 테스트를 실행합니다.

다른 문서: [docs/glossary.md](docs/glossary.md), [docs/performance.md](docs/performance.md).

## 라이선스

[MIT](LICENSE).
