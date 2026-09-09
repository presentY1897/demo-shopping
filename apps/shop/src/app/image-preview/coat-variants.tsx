'use client'

import Image from 'next/image'
import { useState } from 'react'

const base = '/product-image-sets/coat-variants-v1/images/camel-wool-coat'
const colors = [
  { name: '카멜', prefix: '', swatch: '#aa8057' },
  { name: '네이비', prefix: 'variant-navy-', swatch: '#1b2c4b' },
  { name: '차콜', prefix: 'variant-charcoal-', swatch: '#505152' },
] as const
const views = [
  { key: 'front', label: '상품 정면' },
  { key: 'model-front', label: '모델 착용' },
  { key: 'texture', label: '소재 확대' },
] as const
type View = (typeof views)[number]['key']

function viewClass(selected: boolean) {
  return `min-h-11 rounded-md border px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 ${
    selected ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface text-fg'
  }`
}

export function CoatVariants() {
  const [colorView, setColorView] = useState<Exclude<View, 'texture'>>('front')
  const [materialView, setMaterialView] = useState<View>('texture')

  return (
    <section aria-labelledby="variants-heading" className="scroll-mt-24 space-y-12" id="variants">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold" id="variants-heading">
          같은 코트, 다른 색과 소재
        </h2>
        <p className="text-fg-muted">
          구도와 디자인을 맞춘 이미지로 색상과 원단의 차이를 비교해보세요.
        </p>
      </header>

      <div className="space-y-5">
        <h3 className="text-lg font-semibold">컬러 3가지 · 울 혼방</h3>
        <div aria-label="컬러 비교 이미지 종류" className="flex flex-wrap gap-2" role="group">
          {views
            .filter((view) => view.key !== 'texture')
            .map((view) => (
              <button
                aria-pressed={colorView === view.key}
                className={viewClass(colorView === view.key)}
                key={view.key}
                onClick={() => {
                  setColorView(view.key)
                }}
                type="button"
              >
                {view.label}
              </button>
            ))}
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          {colors.map((color) => (
            <figure className="min-w-0 space-y-3" key={color.name}>
              <Image
                alt={`${color.name} 울 코트 ${colorView === 'front' ? '상품 정면' : '모델 착용'} — AI 생성 이미지`}
                className="h-auto w-full rounded-md"
                height={1254}
                width={1254}
                sizes="(max-width: 640px) 100vw, 33vw"
                src={`${base}/${color.prefix}${colorView}.png`}
              />
              <figcaption className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden="true"
                  className="size-3 rounded-full"
                  style={{ backgroundColor: color.swatch }}
                />
                {color.name}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>

      <div className="space-y-5">
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">소재 비교 · 카멜</h3>
          <p className="text-fg-muted text-sm">
            기존 울 혼방의 기모감과 헤링본 울의 V자 조직을 비교해보세요.
          </p>
        </div>
        <div aria-label="소재 비교 이미지 종류" className="flex flex-wrap gap-2" role="group">
          {views.map((view) => (
            <button
              aria-pressed={materialView === view.key}
              className={viewClass(materialView === view.key)}
              key={view.key}
              onClick={() => {
                setMaterialView(view.key)
              }}
              type="button"
            >
              {view.label}
            </button>
          ))}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {[
            { name: '기존 울 혼방', prefix: '' },
            { name: '헤링본 울', prefix: 'variant-herringbone-' },
          ].map((material) => (
            <figure className="min-w-0 space-y-3" key={material.name}>
              <Image
                alt={`카멜 ${material.name} ${views.find((view) => view.key === materialView)?.label ?? ''} — AI 생성 이미지`}
                className="h-auto w-full rounded-md"
                height={1254}
                width={1254}
                sizes="(max-width: 640px) 100vw, 50vw"
                src={`${base}/${material.prefix}${materialView}.png`}
              />
              <figcaption className="text-sm">{material.name}</figcaption>
            </figure>
          ))}
        </div>
      </div>
      <p className="text-fg-muted text-xs">
        가상 상품의 색상·소재 비교를 위한 AI 생성 이미지입니다.
      </p>
    </section>
  )
}
