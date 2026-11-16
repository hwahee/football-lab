# UI 자동화 가이드 — 모바일 앱 (testID 규약 + E2E)

`apps/mobile` 전용 문서입니다. 웹 클라이언트(`src/client`)의 규약은
[ui-automation.md](ui-automation.md)에 따로 있으며, 두 문서는 **같은 원칙(레지스트리
단일 출처, `{화면}.{섹션}.{요소}` 네이밍, 접근성 우선)** 을 각 플랫폼의 도구
(웹: DOM/ARIA, 앱: testID/Maestro)에 맞춰 적용한 것입니다.

앱의 **모든 인터랙티브 요소는 UI 자동화가 가능하도록** 설계되어 있으며, 규약 전체를
이 문서 하나에서 확인할 수 있습니다.

## 원칙

1. **인터랙티브 디자인 시스템 컴포넌트는 `testID`가 필수 prop**입니다
   (`Button`, `IconButton`, `TextField`, `TextArea`, `Accordion`, `Palette`), 그리고 오버레이 요청(`title`·`testID` 필수). testID 없이 렌더링하면 타입 에러가 나므로
   자동화 불가능한 컨트롤이 애초에 만들어질 수 없습니다.
2. **testID 문자열은 인라인으로 쓰지 않습니다.** 유일한 출처는
   [`apps/mobile/src/testing/testids.ts`](../apps/mobile/src/testing/testids.ts)의
   `TESTID` 레지스트리입니다. Maestro 플로우(YAML)는 import를 못 하므로, 레지스트리의
   문자열이 곧 자동화 계약입니다 — 함부로 바꾸지 마세요.
3. **네이밍**: `{screen}.{section}.{element}`, kebab-case.
   엔티티별 요소는 팩토리 함수 — 예: `TESTID.todos.item(todo.id)` → `todos.item.<uuid>`.
4. **접근성 우선**: 모든 컨트롤은 `accessibilityRole` + 접근 가능한 이름
   (`accessibilityLabel` 또는 가시 텍스트)을 갖습니다. 아이콘 전용 버튼(`IconButton`)은
   `accessibilityLabel`이 **필수 prop**입니다. VoiceOver/TalkBack 이 읽을 수 있으면
   자동화 도구도 읽을 수 있습니다.

## 상태 신호 (기다림/검증에 사용)

| 신호                                            | 의미                         |
| ----------------------------------------------- | ---------------------------- |
| `todos.loading` (progressbar)                   | 초기 로딩 중                 |
| `todos.error` (alert) + `todos.error.retry`     | 로드 실패 / 재시도 버튼      |
| `todos.empty`                                   | 빈 목록                      |
| `todos.footer.loading`                          | 무한 스크롤 다음 페이지 로딩 |
| `offline.banner` (alert)                        | 오프라인 상태                |
| `boot.screen` → 사라짐                          | 부트 시퀀스 종료             |
| `maintenance.screen`                            | 점검 모드(kill switch) 활성  |
| `update.force.screen`                           | 강제 업데이트 게이트         |
| Button `accessibilityState.busy`                | mutation 진행 중             |
| Accordion trigger `accessibilityState.expanded` | 패널 열림/닫힘 (`Accordion`) |

## testID 레지스트리 요약

전체 목록은 `apps/mobile/src/testing/testids.ts`가 소스 오브 트루스입니다. 주요 항목:

| 영역          | testID                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 부트/광고     | `boot.screen`, `boot.ad.slot`, `boot.ad.skip`                                                                                                                       |
| 점검/업데이트 | `maintenance.screen`/`.retry`, `update.force.screen`/`.store-button`, `update.prompt.*`                                                                             |
| 게임          | `game.screen`, `game.field`, `game.settings`, `game.menu.*`, `game.play.<id>`, `game.option.*`, `game.player.<role>`, `game.start`, `game.live`, `game.result.next` |
| 탭            | `tabs.todos`, `tabs.settings`                                                                                                                                       |
| Todos 생성    | `todos.create.input` / `.submit` (+ `todos.create.input.error`)                                                                                                     |
| Todos 목록    | `todos.list`, `todos.item.<id>`, `todos.item.<id>.toggle`, `todos.item.<id>.delete`                                                                                 |
| Todos 상태    | `todos.loading`, `todos.error`, `todos.error.retry`, `todos.empty`, `todos.footer.loading`                                                                          |
| 필터          | `todos.filter.all` / `.open` / `.done`                                                                                                                              |
| 설정          | `settings.locale.*`, `settings.theme.*`, `settings.design.*`, `settings.check-update`, `settings.design-system-link`                                                |
| 배너          | `notice.banner`, `offline.banner`                                                                                                                                   |
| 디자인 시스템 | `design-system.screen`, `design-system.section.<name>`, `ds.*`                                                                                                      |

`TextField`는 에러 표시 시 자동으로 `` `${testID}.error` `` 요소를 추가합니다. `TextArea`도 같고,
힌트(글자 수 등)가 있으면 `` `${testID}.hint` ``를 더합니다.

`Accordion`은 항목마다 `` `${testID}.trigger.<itemId>` ``(헤더 버튼)와
`` `${testID}.panel.<itemId>` ``(펼쳐지는 영역)를 파생합니다. 규칙은 웹 `Accordion`과 같습니다.
열림 여부는 트리거의 `expanded` 상태로 확인하세요. 닫힌 패널은 높이가 0이고 접근성 트리에서
빠집니다.

`Palette`는 `` `${testID}` ``(트리거), `.sheet`(+ `.sheet.close`), `.swatch.<hex>`(`#` 없는
소문자 hex, `selected` 상태), `.hex`(+ `.hex.error`), `.native`(iOS에만), `.contrast`를
파생합니다. 전체 표는 [palette-mobile.md](palette-mobile.md) §6에 있습니다.

오버레이(Modal / BottomSheet / Sidebar)는 `` `${testID}` ``(열려 있거나 닫히는 중일 때만
존재), `.panel`, `.title`, `.close`를 파생합니다. 열림과 닫힘은 `{testID}`가 있는지 없는지로
기다리세요. 모든 오버레이는 네이티브 레이어 하나 안에 그려지므로, 열린 오버레이 뒤의 화면
요소는 자동화 도구에서 보이지 않을 수 있습니다([overlay-mobile.md](overlay-mobile.md)).

설정의 디자인 선택지는 `settings.design.standard` / `.contrast` / `.office` / `.kids`입니다(upstream #28 이전 이름은 `.a` / `.b`).

## E2E — Maestro (권장)

시나리오는 [`apps/mobile/e2e/`](../apps/mobile/e2e)에 YAML로 있습니다:

- `boot-and-create-todo.yaml` — 부트(광고 스킵) → 할 일 생성/토글
- `settings-theme-design.yaml` — 테마/디자인(standard/contrast/office/kids)/언어 전환
- `design-system-palette.yaml` — 팔레트: 프리셋 선택, hex 오류/정상 입력
- `design-system-overlays.yaml` — 오버레이: 모달 위 확인창(LIFO), resolve 값, 시트/사이드바

실행 방법:

```bash
# 1. Maestro 설치 (1회)
curl -Ls https://get.maestro.mobile.dev | bash

# 2. 로컬 서버 + DB 기동
bun run db:setup && bun run dev:server

# 3. dev 빌드를 시뮬레이터/에뮬레이터에 설치하고 앱 기동
cd apps/mobile && bun run ios   # 또는 bun run android

# 4. 플로우 실행
maestro test apps/mobile/e2e/boot-and-create-todo.yaml
maestro test apps/mobile/e2e/    # 전체
```

Detox를 선호하면 같은 testID 레지스트리를 그대로 selector로 사용하면 됩니다 —
규약은 도구 중립적입니다.

## 새 요소를 추가할 때 체크리스트

1. `TESTID` 레지스트리에 항목 추가 (인라인 문자열 금지).
2. 인터랙티브 요소면 디자인 시스템 컴포넌트 사용 (testID 필수 prop이 강제됨).
3. 접근 가능한 이름 확인 — 아이콘 전용 버튼은 반드시 `accessibilityLabel`.
4. 비동기 상태가 있으면 위 표처럼 로딩/에러 신호 요소를 노출.
5. 이 문서의 요약 표를 갱신.
