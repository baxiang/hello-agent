import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid({
  title: 'Hello Agent',
  description: 'Agent 框架技术学习文档',
  
  base: '/hello-agent/',
  
  lang: 'zh-CN',
  
  lastUpdated: true,
  
  ignoreDeadLinks: true,

  vite: {
    build: {
      chunkSizeWarningLimit: 3000,
    }
  },
  
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
          { text: 'LangChainGo', link: '/langchaingo/' },
          { text: 'Eino', link: '/eino/' },
          { text: 'tRPC-Agent-Go', link: '/trpc-agent-go/' },
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
          { text: 'ADK-Python', link: '/adk-python/' },
          { text: 'OpenAI Agents SDK', link: '/openai/' },
          { text: 'LangChain', link: '/langchain/' },
          { text: 'PydanticAI', link: '/pydantic-ai/' },
          { text: 'DeerFlow', link: '/deer-flow/' },
          { text: 'Mem0', link: '/llm-memory/mem0' },
          { text: 'AgentScope Python', link: '/agentscope/' },
        ]
      },
      {
        text: 'LLM 记忆',
        items: [
          { text: '对比总览', link: '/llm-memory/' },
          { text: 'Mem0 (57.7k)', link: '/llm-memory/mem0' },
          { text: 'SuperMemory (25.6k)', link: '/llm-memory/supermemory' },
          { text: 'Memori (15.2k)', link: '/llm-memory/memori' },
          { text: 'memU (13.8k)', link: '/llm-memory/memu' },
        ]
      },
      {
        text: '协议',
        items: [
          { text: 'OpenAI API 协议', link: '/openai-api/' },
          { text: 'Anthropic API 协议', link: '/anthropic-api/' },
          { text: 'A2A 协议', link: '/a2a/' },
          { text: 'MCP 协议', link: '/mcp/' },
        ]
      },
      {
        text: '平台',
        items: [
          { text: 'Langfuse', link: '/langfuse/' },
          { text: 'Hiclaw', link: '/hiclaw/' },
        ]
      },
    ],
    
    sidebar: {
      '/adk-python/': [
        {
          text: '入门',
          items: [
            { text: '概览', link: '/adk-python/00-overview' },
          ]
        },
        {
          text: 'Python 前置知识',
          items: [
            { text: 'asyncio 异步编程', link: '/adk-python/python-fundamentals/01-asyncio' },
            { text: 'Pydantic v2', link: '/adk-python/python-fundamentals/02-pydantic' },
            { text: '类型提示', link: '/adk-python/python-fundamentals/03-type-hints' },
            { text: '装饰器与数据类', link: '/adk-python/python-fundamentals/04-decorators-dataclasses' },
          ]
        }
      ],
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
            { text: 'Go 迭代器基础', link: '/go-iterators/' },
            { text: 'Go 迭代器从零精通', link: '/adk-go/go-fundamentals/01-iterators' },
            { text: '接口与组合', link: '/adk-go/go-fundamentals/02-interfaces-composition' },
            { text: '函数选项模式', link: '/adk-go/go-fundamentals/03-functional-options' },
            { text: 'genai 内容类型', link: '/adk-go/go-fundamentals/04-genai-content' },
            { text: 'Context 与状态', link: '/adk-go/go-fundamentals/05-context-state' },
            { text: '错误处理', link: '/adk-go/go-fundamentals/06-error-handling' },
            { text: '泛型', link: '/adk-go/go-fundamentals/07-generics' },
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
      '/openai-api/': [
        {
          text: '入门',
          items: [
            { text: '协议总览', link: '/openai-api/00-overview' },
          ]
        },
        {
          text: '核心协议',
          items: [
            { text: 'Messages 消息系统', link: '/openai-api/01-messages' },
            { text: '响应格式', link: '/openai-api/02-response' },
            { text: '流式协议 (SSE)', link: '/openai-api/03-streaming' },
            { text: 'Function Calling', link: '/openai-api/04-function-calling' },
            { text: '多模态输入与输出', link: '/openai-api/05-multimodal' },
            { text: '参数全解', link: '/openai-api/06-parameters' },
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
      '/langchaingo/': [
        {
          text: '入门',
          items: [
            { text: '概览', link: '/langchaingo/00-overview' },
            { text: '架构', link: '/langchaingo/01-architecture' },
            { text: '快速开始', link: '/langchaingo/02-quickstart' },
          ]
        },
        {
          text: '核心模块',
          items: [
            { text: 'LLM 模型层', link: '/langchaingo/package-docs/llms' },
            { text: 'Chain 编排', link: '/langchaingo/package-docs/chains' },
            { text: 'Agent 体系', link: '/langchaingo/package-docs/agents' },
            { text: '工具系统', link: '/langchaingo/package-docs/tools' },
            { text: '记忆系统', link: '/langchaingo/package-docs/memory' },
            { text: 'Prompt 模板', link: '/langchaingo/package-docs/prompts' },
          ]
        },
        {
          text: '扩展模块',
          items: [
            { text: '向量存储与嵌入', link: '/langchaingo/package-docs/embeddings-vectorstores' },
            { text: 'Callback 回调', link: '/langchaingo/package-docs/callbacks' },
            { text: 'OutputParser', link: '/langchaingo/package-docs/outputparser' },
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
      '/langfuse/': [
        {
          text: '入门',
          items: [
            { text: '概览', link: '/langfuse/00-overview' },
            { text: '架构', link: '/langfuse/01-architecture' },
            { text: '快速开始', link: '/langfuse/02-quickstart' },
          ]
        },
        {
          text: '核心模块',
          items: [
            { text: '数据模型', link: '/langfuse/package-docs/data-model' },
            { text: '摄取管道', link: '/langfuse/package-docs/ingestion-pipeline' },
            { text: '评估系统', link: '/langfuse/package-docs/evaluation' },
            { text: 'Prompt 管理', link: '/langfuse/package-docs/prompt-management' },
          ]
        },
        {
          text: '集成与部署',
          items: [
            { text: 'SDK 集成', link: '/langfuse/package-docs/sdk-integration' },
            { text: '基础设施', link: '/langfuse/package-docs/infrastructure' },
          ]
        }
      ],
      '/hiclaw/': [
        {
          text: '入门',
          items: [
            { text: '概览', link: '/hiclaw/learning/01-hiclaw-overview' },
            { text: '架构', link: '/hiclaw/learning/02-architecture' },
            { text: '部署', link: '/hiclaw/learning/03-deployment' },
          ]
        },
        {
          text: '核心组件',
          items: [
            { text: 'Controller', link: '/hiclaw/learning/04-controller' },
            { text: 'Manager', link: '/hiclaw/learning/05-manager' },
            { text: 'Worker', link: '/hiclaw/learning/06-worker' },
            { text: '基础设施', link: '/hiclaw/learning/07-infrastructure' },
            { text: '知识要求', link: '/hiclaw/learning/08-knowledge-requirements' },
          ]
        },
        {
          text: '架构详解',
          items: [
            { text: '架构总览', link: '/hiclaw/architecture/README' },
            { text: '完整架构分析', link: '/hiclaw/architecture/full-review' },
          ]
        }
      ],
      '/anthropic-api/': [
        {
          text: '入门',
          items: [
            { text: '协议总览', link: '/anthropic-api/00-overview' },
          ]
        },
        {
          text: '核心协议',
          items: [
            { text: 'Messages API 格式', link: '/anthropic-api/01-messages' },
            { text: '流式协议 (SSE)', link: '/anthropic-api/02-streaming' },
            { text: 'Tool Use 机制', link: '/anthropic-api/03-tool-use' },
            { text: '内容块 (Content Blocks)', link: '/anthropic-api/04-content-blocks' },
            { text: '扩展思考', link: '/anthropic-api/05-extended-thinking' },
            { text: '参数调优', link: '/anthropic-api/06-parameters' },
          ]
        }
      ],
      '/a2a/': [
        {
          text: 'A2A 协议',
          items: [
            { text: '从零理解 A2A', link: '/a2a/00-a2a-from-zero' },
            { text: 'Agent 发现与名片', link: '/a2a/01-agent-discovery-card' },
            { text: '消息与任务模型', link: '/a2a/02-message-task-model' },
            { text: '协议方法', link: '/a2a/03-protocol-methods' },
            { text: '安全架构', link: '/a2a/04-security-architecture' },
            { text: '实现指南', link: '/a2a/05-implementation-guide' },
          ]
        }
      ],
      '/mcp/': [
        {
          text: 'MCP 协议',
          items: [
            { text: '从零理解 MCP', link: '/mcp/00-mcp-from-zero' },
            { text: '协议架构', link: '/mcp/01-protocol-architecture' },
            { text: 'Server 能力', link: '/mcp/02-server-capabilities' },
            { text: 'Client 能力', link: '/mcp/03-client-capabilities' },
            { text: '传输与安全', link: '/mcp/04-transports-security' },
            { text: '实现指南', link: '/mcp/05-implementation-guide' },
          ]
        }
      ],
      '/openai/': [
        {
          text: '入门',
          items: [
            { text: '概览', link: '/openai/00-overview' },
          ]
        },
        {
          text: '核心概念',
          items: [
            { text: 'Agent 核心', link: '/openai/01-agent' },
            { text: '工具系统', link: '/openai/02-tools' },
            { text: 'Agent 转移 (Handoffs)', link: '/openai/03-handoffs' },
            { text: '护栏 (Guardrails)', link: '/openai/04-guardrails' },
            { text: '追踪 (Tracing)', link: '/openai/05-tracing' },
            { text: '会话与记忆', link: '/openai/06-sessions-memory' },
            { text: '实时语音 Agent', link: '/openai/07-realtime-voice' },
            { text: '沙箱 Agent', link: '/openai/08-sandbox' },
          ]
        }
      ],
      '/pydantic-ai/': [
        {
          text: 'PydanticAI',
          items: [
            { text: '从零理解 PydanticAI', link: '/pydantic-ai/00-pydantic-ai-from-zero' },
            { text: 'Agent 核心', link: '/pydantic-ai/01-agent-core' },
            { text: '结构化输出', link: '/pydantic-ai/02-structured-output' },
            { text: '工具与依赖', link: '/pydantic-ai/03-tools-deps' },
            { text: '流式与可观测性', link: '/pydantic-ai/04-streaming-observability-evals' },
            { text: 'MCP/A2A 与生产', link: '/pydantic-ai/05-mcp-a2a-production' },
          ]
        }
      ],
      '/llm-memory/': [
        {
          text: 'LLM 记忆层对比',
          items: [
            { text: '总览对比', link: '/llm-memory/' },
            { text: 'Mem0 (57.7k)', link: '/llm-memory/mem0' },
            { text: 'SuperMemory (25.6k)', link: '/llm-memory/supermemory' },
            { text: 'Memori (15.2k)', link: '/llm-memory/memori' },
            { text: 'memU (13.8k)', link: '/llm-memory/memu' },
          ]
        }
      ],
      '/mem0/': [
        {
          text: 'Mem0 源码学习',
          items: [
            { text: '源码深度学习笔记', link: '/mem0/' },
          ]
        }
      ],
      '/trpc-agent-go/': [
        {
          text: 'tRPC-Agent-Go',
          items: [
            { text: '技术调研报告', link: '/trpc-agent-go/' },
          ]
        }
      ],
      '/go-iterators/': [
        {
          text: 'Go 迭代器',
          items: [
            { text: '从零掌握 iter.Seq2', link: '/go-iterators/00-go-iterators-from-zero' },
          ]
        }
      ],
      '/langchain/': [
        {
          text: 'LangChain 入门',
          items: [
            { text: '模型基础', link: '/langchain/01-LangChain入门/01-模型基础' },
            { text: '消息系统', link: '/langchain/01-LangChain入门/02-消息系统' },
            { text: '流式与批量', link: '/langchain/01-LangChain入门/03-流式与批量' },
            { text: '工具调用', link: '/langchain/01-LangChain入门/04-工具调用' },
            { text: '结构化输出', link: '/langchain/01-LangChain入门/05-结构化输出' },
            { text: '提示工程', link: '/langchain/01-LangChain入门/06-提示工程' },
            { text: '入门实战', link: '/langchain/01-LangChain入门/07-入门实战' },
          ]
        },
        {
          text: 'LangGraph 入门',
          items: [
            { text: '图基础概念', link: '/langchain/02-LangGraph入门/01-图基础概念' },
            { text: 'State 与 Reducers', link: '/langchain/02-LangGraph入门/02-State与Reducers' },
            { text: 'Nodes 节点', link: '/langchain/02-LangGraph入门/03-Nodes节点' },
            { text: 'Edges 路由', link: '/langchain/02-LangGraph入门/04-Edges路由' },
            { text: 'Send 与 Command', link: '/langchain/02-LangGraph入门/05-Send与Command' },
            { text: '运行时上下文', link: '/langchain/02-LangGraph入门/06-运行时上下文' },
            { text: '可视化与调试', link: '/langchain/02-LangGraph入门/07-可视化与调试' },
            { text: '入门实战', link: '/langchain/02-LangGraph入门/08-入门实战' },
          ]
        },
        {
          text: 'Agent 入门',
          items: [
            { text: '工具定义', link: '/langchain/03-Agent入门/01-工具定义' },
            { text: '工具上下文', link: '/langchain/03-Agent入门/02-工具上下文' },
            { text: '创建 Agent', link: '/langchain/03-Agent入门/03-创建Agent' },
            { text: '系统提示词', link: '/langchain/03-Agent入门/04-系统提示词' },
            { text: 'ReAct 循环', link: '/langchain/03-Agent入门/05-ReAct循环' },
            { text: '结构化输出', link: '/langchain/03-Agent入门/06-结构化输出' },
            { text: '内存管理', link: '/langchain/03-Agent入门/07-内存管理' },
            { text: 'Agent 实战', link: '/langchain/03-Agent入门/08-Agent实战' },
          ]
        },
        {
          text: 'LangChain 进阶',
          items: [
            { text: '中间件概述', link: '/langchain/04-LangChain进阶/01-中间件概述' },
            { text: '自定义中间件', link: '/langchain/04-LangChain进阶/02-自定义中间件' },
            { text: '上下文工程', link: '/langchain/04-LangChain进阶/03-上下文工程' },
            { text: 'RAG 架构', link: '/langchain/04-LangChain进阶/04-RAG架构' },
            { text: '动态模型选择', link: '/langchain/04-LangChain进阶/05-动态模型选择' },
            { text: '动态工具选择', link: '/langchain/04-LangChain进阶/06-动态工具选择' },
            { text: '流式输出', link: '/langchain/04-LangChain进阶/08-流式输出' },
            { text: '进阶实战', link: '/langchain/04-LangChain进阶/09-进阶实战' },
          ]
        },
        {
          text: 'LangGraph 进阶',
          items: [
            { text: '记忆管理', link: '/langchain/05-LangGraph进阶/01-记忆管理' },
            { text: '长期记忆', link: '/langchain/05-LangGraph进阶/02-长期记忆' },
            { text: '中断与审核', link: '/langchain/05-LangGraph进阶/03-中断与审核' },
            { text: '多中断处理', link: '/langchain/05-LangGraph进阶/04-多中断处理' },
            { text: '持久化', link: '/langchain/05-LangGraph进阶/05-持久化' },
            { text: '子图架构', link: '/langchain/05-LangGraph进阶/06-子图架构' },
            { text: 'Map-Reduce', link: '/langchain/05-LangGraph进阶/07-Map-Reduce模式' },
            { text: '进阶实战', link: '/langchain/05-LangGraph进阶/09-进阶实战' },
          ]
        },
        {
          text: 'Agent 实战',
          items: [
            { text: '多 Agent 协作', link: '/langchain/06-Agent实战/01-多Agent协作' },
            { text: '中间件扩展', link: '/langchain/06-Agent实战/02-中间件扩展' },
            { text: '上下文工程实战', link: '/langchain/06-Agent实战/03-上下文工程实战' },
            { text: 'Guardrails', link: '/langchain/06-Agent实战/04-Guardrails与安全' },
            { text: '流式部署', link: '/langchain/06-Agent实战/05-流式部署' },
            { text: '生产部署', link: '/langchain/06-Agent实战/06-生产部署' },
            { text: '可观测性', link: '/langchain/06-Agent实战/07-可观测性' },
            { text: '实战项目合集', link: '/langchain/06-Agent实战/08-实战项目合集' },
          ]
        },
        {
          text: 'DeepAgents',
          items: [
            { text: '概述与快速入门', link: '/langchain/07-DeepAgents篇/01-概述与快速入门' },
            { text: '模型与工具配置', link: '/langchain/07-DeepAgents篇/02-模型与工具配置' },
            { text: '虚拟文件系统', link: '/langchain/07-DeepAgents篇/03-虚拟文件系统与后端' },
            { text: '子代理架构', link: '/langchain/07-DeepAgents篇/04-子代理架构' },
            { text: '上下文工程', link: '/langchain/07-DeepAgents篇/05-上下文工程' },
            { text: 'Skills 技能系统', link: '/langchain/07-DeepAgents篇/06-Skills技能系统' },
            { text: '权限控制与安全', link: '/langchain/07-DeepAgents篇/07-权限控制与安全' },
            { text: '沙箱执行环境', link: '/langchain/07-DeepAgents篇/08-沙箱执行环境' },
            { text: '人类审核', link: '/langchain/07-DeepAgents篇/09-人类审核' },
            { text: '生产部署', link: '/langchain/07-DeepAgents篇/10-生产部署' },
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
