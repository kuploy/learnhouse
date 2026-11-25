import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import dynamic from 'next/dynamic'

const ImageBlockComponent = dynamic(() => import('./ImageBlockComponent'), {
  ssr: false,
})

export default Node.create({
  name: 'blockImage',
  group: 'block',
  draggable: true,
  atom: true,

  addAttributes() {
    return {
      blockObject: {
        default: null,
      },
      // Screen readers read this out in place of the image. Imported courses
      // carry it in the block JSON, so it has to be a declared attribute:
      // tiptap drops anything it does not know when it parses the content.
      alt: {
        default: null,
      },
      size: {
        width: 300,
      },
      alignment: {
        default: 'center',
      },
      unsplash_url: {
        default: null,
      },
      unsplash_photographer_name: {
        default: null,
      },
      unsplash_photographer_url: {
        default: null,
      },
      unsplash_photo_url: {
        default: null,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'block-image',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['block-image', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockComponent as any)
  },
})
