import type { Meta, StoryObj } from '@storybook/react-vite'
import { ProductThumbnail, ProductIdentity } from '../../src/components'
const meta = {
  title: 'Components/ProductThumbnail',
  component: ProductThumbnail,
  args: { src: null, className: 'size-12' },
} satisfies Meta<typeof ProductThumbnail>
export default meta
export const Missing: StoryObj<typeof meta> = {}
export const WithName: StoryObj<typeof meta> = {
  render: () => <ProductIdentity src={null}>Wool coat</ProductIdentity>,
}
