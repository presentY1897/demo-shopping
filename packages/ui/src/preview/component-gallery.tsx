'use client'

/**
 * Every base component, every variant, on one page — in all three apps.
 *
 * The gallery lives in `packages/ui` rather than three times over in the apps
 * because that is what makes it evidence for TASK-0015 F5: shop, seller and
 * admin render *the same* component tree, so a difference between the three
 * screens can only come from a token an app overrides (its accent) and never
 * from a page that drifted.
 *
 * It carries no copy of its own. `packages/ui` cannot see an app's message
 * catalog and must not contain Korean, so every visible string arrives through
 * `messages` and each app supplies it from its own `ko.ts`.
 *
 * **This is a development tool with a deadline.** TASK-0104 replaces it with
 * Storybook, which also takes over the design-token documentation (D-206). The
 * order is deliberate: move first, delete afterwards, so there is never a period
 * with no way to look at the system.
 */

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import {
  Accordion,
  Avatar,
  Badge,
  BADGE_VARIANTS,
  Button,
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  Checkbox,
  Divider,
  Drawer,
  DRAWER_SIDES,
  IconButton,
  Input,
  Link,
  Modal,
  ModalClose,
  Popover,
  Radio,
  RadioGroup,
  Select,
  Switch,
  Tabs,
  Tag,
  Textarea,
  ToastProvider,
  TOAST_VARIANTS,
  Tooltip,
  useToast,
  type BadgeVariant,
  type ButtonSize,
  type ButtonVariant,
  type DrawerSide,
  type ToastVariant,
} from '../components'
import { CloseIcon } from '../components/icons'
import {
  DEFAULT_DENSITY,
  DENSITY_ATTRIBUTE,
  DENSITY_LEVELS,
  type DensityLevel,
} from '../density/density'
import { cx } from '../lib/cx'

export interface ComponentGalleryMessages {
  readonly title: string
  readonly description: string
  readonly devOnlyNotice: string
  /** Text of the link that leads here from the app's home page. */
  readonly linkLabel: string
  readonly density: {
    readonly legend: string
    readonly names: Readonly<Record<DensityLevel, string>>
    readonly hint: string
  }
  readonly sections: {
    readonly action: string
    readonly form: string
    readonly display: string
    readonly overlay: string
    readonly feedback: string
    readonly structure: string
  }
  readonly action: {
    readonly variants: Readonly<Record<ButtonVariant, string>>
    readonly sizes: Readonly<Record<ButtonSize, string>>
    readonly disabled: string
    readonly loading: string
    readonly submit: string
    readonly submitted: string
    readonly iconLabel: string
    readonly link: string
    readonly externalLink: string
    readonly externalHint: string
  }
  readonly form: {
    readonly emailLabel: string
    readonly emailPlaceholder: string
    readonly invalidLabel: string
    readonly invalidValue: string
    readonly messageLabel: string
    readonly messagePlaceholder: string
    readonly categoryLabel: string
    readonly categoryPlaceholder: string
    readonly categories: readonly { readonly value: string; readonly label: string }[]
    readonly agree: string
    readonly agreeDescription: string
    readonly marketing: string
    readonly shippingLabel: string
    readonly shipping: readonly { readonly value: string; readonly label: string }[]
    readonly notifications: string
  }
  readonly display: {
    readonly badges: Readonly<Record<BadgeVariant, string>>
    readonly tags: readonly { readonly id: string; readonly label: string }[]
    readonly removeLabel: string
    readonly avatarName: string
    readonly dividerLabel: string
  }
  readonly overlay: {
    readonly closeLabel: string
    readonly confirm: string
    readonly cancel: string
    readonly openModal: string
    readonly modalTitle: string
    readonly modalDescription: string
    readonly modalBody: string
    readonly drawerSides: Readonly<Record<DrawerSide, string>>
    readonly drawerTitle: string
    readonly drawerDescription: string
    readonly drawerBody: string
    readonly tooltipTrigger: string
    readonly tooltipContent: string
    readonly popoverTrigger: string
    readonly popoverTitle: string
    readonly popoverBody: string
  }
  readonly feedback: {
    readonly regionLabel: string
    readonly closeLabel: string
    readonly variants: Readonly<Record<ToastVariant, string>>
    readonly toastTitle: string
    readonly toastDescription: string
  }
  readonly structure: {
    readonly tabs: readonly {
      readonly value: string
      readonly label: string
      readonly body: string
    }[]
    readonly accordion: readonly {
      readonly value: string
      readonly label: string
      readonly body: string
    }[]
  }
}

interface GalleryProps {
  readonly messages: ComponentGalleryMessages
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="border-border flex flex-col gap-4 border-t pt-8">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Row({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>
}

/** One instance per page, so a literal id is unambiguous. */
const CATEGORY_LABEL_ID = 'gallery-category-label'

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-fg-muted">{label}</span>
      {children}
    </label>
  )
}

/**
 * The 밀도 3단계 switch (QUALITY-GATES U4).
 *
 * It writes to `<html>` rather than to a wrapper because overlays render through
 * a portal into `<body>`: a wrapper would leave every modal, drawer, tooltip and
 * toast on the page's own density and the comparison would quietly exclude the
 * components most likely to break. The previous value is restored on unmount, so
 * leaving the page does not strand `apps/shop` on whatever was selected here.
 */
function DensitySwitch({
  messages,
  density,
  onChange,
}: {
  readonly messages: ComponentGalleryMessages
  readonly density: DensityLevel
  readonly onChange: (level: DensityLevel) => void
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="text-fg-muted mb-2 text-sm">{messages.density.legend}</legend>
      {DENSITY_LEVELS.map((level) => (
        <Button
          aria-pressed={level === density}
          key={level}
          onClick={() => {
            onChange(level)
          }}
          size="sm"
          variant={level === density ? 'primary' : 'outline'}
        >
          {`${String(level)} · ${messages.density.names[level]}`}
        </Button>
      ))}
    </fieldset>
  )
}

/**
 * QUALITY-GATES U3 in visible form: the counter must not move while the button
 * says it is working, however many times it is clicked or Enter is pressed.
 */
function SubmitDemo({ messages }: GalleryProps) {
  const [pending, setPending] = useState(false)
  const [count, setCount] = useState(0)

  return (
    <form
      className="flex flex-wrap items-center gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        setCount((value) => value + 1)
        setPending(true)
        window.setTimeout(() => {
          setPending(false)
        }, 1200)
      }}
    >
      <Button loading={pending} type="submit">
        {pending ? messages.action.loading : messages.action.submit}
      </Button>
      <span className="text-fg-subtle text-sm">
        {`${messages.action.submitted}: ${String(count)}`}
      </span>
    </form>
  )
}

function ActionSection({ messages }: GalleryProps) {
  return (
    <Section title={messages.sections.action}>
      <Row>
        {BUTTON_VARIANTS.map((variant) => (
          <Button key={variant} variant={variant}>
            {messages.action.variants[variant]}
          </Button>
        ))}
      </Row>

      <Row>
        {BUTTON_SIZES.map((size) => (
          <Button key={size} size={size} variant="outline">
            {messages.action.sizes[size]}
          </Button>
        ))}
        <Button disabled>{messages.action.disabled}</Button>
        <Button loading>{messages.action.loading}</Button>
      </Row>

      <SubmitDemo messages={messages} />

      <Row>
        {BUTTON_VARIANTS.map((variant) => (
          <IconButton key={variant} label={messages.action.iconLabel} variant={variant}>
            <CloseIcon className="size-4" />
          </IconButton>
        ))}
      </Row>

      <Row>
        <Link href="#action">{messages.action.link}</Link>
        <Link href="#action" variant="subtle">
          {messages.action.link}
        </Link>
        <Link
          external
          externalLabel={messages.action.externalHint}
          href="https://www.w3.org/WAI/ARIA/apg/"
          variant="standalone"
        >
          {messages.action.externalLink}
        </Link>
      </Row>
    </Section>
  )
}

function FormSection({ messages }: GalleryProps) {
  return (
    <Section title={messages.sections.form}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={messages.form.emailLabel}>
          <Input placeholder={messages.form.emailPlaceholder} type="email" />
        </Field>

        <Field label={messages.form.invalidLabel}>
          <Input defaultValue={messages.form.invalidValue} invalid type="email" />
        </Field>

        <Field label={messages.form.messageLabel}>
          <Textarea placeholder={messages.form.messagePlaceholder} />
        </Field>

        {/*
          Not a `Field`: the Radix trigger is a `<button>`, and a `<label>` only
          labels a labelable element — wrapping one would leave the select with
          no accessible name at all. The association is made explicitly instead.
        */}
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-fg-muted" id={CATEGORY_LABEL_ID}>
            {messages.form.categoryLabel}
          </span>
          <Select
            aria-labelledby={CATEGORY_LABEL_ID}
            options={messages.form.categories}
            placeholder={messages.form.categoryPlaceholder}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Checkbox
          defaultChecked
          description={messages.form.agreeDescription}
          label={messages.form.agree}
        />
        <Checkbox label={messages.form.marketing} />
      </div>

      <RadioGroup
        aria-label={messages.form.shippingLabel}
        defaultValue={messages.form.shipping[0]?.value}
      >
        {messages.form.shipping.map((option) => (
          <Radio key={option.value} label={option.label} value={option.value} />
        ))}
      </RadioGroup>

      <Switch defaultChecked label={messages.form.notifications} />
    </Section>
  )
}

function DisplaySection({ messages }: GalleryProps) {
  const [removed, setRemoved] = useState<readonly string[]>([])

  return (
    <Section title={messages.sections.display}>
      <Row>
        {BADGE_VARIANTS.map((variant) => (
          <Badge key={variant} variant={variant}>
            {messages.display.badges[variant]}
          </Badge>
        ))}
      </Row>

      <Row>
        {messages.display.tags
          .filter((tag) => !removed.includes(tag.id))
          .map((tag) => (
            <Tag
              key={tag.id}
              onRemove={() => {
                setRemoved((current) => [...current, tag.id])
              }}
              removeLabel={messages.display.removeLabel}
            >
              {tag.label}
            </Tag>
          ))}
        <Tag variant="primary">{messages.display.avatarName}</Tag>
      </Row>

      <Row>
        <Avatar alt={messages.display.avatarName} size="sm" />
        <Avatar alt={messages.display.avatarName} size="md" />
        <Avatar alt={messages.display.avatarName} size="lg" />
      </Row>

      <Divider />
      <Divider label={messages.display.dividerLabel} />
      <div className="flex h-10 items-center gap-3">
        <span className="text-fg-muted text-sm">{messages.display.dividerLabel}</span>
        <Divider orientation="vertical" />
        <span className="text-fg-muted text-sm">{messages.display.dividerLabel}</span>
      </div>
    </Section>
  )
}

function OverlaySection({ messages }: GalleryProps) {
  return (
    <Section title={messages.sections.overlay}>
      <Row>
        <Modal
          closeLabel={messages.overlay.closeLabel}
          description={messages.overlay.modalDescription}
          footer={
            <>
              <ModalClose>
                <Button variant="outline">{messages.overlay.cancel}</Button>
              </ModalClose>
              <ModalClose>
                <Button>{messages.overlay.confirm}</Button>
              </ModalClose>
            </>
          }
          title={messages.overlay.modalTitle}
          trigger={<Button variant="outline">{messages.overlay.openModal}</Button>}
        >
          <p>{messages.overlay.modalBody}</p>
        </Modal>

        {DRAWER_SIDES.map((side) => (
          <Drawer
            closeLabel={messages.overlay.closeLabel}
            description={messages.overlay.drawerDescription}
            key={side}
            side={side}
            title={messages.overlay.drawerTitle}
            trigger={<Button variant="outline">{messages.overlay.drawerSides[side]}</Button>}
          >
            <p>{messages.overlay.drawerBody}</p>
          </Drawer>
        ))}
      </Row>

      <Row>
        <Tooltip content={messages.overlay.tooltipContent}>
          <Button variant="ghost">{messages.overlay.tooltipTrigger}</Button>
        </Tooltip>

        <Popover
          closeLabel={messages.overlay.closeLabel}
          title={messages.overlay.popoverTitle}
          trigger={<Button variant="ghost">{messages.overlay.popoverTrigger}</Button>}
        >
          <p className="text-fg-muted">{messages.overlay.popoverBody}</p>
          <Button size="sm">{messages.overlay.confirm}</Button>
        </Popover>
      </Row>
    </Section>
  )
}

function FeedbackSection({ messages }: GalleryProps) {
  const { toast } = useToast()

  return (
    <Section title={messages.sections.feedback}>
      <Row>
        {TOAST_VARIANTS.map((variant) => (
          <Button
            key={variant}
            onClick={() => {
              toast({
                description: messages.feedback.toastDescription,
                title: `${messages.feedback.toastTitle} · ${messages.feedback.variants[variant]}`,
                variant,
              })
            }}
            variant="outline"
          >
            {messages.feedback.variants[variant]}
          </Button>
        ))}
      </Row>
    </Section>
  )
}

function StructureSection({ messages }: GalleryProps) {
  return (
    <Section title={messages.sections.structure}>
      <Tabs
        items={messages.structure.tabs.map((tab) => ({
          content: <p className="text-fg-muted">{tab.body}</p>,
          label: tab.label,
          value: tab.value,
        }))}
      />

      <Accordion
        items={messages.structure.accordion.map((entry) => ({
          content: <p>{entry.body}</p>,
          title: entry.label,
          value: entry.value,
        }))}
        type="single"
      />
    </Section>
  )
}

export function ComponentGallery({ messages }: GalleryProps) {
  const [density, setDensity] = useState<DensityLevel>(DEFAULT_DENSITY)

  useEffect(() => {
    const root = document.documentElement
    const previous = root.getAttribute(DENSITY_ATTRIBUTE)
    root.setAttribute(DENSITY_ATTRIBUTE, String(density))

    return () => {
      if (previous === null) root.removeAttribute(DENSITY_ATTRIBUTE)
      else root.setAttribute(DENSITY_ATTRIBUTE, previous)
    }
  }, [density])

  return (
    <ToastProvider
      closeLabel={messages.feedback.closeLabel}
      regionLabel={messages.feedback.regionLabel}
    >
      <main className={cx('px-gutter mx-auto flex max-w-5xl flex-col gap-8 py-8')}>
        <header className="flex flex-col gap-4">
          <div>
            <h1 className="text-primary text-3xl font-bold">{messages.title}</h1>
            <p className="text-fg-muted mt-1">{messages.description}</p>
            <p className="text-fg-subtle mt-1 text-sm">{messages.devOnlyNotice}</p>
          </div>

          <DensitySwitch density={density} messages={messages} onChange={setDensity} />
          <p className="text-fg-subtle text-sm">{messages.density.hint}</p>
        </header>

        <ActionSection messages={messages} />
        <FormSection messages={messages} />
        <DisplaySection messages={messages} />
        <OverlaySection messages={messages} />
        <FeedbackSection messages={messages} />
        <StructureSection messages={messages} />
      </main>
    </ToastProvider>
  )
}
