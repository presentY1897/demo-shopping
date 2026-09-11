import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import { CLOCK, type Clock } from '../common/clock.js'
import { APP_CONFIG, type AppConfig } from '../config/app-config.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ThumbnailQueue } from './thumbnail-queue.js'
import { ThumbnailProcess, cleanOrphanedThumbnails } from './thumbnail-process.js'
import { thumbnailMemoryAvailable, THUMBNAIL_START_BYTES } from './thumbnail-memory.js'
import { thumbnailTargets } from './thumbnail-targets.js'

@Injectable()
export class ThumbnailService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ThumbnailService.name)
  private readonly process = new ThumbnailProcess()
  private readonly abort = new AbortController()
  private timer?: ReturnType<typeof setTimeout>
  private active?: Promise<void>
  private memoryDeferred = false
  private memoryWarningAt = -Infinity
  constructor(
    private readonly db: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  onApplicationBootstrap(): void {
    if (this.config.nodeEnv === 'test') return
    if (!this.config.thumbnailGeneration) {
      this.logger.log('썸네일 작업자 미실행: THUMBNAIL_GENERATION=off')
      return
    }
    if (this.config.storage === null) {
      this.logger.warn('썸네일 작업자 미실행: 이미지 저장소 설정 없음')
      return
    }
    this.logger.log('썸네일 작업자 시작 준비: 활성화됨 · 저장소 설정 있음 · 임시 파일 정리')
    void cleanOrphanedThumbnails()
      .catch(() => this.logger.warn('썸네일 임시 파일 정리 실패'))
      .finally(() => {
        if (this.abort.signal.aborted) return
        this.logger.log('썸네일 작업자 시작: 1초 간격 · 전체 동시성 1')
        this.schedule()
      })
  }
  private schedule(): void {
    if (this.abort.signal.aborted) return
    this.timer = setTimeout(() => {
      this.active = this.drain()
        .catch(() => this.logger.warn('썸네일 작업 실패: 대기열에서 재시도합니다.'))
        .finally(() => this.schedule())
    }, 1000)
  }
  async drain(): Promise<void> {
    const storage = this.config.storage
    if (storage === null || this.abort.signal.aborted) return
    const availableBytes = await thumbnailMemoryAvailable()
    if (availableBytes < THUMBNAIL_START_BYTES) {
      const now = performance.now()
      if (!this.memoryDeferred || now - this.memoryWarningAt >= 60_000) {
        this.logger.warn(
          `메모리 여유 또는 제한 정보를 확보하지 못해 썸네일 생성을 대기합니다. availableBytes=${availableBytes} requiredBytes=${THUMBNAIL_START_BYTES} (0은 여유 없음 또는 측정 불가)`,
        )
        this.memoryWarningAt = now
      }
      this.memoryDeferred = true
      return
    }
    if (this.memoryDeferred)
      this.logger.log(`썸네일 메모리 대기 해제: availableBytes=${availableBytes}`)
    this.memoryDeferred = false
    const started = performance.now()
    const queue = new ThumbnailQueue(this.db)
    const job = await queue.claim()
    if (job === null) return
    let result = null
    try {
      // Do not start a child after a delayed claim response has consumed the lease budget.
      if (performance.now() - started > 30_000) throw new Error('stale_claim')
      const command = thumbnailTargets(job, storage, this.clock.now())
      const outputs = await this.process.run(command, this.abort.signal)
      result = {
        thumbnailUrl: command.targets[0]!.publicUrl,
        cardImageUrl: command.targets[1]!.publicUrl,
        metadata: JSON.stringify({ version: 1, format: 'webp', outputs }),
      }
    } finally {
      await queue.finish(job, result)
    }
  }
  async onModuleDestroy(): Promise<void> {
    clearTimeout(this.timer)
    this.abort.abort()
    await this.active
  }
}
