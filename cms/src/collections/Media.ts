import type { CollectionConfig } from 'payload'

export const Media: CollectionConfig = {
  slug: 'media',
  labels: {
    singular: { ar: 'وسيط', en: 'Media' },
    plural: { ar: 'الوسائط', en: 'Media' },
  },
  access: { read: () => true },
  upload: {
    // Monorepo layout: uploads live in the astro app's public dir (Astro serves them statically
    // at /uploads/…). Resolved from the cms CWD (cms/), this is ../astro/public/uploads.
    staticDir: '../astro/public/uploads',
    mimeTypes: ['image/*'],
  },
  fields: [
    { name: 'alt', type: 'text', label: { ar: 'النص البديل', en: 'Alt text' } },
  ],
}
