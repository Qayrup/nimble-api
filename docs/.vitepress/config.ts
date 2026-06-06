import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: 'Nimble-API',
  description: '轻量级 TypeScript API 服务框架 — 事件驱动、可扩展、类型安全',
  base: '/nimble-api/',

  head: [['link', { rel: 'icon', href: '/favicon.ico' }]],

  themeConfig: {
    logo: { light: '', dark: '' },

    nav: [
      { text: '首页', link: '/' },
      { text: '指南', link: '/guide/' },
      { text: 'EventHub', link: '/eventhub/' },
      { text: 'API Service', link: '/api-service/' },
      { text: 'API Extend', link: '/api-extend/' },
      { text: 'SSE', link: '/sse-service/' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '指南',
          items: [
            { text: '项目介绍', link: '/guide/' },
            { text: '快速开始', link: '/guide/getting-started' },
          ],
        },
      ],
      '/eventhub/': [
        {
          text: 'EventHub',
          items: [
            { text: '概述', link: '/eventhub/' },
            { text: 'API 参考', link: '/eventhub/api' },
            { text: '类型定义', link: '/eventhub/types' },
          ],
        },
      ],
      '/api-service/': [
        {
          text: 'API Service',
          items: [
            { text: '概述', link: '/api-service/' },
            { text: 'ApiClient', link: '/api-service/client' },
            { text: '缓存系统', link: '/api-service/cache' },
            { text: '适配器', link: '/api-service/adapters' },
            { text: '钩子系统', link: '/api-service/hooks' },
            { text: '重试策略', link: '/api-service/retry' },
            { text: '类型系统', link: '/api-service/types' },
            { text: 'TypedApi', link: '/api-service/typed' },
          ],
        },
      ],
      '/api-extend/': [
        {
          text: 'API Extend',
          items: [
            { text: '概述', link: '/api-extend/' },
          ],
        },
      ],
      '/sse-service/': [
        {
          text: 'SSE Service',
          items: [
            { text: '概述', link: '/sse-service/' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/qayrup/nimble-api' },
    ],

    editLink: {
      pattern: 'https://github.com/qayrup/nimble-api/edit/master/docs/:path',
      text: '在 GitHub 上编辑此页',
    },

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索' },
          modal: { noResultsText: '无结果', resetButtonTitle: '清除', displayDetails: '显示详情' },
        },
      },
    },

    lastUpdated: {
      text: '最后更新于',
    },

    docFooter: {
      prev: '上一页',
      next: '下一页',
    },

    outline: {
      label: '本页目录',
    },
  },

  markdown: {
    theme: { light: 'vitesse-light', dark: 'vitesse-dark' },
  },
});
