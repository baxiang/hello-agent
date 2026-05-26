import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Hello Agent',
  description: 'Agent 框架技术学习文档',
  
  base: '/hello-agent/',
  
  ignoreDeadLinks: [
    /localhost/,
    /modules/,
    /demo/,
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
      '/adk-go/': [
        {
          text: 'ADK-Go 学习笔记',
          items: [
            { text: '概览', link: '/adk-go/00-overview' },
            { text: '架构', link: '/adk-go/01-architecture' },
            { text: '快速开始', link: '/adk-go/02-quickstart' },
            { text: 'Agent', link: '/adk-go/03-agent' },
            { text: 'Runner', link: '/adk-go/04-runner' },
            { text: '模型', link: '/adk-go/05-model' },
            { text: '工具', link: '/adk-go/06-tool' },
            { text: '会话', link: '/adk-go/07-session' },
            { text: '记忆', link: '/adk-go/08-memory' },
            { text: '产物', link: '/adk-go/09-artifact' },
            { text: '插件', link: '/adk-go/10-plugin' },
            { text: '部署', link: '/adk-go/11-server-deploy' },
            { text: '遥测', link: '/adk-go/12-telemetry' },
            { text: '示例', link: '/adk-go/13-examples-walkthrough' },
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
        },
        {
          text: '学习笔记',
          items: [
            { text: '概览', link: '/agentscope/learning/01-overview' },
            { text: 'Agent', link: '/agentscope/learning/02-agent' },
            { text: '工具', link: '/agentscope/learning/03-tool' },
            { text: '模型', link: '/agentscope/learning/04-model' },
            { text: '消息', link: '/agentscope/learning/05-message' },
            { text: '记忆', link: '/agentscope/learning/06-memory' },
            { text: 'MCP/A2A', link: '/agentscope/learning/07-mcp-a2a' },
            { text: '服务', link: '/agentscope/learning/08-service' },
            { text: 'WebUI', link: '/agentscope/learning/09-webui' },
            { text: '知识', link: '/agentscope/learning/10-knowledge' },
          ]
        }
      ],
      '/eino/': [
        {
          text: 'Eino 学习笔记',
          items: [
            { text: '概览', link: '/eino/00-overview' },
            { text: '架构', link: '/eino/01-architecture' },
            { text: 'Schema', link: '/eino/02-schema' },
            { text: '组件', link: '/eino/03-components' },
            { text: '组合', link: '/eino/04-compose' },
          ]
        }
      ],
      '/hiclaw/': [
        {
          text: 'Hiclaw 学习笔记',
          items: [
            { text: '概览', link: '/hiclaw/learning/01-hiclaw-overview' },
            { text: '架构', link: '/hiclaw/learning/02-architecture' },
            { text: '部署', link: '/hiclaw/learning/03-deployment' },
            { text: 'Controller', link: '/hiclaw/learning/04-controller' },
            { text: 'Manager', link: '/hiclaw/learning/05-manager' },
            { text: 'Worker', link: '/hiclaw/learning/06-worker' },
            { text: '基础设施', link: '/hiclaw/learning/07-infrastructure' },
            { text: '知识要求', link: '/hiclaw/learning/08-knowledge-requirements' },
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