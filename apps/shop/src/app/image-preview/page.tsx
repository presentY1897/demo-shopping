import { ProductCard } from '@shopping/ui/catalog'
import { formatMoney } from '@shopping/ui/format'
import { PageContainer } from '@shopping/ui/layout'
import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'

import { ProductGallery } from '@/components/products/product-gallery'
import { messagesFor } from '@/messages'

import { CoatVariants } from './coat-variants'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: '상품 이미지 미리보기',
  robots: { index: false, follow: false },
}

const product = {
  id: 'camel-wool-coat-preview',
  name: '오버핏 울 발마칸 코트',
  brandName: '루미에르',
  price: 189_000,
  listPrice: 249_000,
  imageUrl: '/images/products/camel-wool-coat-front.png',
  colors: ['#aa8057'],
  inStock: true,
}

const imageBase = '/product-image-sets/coat-v1/images/camel-wool-coat'
const shots = [
  ['front', '상품 정면'],
  ['model-front', '모델 착용 정면'],
  ['model-side', '모델 착용 측면'],
  ['model-back', '모델 착용 후면'],
  ['back', '상품 후면'],
  ['side', '상품 측면'],
  ['texture', '울 혼방 소재와 포켓 확대'],
  ['editorial', '모델 착용 연출'],
] as const
const images = shots.map(([key, label], sortOrder) => ({
  id: `camel-wool-coat-${key}`,
  url: `${imageBase}/${key}.png`,
  alt: `카멜 울 발마칸 코트 · ${label} — AI 생성 이미지`,
  sortOrder,
}))

export default function ImagePreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  const messages = messagesFor()

  return (
    <PageContainer className="space-y-12 py-10">
      <header className="space-y-2">
        <p className="text-fg-muted text-sm">상품 이미지 · 첫 번째 샘플</p>
        <h1 className="text-2xl font-semibold">카멜 울 코트</h1>
        <p className="text-fg-muted text-sm">
          AI로 생성한 이미지입니다. 상품 카드와 상세 화면에서 색감, 질감, 여백을 확인해보세요.
        </p>
        <a
          className="text-sm underline underline-offset-4"
          href="/product-image-sets/coat-v1/index.html"
        >
          상품 이미지 세트 보기 · 8컷 완성
        </a>
        <p>
          <a className="text-sm underline underline-offset-4" href="#variants">
            컬러 3가지와 헤링본 울 비교하기
          </a>
        </p>
      </header>

      <CoatVariants />

      <section aria-labelledby="card-heading" className="space-y-5">
        <h2 className="text-lg font-semibold" id="card-heading">
          상품 목록에서 보기
        </h2>
        <div className="grid max-w-4xl grid-cols-1 gap-8 sm:grid-cols-3">
          {([1, 2, 3] as const).map((density) => (
            <div className="mx-auto w-full max-w-64 space-y-3" key={density}>
              <h3 className="text-fg-muted text-sm">
                {['미니멀', '스탠다드', '맥시멀'][density - 1]}
              </h3>
              <ProductCard
                density={density}
                href="#detail"
                labels={messages.search.card}
                product={product}
              />
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="detail-heading" className="scroll-mt-24 space-y-5" id="detail">
        <h2 className="text-lg font-semibold" id="detail-heading">
          상세 이미지에서 보기
        </h2>
        <div className="grid items-start gap-8 md:grid-cols-2">
          <ProductGallery
            images={images}
            messages={messages.productDetail.gallery}
            productName={product.name}
          />
          <div className="space-y-5 md:py-6">
            <p className="text-fg-muted text-sm">{product.brandName}</p>
            <h3 className="text-2xl font-semibold">{product.name}</h3>
            <p className="text-2xl font-semibold">
              {formatMoney({ amount: product.price, currency: 'KRW' })}
            </p>
            <p className="text-fg-muted">카멜 · 오버핏 · 울 혼방</p>
            <p className="text-fg-muted text-sm">
              이미지의 + 버튼을 누르면 소재를 확대해서 볼 수 있습니다.
            </p>
            <a
              className="text-sm underline underline-offset-4"
              href={product.imageUrl}
              target="_blank"
              rel="noreferrer"
            >
              원본 이미지 열기
            </a>
          </div>
        </div>
      </section>
      <section
        aria-labelledby="intro-heading"
        className="border-border space-y-12 border-t pt-12"
        id="introduction"
      >
        <div className="mx-auto max-w-2xl space-y-3 text-center">
          <p className="text-fg-muted text-sm tracking-widest">LUMIÈRE · CAMEL WOOL COAT</p>
          <h2 className="text-3xl font-semibold" id="intro-heading">
            여유로운 선, 차분한 카멜
          </h2>
          <p className="text-fg-muted leading-relaxed">
            길게 떨어지는 실루엣과 부드럽게 이어지는 래글런 소매.
            <br />
            담백한 디자인의 울 발마칸 코트를 만나보세요.
          </p>
        </div>
        <Image
          alt="카멜 울 코트를 입고 자연스럽게 걸음을 옮기는 모델 — AI 생성 이미지"
          className="mx-auto h-auto w-full max-w-4xl rounded-md"
          height={1254}
          width={1254}
          sizes="(max-width: 768px) 100vw, 896px"
          src={`${imageBase}/editorial.png`}
        />
        <div className="space-y-5">
          <div className="space-y-2">
            <h3 className="text-xl font-semibold">어느 방향에서도 여유 있게</h3>
            <p className="text-fg-muted">
              정면부터 옆선과 뒷모습까지, 코트의 전체적인 비율을 살펴보세요.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {(['model-front', 'model-side', 'model-back'] as const).map((key, index) => (
              <figure className="space-y-2" key={key}>
                <Image
                  alt={`카멜 울 코트 모델 착용 ${['정면', '측면', '후면'][index]} — AI 생성 이미지`}
                  className="h-auto w-full rounded-md"
                  height={1254}
                  width={1254}
                  sizes="(max-width: 640px) 100vw, 33vw"
                  src={`${imageBase}/${key}.png`}
                />
                <figcaption className="text-fg-muted text-sm">
                  {['정면', '측면', '후면'][index]}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
        <div className="grid items-center gap-8 md:grid-cols-2">
          <Image
            alt="카멜색 울 혼방 원단과 웰트 포켓의 봉제 디테일 — AI 생성 이미지"
            className="h-auto w-full rounded-md"
            height={1254}
            width={1254}
            sizes="(max-width: 768px) 100vw, 50vw"
            src={`${imageBase}/texture.png`}
          />
          <div className="space-y-4">
            <p className="text-fg-muted text-sm">MATERIAL & DETAIL</p>
            <h3 className="text-2xl font-semibold">가까이에서 보는 울의 결</h3>
            <p className="text-fg-muted leading-relaxed">
              잔잔한 카멜색 원단의 표면과 간결한 웰트 포켓.
              <br />
              전체 실루엣에서 놓치기 쉬운 소재와 봉제 디테일을 확인해보세요.
            </p>
            <dl className="border-border grid grid-cols-2 gap-3 border-t pt-4 text-sm">
              <dt className="text-fg-muted">색상</dt>
              <dd>카멜</dd>
              <dt className="text-fg-muted">소재</dt>
              <dd>울 혼방</dd>
              <dt className="text-fg-muted">실루엣</dt>
              <dd>오버핏 · 래글런 소매</dd>
            </dl>
          </div>
        </div>
        <p className="text-fg-muted text-center text-xs">가상 상품의 AI 생성 이미지입니다.</p>
      </section>
    </PageContainer>
  )
}
