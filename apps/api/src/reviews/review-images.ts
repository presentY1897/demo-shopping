import { Inject, Injectable } from '@nestjs/common'
import type { ReviewImage } from '@shopping/shared'

import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import type { ObjectStorage } from '../storage/object-storage.js'
import { OBJECT_STORAGE } from '../storage/object-storage.js'

/**
 * 열쇠를 **화면이 그릴 수 있는 모양**으로 (TASK-0083 F6).
 *
 * 열쇠만 내려보내면 화면은 사진을 그릴 방법이 없다 — 열쇠를 주소로 바꾸는 규칙은
 * 저장소 설정에 달려 있고 그 설정은 서버에만 있다. 화면이 주소를 조립하면 저장소를
 * 옮기는 날 모든 화면이 함께 틀린다.
 *
 * **저장소가 설정되지 않았으면 `url` 이 `null` 이다.** `ObjectStorage.publicUrl` 은
 * 그 상태에서 503 을 던지는데, 그것을 그대로 흘리면 **R2 를 아직 붙이지 않은
 * 배포에서 리뷰 목록 전체가 열리지 않는다** — 사진을 못 보는 것과 리뷰를 못 읽는
 * 것은 다른 일이다. 클레임 사진이 같은 판단을 하고 그 이유가 저쪽에 적혀 있다
 * (`seller-claim.service.ts` 의 `photoOf`).
 *
 * 세 서비스가 같은 함수를 쓰는 이유는 그 판단이 한 곳에 있어야 하기 때문이다 —
 * 상품 상세와 마이페이지와 판매자 콘솔이 같은 사진을 서로 다르게 그리면 안 된다.
 */
@Injectable()
export class ReviewImageUrls {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  of(keys: readonly string[]): ReviewImage[] {
    return keys.map((key) => ({
      key,
      url: this.config.storage === null ? null : this.storage.publicUrl(key),
    }))
  }
}
