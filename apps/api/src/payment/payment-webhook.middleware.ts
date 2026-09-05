import type { IncomingMessage, ServerResponse } from 'node:http'

import { buildErrorBody, writeErrorResponse } from '../common/error-response.js'
import { requestIdOf } from '../common/request-context.middleware.js'
import { MAX_WEBHOOK_BYTES } from './payment-webhook.js'

const PAYLOAD_TOO_LARGE = 413

/** 미들웨어가 본문을 얹어 두는 자리. Nest 의 `@Body()` 가 읽는 그 속성이다. */
interface RawBodyRequest extends IncomingMessage {
  body?: unknown
}

/**
 * 이 라우트에만 **원문(raw body)을 남긴다** (TASK-0056 F4).
 *
 * **Nest 는 기본적으로 body 를 파싱해 버려 원문이 남지 않는다.** `app.init()` 이
 * `express.json()` 을 등록하고, 그 파서는 스트림을 다 읽은 뒤 파싱 결과만
 * `req.body` 에 얹는다 — 바이트는 그 자리에서 버려진다. 그런데 서명은 **바이트에**
 * 걸려 있어(`signWebhook`), 파싱된 객체를 다시 직렬화한 것으로는 검증할 수 없다.
 * 키 순서와 공백이 달라지면 다른 바이트열이다.
 *
 * **`rawBody: true` 로 켜지 않은 이유**는 그것이 전역 스위치이기 때문이다. Nest 의
 * 그 옵션은 모든 라우트의 본문을 Buffer 로 한 벌 더 들고 있게 만들고, 그러려면
 * `main.ts` 와 통합 검사 하네스 두 곳의 `create` 호출을 함께 고쳐야 한다 — 웹훅
 * 하나 때문에 상품 등록과 장바구니의 메모리 사용이 바뀐다.
 *
 * **그래서 이 경로에만 건다.** `configure-app.ts` 가 `app.init()` **앞에서**
 * 이 미들웨어를 웹훅 경로에 마운트하므로, 실행 순서는 「원문 보존 → (다른 라우트는)
 * express.json」이 된다. 우리가 스트림을 끝까지 읽고 나면 `express.json` 은
 * 「이미 읽힌 요청」으로 보고 그대로 지나간다(body-parser 가 `onFinished` 로 그것을
 * 확인한다). 다른 라우트는 이 미들웨어를 지나지 않으므로 동작이 바뀌지 않는다.
 *
 * 얹는 자리를 `req.body` 로 고른 것은 컨트롤러가 `@Body()` 하나로 받게 하기
 * 위해서다. `req.rawBody` 같은 곁다리 속성을 쓰면 라우트가 `@Req()` 로 요청 객체
 * 전체를 받아야 하고, 그러면 express 의 타입이 컨트롤러까지 올라온다.
 */
export function createRawBodyCapture(limitBytes: number = MAX_WEBHOOK_BYTES) {
  return function rawBodyCapture(
    request: RawBodyRequest,
    response: ServerResponse,
    next: () => void,
  ): void {
    const chunks: Buffer[] = []
    let size = 0
    // 끝나는 길이 셋(다 읽음 · 한도 초과 · 연결 오류)이라 한 번만 끝나게 잠근다.
    let settled = false

    request.on('data', (chunk: Buffer) => {
      if (settled) return

      size += chunk.length

      if (size > limitBytes) {
        settled = true
        // 모아 둔 것을 버리고 **남은 바이트는 흘려보낸다.** 여기서 소켓을 끊으면
        // 아직 본문을 쓰고 있던 상대가 응답 대신 연결 오류를 받고, 그러면 413 이
        // 「너무 크다」가 아니라 「알 수 없는 실패」로 보인다. `resume()` 는 버퍼에
        // 쌓지 않고 읽어 버리므로 메모리는 상한 안에 남는다.
        chunks.length = 0
        request.resume()

        // `next(error)` 를 쓰지 않는다. express 의 오류 처리로 넘어가면 그쪽은
        // Nest 의 예외 필터가 아니라 프레임워크의 HTML 페이지라, 이 API 가 내는
        // 오류 형식이 두 가지가 된다 (`not-found.middleware.ts` 와 같은 이유).
        writeErrorResponse(
          response,
          PAYLOAD_TOO_LARGE,
          buildErrorBody({ status: PAYLOAD_TOO_LARGE, requestId: requestIdOf(request) }),
        )

        return
      }

      chunks.push(chunk)
    })

    request.on('end', () => {
      if (settled) return
      settled = true
      request.body = Buffer.concat(chunks)
      next()
    })

    // 끊긴 연결이다. 답할 상대가 없으므로 쓰지 않고 끝만 낸다 — 대신 이 리스너가
    // 없으면 Node 가 처리되지 않은 `error` 이벤트로 프로세스를 내린다.
    request.on('error', () => {
      settled = true
    })
  }
}
