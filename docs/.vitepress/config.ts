import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Hello Agent',
  description: 'Agent 框架技术学习文档',
  
  base: '/hello-agent/',
  
  ignoreDeadLinks: [
    /localhost/,
  ],
  
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
  ],
  
  themeConfig: {
    logo: '/logo.svg',
    
    nav: [
      { text: '首页', link: '/' },
      { text: 'DeerFlow', link: '/deer-flow/' },
      { text: 'ADK-Go', link: '/adk-go/' },
      { text: 'AgentScope', link: '/agentscope/' },
      { text: 'Eino', link: '/eino/' },
      { text: 'Hiclaw', link: '/hiclaw/' },
    ],
    
    sidebar: {
      '/deer-flow/': [
        {
          text: 'DeerFlow 学习笔记',
          items: [
            { text: '项目概览', link: '/deer-flow/overview' },
            { text: '快速部署', link: '/deer-flow/deployment' },
            { text: 'Agent编排架构', link: '/deer-flow/agent' },
            { text: '技能与工具系统', link: '/deer-flow/skills' },
            { text: '沙箱与执行环境', link: '/deer-flow/sandbox' },
            { text: '记忆与上下文管理', link: '/deer-flow/memory' },
            { text: '完整架构分析', link: '/deer-flow/architecture' },
          ]
        }
      ],
      '/agentscope/': [
        {
          text: 'AgentScope',
          items: [
            { text: '简介', link: '/agentscope/' },
            { text: 'Java版本', link: '/agentscope/java' },
          ]
        }
      ],
    },
    
    socialLinks: [
      { icon: 'github', link: 'https://github.com/baxiang/hello-agent' }
    ],
    
    search: {
      provider: 'local'
    },
    
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026-present baxiang'
    }
  }
})