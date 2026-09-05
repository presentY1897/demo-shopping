import { cx } from '../lib/cx'
import { CheckIcon } from '../components/icons'
import type { DensityLevel } from '../density/density'
import {
  SHIPMENT_STATUSES,
  shipmentStepIndex,
  stepStateAt,
  type ShipmentStatus,
  type ShipmentStepState,
} from './shipment'

/**
 * 「지금 어디까지 왔나」를 한 줄로 (TASK-0061 F4).
 *
 * 이벤트가 하나도 없어도 그려진다. 발송 전(`READY`)의 화면에서 사용자가 알고
 * 싶은 것은 「아직 시작 안 했다」이고, 빈 타임라인은 그 말을 하지 못한다.
 *
 * **점 네 개는 장식이 아니라 목록이다.** `<ol>` 로 두면 스크린 리더가 「4개 중
 * 2번째」를 세어 주고, 그것이 눈으로 선을 훑는 것과 같은 정보다. 점과 선을
 * 그리는 요소는 전부 `aria-hidden` 이라 접근성 트리에는 **글자만** 남는다.
 *
 * 서버 렌더 가능 — 여기에는 상태도 핸들러도 없다.
 */

export interface ShipmentProgressLabels {
  /** `<ol>` 의 이름. 「배송 진행」 */
  readonly progressLabel: string
  readonly status: Readonly<Record<ShipmentStatus, string>>
  /**
   * 단계의 자리를 말로 옮긴 것 — 「완료 / 현재 / 예정」.
   *
   * 이것이 색 대신 정보를 나르는 쪽이다. 화면에서는 채워진 점·체크 표시·빈 점이
   * 같은 말을 하고, 스크린 리더에는 이 문구가 읽힌다.
   */
  readonly stepState: Readonly<Record<ShipmentStepState, string>>
}

export interface ShipmentProgressProps {
  readonly status: ShipmentStatus
  readonly density: DensityLevel
  readonly labels: ShipmentProgressLabels
  readonly className?: string
}

/**
 * 점의 모양. **색이 유일한 단서가 되지 않도록** 셋을 서로 다른 형태로 만든다 —
 * 채워짐 + 체크 / 굵은 테두리 + 큼 / 빈 원.
 */
const MARKER_STYLES: Readonly<Record<ShipmentStepState, string>> = {
  done: 'size-4 border-primary bg-primary text-primary-fg',
  current: 'size-5 border-primary bg-surface text-primary',
  upcoming: 'size-4 border-border-strong bg-surface text-fg-subtle',
}

/** 단계 이름의 글자 크기. 미니멀은 아래에서 `sr-only` 로 가려진다. */
const NAME_SIZE: Readonly<Record<DensityLevel, string>> = {
  1: 'text-xs',
  2: 'text-xs',
  3: 'text-2xs',
}

export function ShipmentProgress({ status, density, labels, className }: ShipmentProgressProps) {
  const currentIndex = shipmentStepIndex(status)

  return (
    <ol aria-label={labels.progressLabel} className={cx('flex w-full items-start', className)}>
      {SHIPMENT_STATUSES.map((step, index) => {
        const state = stepStateAt(index, currentIndex)

        // 미니멀은 점만 남기고 이름을 시각적으로 감춘다 — 다만 **감출 뿐 지우지
        // 않는다**. 스크린 리더 사용자에게는 호버도 확대도 없으므로, 사라진
        // 이름은 「덜 어수선함」이 아니라 「덜 알려 줌」이 된다 (ProductCard 의
        // 브랜드명과 같은 판단).
        const hideName = density === 1 && state !== 'current'

        return (
          <li
            aria-current={state === 'current' ? 'step' : undefined}
            className="flex flex-1 flex-col items-center gap-1"
            key={step}
          >
            {/*
             * 점과 이어지는 선이 한 줄, 이름이 그 아래 한 줄. 선을 이름과 같은
             * 줄에 두면 이름이 두 줄로 접히는 순간(360px 의 긴 단계명) 선이 점을
             * 벗어나 가운데로 내려간다. 양 끝의 선은 지우는 대신 `invisible` 로
             * 남겨 네 점의 간격을 같게 유지한다.
             */}
            <span aria-hidden="true" className="flex w-full items-center gap-1">
              <span className={cx('h-px flex-1', index === 0 ? 'invisible' : 'bg-border')} />

              <span
                className={cx(
                  'flex shrink-0 items-center justify-center rounded-full border-2',
                  MARKER_STYLES[state],
                )}
              >
                {state === 'done' ? <CheckIcon className="size-2.5" /> : null}
              </span>

              <span
                className={cx(
                  'h-px flex-1',
                  index === SHIPMENT_STATUSES.length - 1 ? 'invisible' : 'bg-border',
                )}
              />
            </span>

            <span
              className={cx(
                'text-fg-muted text-center',
                NAME_SIZE[density],
                state === 'current' ? 'text-fg font-semibold' : '',
                hideName ? 'sr-only' : '',
              )}
            >
              {labels.status[step]}
            </span>

            {/* 형태로 이미 말한 것을 글자로도 말한다. 화면에는 없고 낭독에는 있다. */}
            <span className="sr-only">{labels.stepState[state]}</span>
          </li>
        )
      })}
    </ol>
  )
}
