import { Badge } from '../components/badge'
import { cx } from '../lib/cx'
import type { DensityLevel } from '../density/density'
import { formatDate } from '../format/date'
import {
  latestTrackingEvent,
  sortTrackingEvents,
  type TrackingEvent,
  type TrackingEventKind,
} from './shipment'

/**
 * 실제 택배 조회 화면의 그 타임라인 (TASK-0061 4장).
 *
 * ## 눈에는 선과 점, 스크린 리더에는 순서 있는 목록
 *
 * 이 컴포넌트의 어려운 부분은 「선과 점」이 **그림**이라는 것이다. 점의 개수도
 * 선의 길이도 접근성 트리에서는 아무 뜻이 없으므로, 그것들을 그리는 요소는 전부
 * `aria-hidden` 이고 정보는 `<ol>` / `<li>` 가 나른다. 「4개 중 3번째」를 세어
 * 주는 것은 브라우저이고, 그것이 눈으로 선을 훑는 것과 같은 정보다.
 *
 * ## 「지금 여기」를 색으로만 말하지 않는 이유와 방법
 *
 * 마지막 이벤트를 파랗게 칠하면 그 사실은 **색을 보지 못하는 사람에게 사라진다**
 * (WCAG 1.4.1). 이 저장소는 같은 판단을 이미 한 번 했다 — 기본 배송지는 「배지 ·
 * 테두리 · 버튼의 부재」 셋으로 표시한다(`docs/design/pages.md`). 여기서는 셋을
 * 겹친다.
 *
 * | 무엇 | 누구에게 닿는가 |
 * | --- | --- |
 * | `aria-current="step"` | 보조기술. 「현재 항목」으로 읽힌다 |
 * | 눈에 보이는 「현재 위치」 배지 (`labels.currentPosition`) | 모두. **글자**라서 색을 못 봐도, 낭독으로 들어도 남는다 |
 * | 점의 크기·채움 차이 | 색이 아니라 형태. 흑백으로 인쇄해도 남는다 |
 *
 * 배지 하나로 충분하지 않겠느냐 — 충분하지 않다. `aria-current` 는 목록을
 * 훑어 내려가는 사람에게 「여기」를 **위치로** 알려 주고, 배지는 항목 하나를
 * 읽었을 때 그것이 무엇인지 알려 준다. 둘은 다른 순간에 쓰인다.
 *
 * 서버 렌더 가능.
 */

export interface TrackingTimelineLabels {
  /** `<ol>` 의 이름. 「배송 추적 이력」 */
  readonly timelineLabel: string
  readonly eventKind: Readonly<Record<TrackingEventKind, string>>
  /** 마지막 이벤트에 붙는 눈에 보이는 문구. 「현재 위치」 */
  readonly currentPosition: string
}

export interface TrackingTimelineProps {
  readonly events: readonly TrackingEvent[]
  readonly density: DensityLevel
  readonly labels: TrackingTimelineLabels
  /** BCP 47. 없으면 런타임 로캘 — `formatDate` 의 규약 그대로다. */
  readonly locale?: string
  /**
   * IANA 시간대. **넘기는 것이 맞다.** 없으면 서버는 컨테이너의 시간대로,
   * 브라우저는 방문자의 시간대로 같은 시각을 다르게 그린다.
   */
  readonly timeZone?: string
  readonly className?: string
}

/** 항목 사이 여백만 밀도를 탄다. 무엇이 보이는가는 아래에서 따로 정한다. */
const ITEM_GAP: Readonly<Record<DensityLevel, string>> = {
  1: 'pb-5',
  2: 'pb-4',
  3: 'pb-2',
}

export function TrackingTimeline({
  events,
  density,
  labels,
  locale,
  timeZone,
  className,
}: TrackingTimelineProps) {
  const ordered = sortTrackingEvents(events)
  const latest = latestTrackingEvent(ordered)

  return (
    <ol aria-label={labels.timelineLabel} className={cx('flex w-full flex-col', className)}>
      {ordered.map((event, index) => {
        const isCurrent = latest !== null && event.id === latest.id
        const isLast = index === ordered.length - 1

        return (
          <li
            aria-current={isCurrent ? 'step' : undefined}
            className="flex gap-3"
            data-current={isCurrent || undefined}
            key={event.id}
          >
            {/* 선과 점 — 그림이므로 접근성 트리에서는 통째로 빠진다. */}
            <span aria-hidden="true" className="flex flex-col items-center gap-1">
              <span
                className={cx(
                  'mt-1 shrink-0 rounded-full border-2',
                  isCurrent
                    ? 'size-4 border-primary bg-primary'
                    : 'size-3 border-border-strong bg-surface',
                )}
              />
              {isLast ? null : <span className="bg-border w-px flex-1" />}
            </span>

            <div className={cx('flex min-w-0 flex-col gap-1', isLast ? '' : ITEM_GAP[density])}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-fg text-sm font-medium">{labels.eventKind[event.kind]}</span>
                {isCurrent ? (
                  <Badge size="sm" variant="primary">
                    {labels.currentPosition}
                  </Badge>
                ) : null}
              </div>

              <div className="text-fg-muted flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
                {/*
                 * `<time>` 은 기계가 읽는 값을 원본 그대로 남긴다. 화면의 글자는
                 * 로캘·시간대에 따라 달라지지만 `dateTime` 은 서버가 보낸 ISO 다.
                 */}
                <time dateTime={event.occurredAt}>
                  {formatDate(event.occurredAt, { locale, style: 'dateTime', timeZone })}
                </time>
                <span className="text-fg">{event.location}</span>
              </div>

              {/* 설명은 표준부터. 미니멀은 「어디까지 왔나」만 답한다. */}
              {density >= 2 ? <p className="text-fg-subtle text-xs">{event.description}</p> : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
