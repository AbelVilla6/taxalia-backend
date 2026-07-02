import type { PostRepository } from './repository.js';
import type { Post } from './schema.js';

const MULTIMEDIA_EN = `## Introduction

This is a normal Markdown post. You can write paragraphs, headings, lists and links as usual.

<figure class="blog-media blog-media--wide">
  <img src="/assets/blog/imagen-wide.jpg" alt="Wide example image" loading="lazy">
  <figcaption>Wide image used to separate important sections.</figcaption>
</figure>

## Image on the right

<figure class="blog-media blog-media--right">
  <img src="/assets/blog/detalle.jpg" alt="Detail image" loading="lazy">
  <figcaption>Side image aligned with the text.</figcaption>
</figure>

This paragraph flows around the image on desktop. On mobile, the image is stacked above the text automatically.

## External video

<figure class="blog-video">
  <iframe src="https://www.youtube.com/embed/ID_DEL_VIDEO" title="Embedded video" loading="lazy" allowfullscreen></iframe>
  <figcaption>External video with responsive 16:9 layout.</figcaption>
</figure>

<div class="blog-callout">
  <strong>Key idea:</strong> this structure keeps the blog in Markdown while allowing editorial control over images and videos.
</div>
`;

const MULTIMEDIA_ES = `## Introducción

Este es un artículo normal en Markdown. Puedes escribir párrafos, títulos, listas y enlaces con normalidad.

<figure class="blog-media blog-media--wide">
  <img src="/assets/blog/imagen-wide.jpg" alt="Imagen panorámica de ejemplo" loading="lazy">
  <figcaption>Imagen panorámica para separar secciones importantes.</figcaption>
</figure>

## Imagen a la derecha

<figure class="blog-media blog-media--right">
  <img src="/assets/blog/detalle.jpg" alt="Imagen de detalle" loading="lazy">
  <figcaption>Imagen lateral alineada con el texto.</figcaption>
</figure>

Este párrafo fluye alrededor de la imagen en escritorio. En móvil, la imagen se apila automáticamente sobre el texto.

## Vídeo externo

<figure class="blog-video">
  <iframe src="https://www.youtube.com/embed/ID_DEL_VIDEO" title="Vídeo explicativo" loading="lazy" allowfullscreen></iframe>
  <figcaption>Vídeo externo con maquetación responsive 16:9.</figcaption>
</figure>

<div class="blog-callout">
  <strong>Idea clave:</strong> esta estructura mantiene el blog en Markdown permitiendo control editorial sobre imágenes y vídeos.
</div>
`;

const VALUATION_EN = `## Why valuation matters

A clear valuation gives owners and investors a shared, data-driven basis for decisions.

- Income approach
- Market approach
- Asset-based approach

<div class="blog-callout">
  <strong>Takeaway:</strong> the right method depends on the company's stage and the purpose of the valuation.
</div>
`;

const VALUATION_ES = `## Por qué importa la valoración

Una valoración clara da a propietarios e inversores una base común y basada en datos para decidir.

- Enfoque de ingresos
- Enfoque de mercado
- Enfoque basado en activos

<div class="blog-callout">
  <strong>Conclusión:</strong> el método adecuado depende de la etapa de la empresa y del objetivo de la valoración.
</div>
`;

const SEED_POSTS: Post[] = [
  {
    slug: 'multimedia-post-example',
    lang: 'en',
    translationGroupId: 'multimedia-post',
    title: 'Multimedia post example',
    description:
      'Example article with images, videos, galleries and highlighted blocks in Markdown.',
    bodyMd: MULTIMEDIA_EN,
    author: 'Taxalia',
    heroImage: '/assets/blog/hero-blog.jpg',
    heroAlt: 'Workspace with documentation',
    tags: ['Blog', 'Multimedia', 'Astro'],
    draft: false,
    pubDate: '2026-06-09',
    updatedDate: '2026-06-09',
  },
  {
    slug: 'ejemplo-post-multimedia',
    lang: 'es',
    translationGroupId: 'multimedia-post',
    title: 'Ejemplo de post multimedia',
    description:
      'Artículo de ejemplo con imágenes, vídeos, galerías y bloques destacados en Markdown.',
    bodyMd: MULTIMEDIA_ES,
    author: 'Taxalia',
    heroImage: '/assets/blog/hero-blog.jpg',
    heroAlt: 'Mesa de trabajo con documentación',
    tags: ['Blog', 'Multimedia', 'Astro'],
    draft: false,
    pubDate: '2026-06-09',
    updatedDate: '2026-06-09',
  },
  {
    slug: 'business-valuation-101',
    lang: 'en',
    translationGroupId: 'valuation-101',
    title: 'Business Valuation 101',
    description:
      'A practical guide to understanding business valuation methods and how they support better decisions.',
    bodyMd: VALUATION_EN,
    author: 'Taxalia',
    heroImage: '/assets/images/blog-valuation.webp',
    heroAlt: 'Financial charts and a pen on a desk',
    tags: ['Valuation', 'Advisory'],
    draft: false,
    pubDate: '2026-05-20',
    updatedDate: null,
  },
  {
    slug: 'valoracion-de-empresas-101',
    lang: 'es',
    translationGroupId: 'valuation-101',
    title: 'Valoración de empresas 101',
    description:
      'Una guía práctica para entender los métodos de valoración de empresas y cómo ayudan a decidir mejor.',
    bodyMd: VALUATION_ES,
    author: 'Taxalia',
    heroImage: '/assets/images/blog-valuation.webp',
    heroAlt: 'Gráficos financieros y un bolígrafo sobre un escritorio',
    tags: ['Valoración', 'Asesoría'],
    draft: false,
    pubDate: '2026-05-20',
    updatedDate: null,
  },
];

/** Seeds example bilingual posts into an empty database when explicitly enabled. */
export async function seedIfEmpty(repo: PostRepository, enabled = false): Promise<boolean> {
  if (!enabled) return false;
  if ((await repo.count()) > 0) return false;
  for (const post of SEED_POSTS) {
    await repo.upsert(post);
  }
  return true;
}
