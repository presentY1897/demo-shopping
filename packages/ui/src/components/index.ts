/**
 * The base component set (TASK-0015).
 *
 * A barrel rather than one entry point per component: the `'use client'`
 * boundary is drawn *inside* the modules, not by this file. A server component
 * importing `Badge` from here gets a server component, and importing `Modal`
 * gets a client reference — the bundler follows each module's own directive.
 * That is why `Button`, `Input` and `Divider` carry no directive at all: they
 * are renderable on the server, and only the components that need browser
 * behaviour (focus traps, listbox navigation, load state) opt into the client.
 */

export { Button, buttonClassName, BUTTON_SIZES, BUTTON_VARIANTS } from './button'
export type { ButtonProps, ButtonSize, ButtonStyleOptions, ButtonVariant } from './button'

export { IconButton, ICON_BUTTON_SIZES, ICON_BUTTON_VARIANTS } from './icon-button'
export type { IconButtonProps } from './icon-button'

export { Link, linkClassName, LINK_VARIANTS } from './link'
export type { LinkProps, LinkVariant } from './link'

export { Input, INPUT_SIZES } from './input'
export type { InputProps, InputSize } from './input'

export { Textarea } from './textarea'
export type { TextareaProps } from './textarea'

export { Select, SELECT_SIZES } from './select'
export type { SelectOption, SelectProps } from './select'

export { Checkbox } from './checkbox'
export type { CheckboxProps, CheckboxState } from './checkbox'

export { Radio, RadioGroup, RADIO_ORIENTATIONS } from './radio-group'
export type { RadioGroupProps, RadioOrientation, RadioProps } from './radio-group'

export { Switch } from './switch'
export type { SwitchProps } from './switch'

export { Badge, BADGE_SIZES, BADGE_VARIANTS } from './badge'
export type { BadgeProps, BadgeSize, BadgeVariant } from './badge'

export { Tag, TAG_VARIANTS } from './tag'
export type { TagProps, TagVariant } from './tag'

export { Avatar, AVATAR_SIZES } from './avatar'
export type { AvatarProps, AvatarSize } from './avatar'

export { Divider, DIVIDER_ORIENTATIONS } from './divider'
export type { DividerProps, DividerOrientation } from './divider'

export { Modal, ModalClose, MODAL_SIZES } from './modal'
export type { ModalProps, ModalSize } from './modal'

export { Drawer, DRAWER_SIDES } from './drawer'
export type { DrawerProps, DrawerSide } from './drawer'

export { Tooltip, TooltipProvider, TOOLTIP_SIDES } from './tooltip'
export type { TooltipProps, TooltipSide } from './tooltip'

export { Popover, POPOVER_ALIGNMENTS, POPOVER_SIDES } from './popover'
export type { PopoverAlign, PopoverProps, PopoverSide } from './popover'

export { ToastProvider, useToast, TOAST_VARIANTS } from './toast'
export type { ToastContextValue, ToastOptions, ToastProviderProps, ToastVariant } from './toast'

export { Tabs, TABS_ACTIVATION_MODES, TABS_ORIENTATIONS } from './tabs'
export type { TabItem, TabsActivationMode, TabsOrientation, TabsProps } from './tabs'

export { Accordion, ACCORDION_TYPES } from './accordion'
export type { AccordionItemSpec, AccordionProps, AccordionType } from './accordion'

export { CheckIcon, ChevronDownIcon, CloseIcon, MinusIcon } from './icons'
