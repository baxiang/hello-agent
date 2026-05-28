import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Hello Agent',
  description: 'Agent 框架技术学习文档',
  
  base: '/hello-agent/',
  
  lang: 'zh-CN',
  
  lastUpdated: true,
  
  ignoreDeadLinks: true,
  
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
  ],
  
  themeConfig: {
    logo: '/logo.svg',
    
    nav: [
      { text: '首页', link: '/' },
      {
        text: 'Go 框架',
        items: [
          { text: 'ADK-Go', link: '/adk-go/' },
          { text: 'Eino', link: '/eino/' },
        ]
      },
      {
        text: 'Java 框架',
        items: [
          { text: 'AgentScope Java', link: '/agentscope/java/' },
        ]
      },
      {
        text: 'Python 框架',
        items: [
          { text: 'DeerFlow', link: '/deer-flow/' },
          { text: 'AgentScope Python', link: '/agentscope/' },
        ]
      },
      {
        text: '更多项目',
        items: [
          { text: 'Hiclaw', link: '/hiclaw/' },
        ]
      },
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
          text: '入门',
          items: [
            { text: '概览', link: '/adk-go/00-overview' },
            { text: '架构', link: '/adk-go/01-architecture' },
            { text: '快速开始', link: '/adk-go/02-quickstart' },
          ]
        },
        {
          text: '核心模块',
          items: [
            { text: 'Agent', link: '/adk-go/03-agent' },
            { text: 'Runner', link: '/adk-go/04-runner' },
            { text: '模型', link: '/adk-go/05-model' },
            { text: '工具', link: '/adk-go/06-tool' },
            { text: '会话', link: '/adk-go/07-session' },
            { text: '记忆', link: '/adk-go/08-memory' },
            { text: '产物', link: '/adk-go/09-artifact' },
            { text: '插件', link: '/adk-go/10-plugin' },
          ]
        },
        {
          text: '运维与示例',
          items: [
            { text: '部署', link: '/adk-go/11-server-deploy' },
            { text: '遥测', link: '/adk-go/12-telemetry' },
            { text: '示例', link: '/adk-go/13-examples-walkthrough' },
          ]
        },
        {
          text: 'Go 前置知识',
          items: [
            { text: '迭代器与 Pull 模式', link: '/adk-go/go-fundamentals/01-iterators' },
            { text: '接口与组合', link: '/adk-go/go-fundamentals/02-interfaces-composition' },
            { text: '函数选项模式', link: '/adk-go/go-fundamentals/03-functional-options' },
            { text: 'genai 内容类型', link: '/adk-go/go-fundamentals/04-genai-content' },
            { text: 'Context 与状态', link: '/adk-go/go-fundamentals/05-context-state' },
            { text: '错误处理', link: '/adk-go/go-fundamentals/06-error-handling' },
          ]
        }
      ],
      '/agentscope/java/': [
        {
          text: '入门',
          items: [
            { text: '概览', link: '/agentscope/java/00-overview' },
            { text: '架构', link: '/agentscope/java/01-architecture' },
            { text: '快速开始', link: '/agentscope/java/02-quickstart' },
          ]
        },
        {
          text: '核心模块',
          items: [
            { text: 'Agent 体系', link: '/agentscope/java/package-docs/agent' },
            { text: '消息体系', link: '/agentscope/java/package-docs/message' },
            { text: '模型接入', link: '/agentscope/java/package-docs/model' },
            { text: '工具系统', link: '/agentscope/java/package-docs/tool' },
            { text: 'Hook 事件', link: '/agentscope/java/package-docs/hook' },
            { text: '记忆系统', link: '/agentscope/java/package-docs/memory' },
            { text: 'Pipeline 编排', link: '/agentscope/java/package-docs/pipeline' },
          ]
        },
        {
          text: '扩展模块',
          items: [
            { text: 'Plan 系统', link: '/agentscope/java/package-docs/plan' },
            { text: 'RAG 模式', link: '/agentscope/java/package-docs/rag' },
            { text: 'Session 管理', link: '/agentscope/java/package-docs/session' },
            { text: 'State 管理', link: '/agentscope/java/package-docs/state' },
            { text: '优雅关闭', link: '/agentscope/java/package-docs/shutdown' },
            { text: '可观测性', link: '/agentscope/java/package-docs/tracing' },
          ]
        },
        {
          text: 'Java 前置知识',
          items: [
            { text: 'Java 17 新特性', link: '/agentscope/java/learning/01-java17-features' },
            { text: '泛型', link: '/agentscope/java/learning/02-generics' },
            { text: '接口与抽象类', link: '/agentscope/java/learning/03-interfaces' },
            { text: '注解', link: '/agentscope/java/learning/04-annotations' },
            { text: 'Builder 模式', link: '/agentscope/java/learning/05-builder-pattern' },
            { text: '函数式编程', link: '/agentscope/java/learning/06-functional' },
            { text: '并发编程', link: '/agentscope/java/learning/07-concurrent' },
            { text: '响应式编程', link: '/agentscope/java/learning/08-reactive' },
            { text: 'Jackson 序列化', link: '/agentscope/java/learning/09-jackson' },
            { text: '设计模式', link: '/agentscope/java/learning/10-design-patterns' },
            { text: 'LLM 核心概念', link: '/agentscope/java/learning/11-llm-concepts' },
          ]
        }
      ],
      '/agentscope/': [
        {
          text: 'AgentScope Python',
          items: [
            { text: '简介', link: '/agentscope/' },
          ]
        },
        {
          text: '架构详解',
          items: [
            { text: '架构总览', link: '/agentscope/architecture/README' },
            { text: 'Agent', link: '/agentscope/architecture/agent' },
            { text: '消息', link: '/agentscope/architecture/message' },
            { text: '模型', link: '/agentscope/architecture/model' },
            { text: '工具', link: '/agentscope/architecture/tool' },
            { text: '记忆', link: '/agentscope/architecture/memory' },
            { text: 'MCP', link: '/agentscope/architecture/mcp' },
            { text: '服务', link: '/agentscope/architecture/service' },
            { text: 'WebUI', link: '/agentscope/architecture/webui' },
            { text: '凭证', link: '/agentscope/architecture/credential' },
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
          text: '入门',
          items: [
            { text: '概览', link: '/eino/00-overview' },
            { text: '架构', link: '/eino/01-architecture' },
            { text: 'Schema', link: '/eino/02-schema' },
          ]
        },
        {
          text: '核心模块',
          items: [
            { text: '组件', link: '/eino/03-components' },
            { text: '组合', link: '/eino/04-compose' },
            { text: '回调', link: '/eino/05-callbacks' },
            { text: '流式处理', link: '/eino/06-flow' },
            { text: 'ADK 集成', link: '/eino/07-adk' },
          ]
        },
        {
          text: '高级主题',
          items: [
            { text: '预构建 Agent', link: '/eino/08-prebuilt-agents' },
            { text: '中间件', link: '/eino/09-middlewares' },
            { text: '快速开始', link: '/eino/10-quickstart' },
            { text: '示例', link: '/eino/11-examples' },
            { text: '前置知识', link: '/eino/12-prerequisites' },
          ]
        },
        {
          text: 'Go 前置知识',
          items: [
            { text: '泛型', link: '/eino/go-fundamentals/01-generics' },
            { text: '接口', link: '/eino/go-fundamentals/02-interfaces' },
            { text: '函数选项模式', link: '/eino/go-fundamentals/03-functional-options' },
            { text: 'Channel 与并发', link: '/eino/go-fundamentals/04-channel-concurrency' },
            { text: 'Context', link: '/eino/go-fundamentals/05-context' },
            { text: '错误处理', link: '/eino/go-fundamentals/06-error-handling' },
            { text: 'IO 模式', link: '/eino/go-fundamentals/07-io-pattern' },
            { text: '反射', link: '/eino/go-fundamentals/08-reflection' },
            { text: '结构体嵌入与标签', link: '/eino/go-fundamentals/09-struct-embedding-tags' },
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
    },

    docFooter: {
      prev: '上一页',
      next: '下一页'
    },

    outline: {
      label: '页面导航'
    },

    lastUpdated: {
      text: '最后更新于'
    },

    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
  }
})
// which is outside docs/. We need to tell VitePress to preserve symlinks.
