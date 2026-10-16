# oh-my-statusline

AI 코딩 에이전트를 위한 통합 2행 파워라인 상태줄.

기존 4개 저장소(claude-code-statusline, codex-statusline, omp-statusline, opencode-statusline)를 TypeScript + Bun 단일 코드베이스로 통합합니다.

> 상태: 개발 중. 스캐폴드, 도메인 코어, 어댑터를 이 저장소에서 구축하고 있습니다.

## 예정 기능

- 하나의 상태줄 엔진(칩, 게이지, 폭 사다리)을 4개 하네스에서 동일하게 렌더.
- 하네스 어댑터: Claude Code(stdin 계약, 서브에이전트 패널), Codex(tmux 런처, rollout 텔레메트리), omp(확장 이벤트, 네이티브 바 trim), OpenCode(TUI 플러그인, footer 슬롯).
- 확장 칩: SSH, tmux, venv, Kubernetes context(선택).
- 비용·토큰 누적 통계(`stats` CLI)와 증분 파싱 캐시.
- 폰트 없는 환경을 위한 plain / NO_COLOR 모드.
- 통합 설치기: `install.sh` + `INSTALL.md`, 비파괴 uninstall.

## 요구 사항

- [Bun](https://bun.sh) 최신 버전
- tmux(Codex 런처 전용)
- Nerd Font는 선택 사항입니다. plain·ascii 글리프 모드를 지원합니다.

## 개발

```sh
bun install
bun run typecheck
bun test
bun run demo
```

## 라이선스

MIT — [LICENSE](./LICENSE) 참고.
