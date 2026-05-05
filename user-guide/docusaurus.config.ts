import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// Site config. Built output ships into ../docs/ via `npm run build`
// (see package.json scripts) — that's the directory GitHub Pages serves
// from, with org-level URL https://companions-online.github.io/.
const config: Config = {
  title: 'Companions Online',
  tagline: 'An isometric 2D MMO with mixed player + LLM interaction',
  favicon: 'img/favicon.png',

  url: 'https://companions-online.github.io',
  baseUrl: '/',
  organizationName: 'companions-online',
  projectName: 'companions-online',

  onBrokenLinks: 'warn',

  i18n: { defaultLocale: 'en', locales: ['en'] },

  markdown: {
    mermaid: true,
    hooks: { onBrokenMarkdownLinks: 'warn' },
  },
  themes: ['@docusaurus/theme-mermaid'],

  presets: [
    [
      'classic',
      {
        docs: {
          path: 'docs',
          routeBasePath: 'user-guide',
          sidebarPath: './sidebars.ts',
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      'posthog-docusaurus',
      {
        // TODO: replace with real project key.
        apiKey: 'TODO',
        appUrl: 'https://app.posthog.com',
        enableInDevelopment: false,
      },
    ],
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        hashed: true,
        indexDocs: true,
        indexPages: true,
        docsRouteBasePath: '/user-guide',
      },
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Companions Online',
      logo: {
        alt: 'Companions Online',
        src: 'img/favicon.png',
        href: '/',
      },
      items: [
        { to: '/user-guide/intro', label: 'User Guide', position: 'left' },
        {
          href: 'https://github.com/companions-online/companions-online',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            { label: 'User Guide', to: '/user-guide/intro' },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/companions-online/companions-online',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Companions Online.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
