export const appName = 'microfoom';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

export const gitConfig = {
  user: 'gintasz',
  repo: 'microfoom',
  branch: 'main',
};

// GitHub Pages serves the site under /microfoom, so static assets in public/
// must be referenced with the basePath prefix. Next only auto-prefixes
// next/link and next/image — raw <img src> strings need this helper.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const asset = (path: string): string => `${basePath}${path}`;
