# 09 - Web UI

## 前端架构

AgentScope Web UI 提供实时 Agent 交互界面。

### 目录结构

```
web_ui/
├── src/
│   ├── components/
│   │   ├── ChatView.vue       # 聊天界面
│   │   ├── MessageItem.vue    # 消息组件
│   │   ├── ToolCallCard.vue   # 工具调用卡片
│   │   └── EventStream.vue    # 事件流渲染
│   ├── stores/
│   │   ├── agentStore.ts      # Agent 状态
│   │   ├── sessionStore.ts    # Session 状态
│   └── api/
│   │   ├── agentApi.ts        # Agent API
│   │   ├── streamApi.ts       # SSE API
├── package.json
└── vite.config.ts
```

## 启动 Web UI

### 安装依赖

```bash
cd examples/web_ui
pnpm install
```

### 启动开发服务器

```bash
pnpm dev
```

### 访问界面

打开浏览器访问 `http://localhost:5173`

## 核心组件

### ChatView

```vue
<template>
  <div class="chat-view">
    <MessageList :messages="messages" />
    <InputBar @send="handleSend" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { sendMessage, streamMessage } from '@/api/agentApi'

const messages = ref([])

async function handleSend(text) {
  messages.value.push({ role: 'user', content: text })
  
  // 流式响应
  const events = await streamMessage(text)
  for await (const evt of events) {
    handleMessageEvent(evt)
  }
}
</script>
```

### EventStream

```vue
<template>
  <div class="event-stream">
    <div v-for="evt in events" :key="evt.id">
      <TextBlock v-if="evt.type === 'TEXT_BLOCK_DELTA'" :text="evt.text" />
      <ToolCallCard v-if="evt.type === 'TOOL_CALL_START'" :tool="evt" />
      <ThinkingBlock v-if="evt.type === 'THINKING_BLOCK_DELTA'" :text="evt.text" />
    </div>
  </div>
</template>
```

## SSE 连接

### 建立 SSE 连接

```typescript
// api/streamApi.ts
export async function streamMessage(message: string) {
  const response = await fetch('/api/agents/default/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  
  return {
    async *[Symbol.asyncIterator]() {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        const text = decoder.decode(value)
        const events = parseSSE(text)
        
        for (const evt of events) {
          yield JSON.parse(evt)
        }
      }
    }
  }
}
```

### 解析 SSE

```typescript
function parseSSE(text: string): string[] {
  const lines = text.split('\n')
  const events = []
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      events.push(line.slice(6))
    }
  }
  
  return events
}
```

## 事件渲染

### 实时文本渲染

```vue
<template>
  <span class="text-block">{{ text }}</span>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps<{ text: string }>()
</script>
```

### 工具调用可视化

```vue
<template>
  <div class="tool-call-card">
    <div class="tool-header">
      <span class="tool-name">{{ tool.tool_name }}</span>
      <span class="tool-status">{{ status }}</span>
    </div>
    <div class="tool-input">
      <pre>{{ tool.input }}</pre>
    </div>
    <div v-if="result" class="tool-result">
      <pre>{{ result }}</pre>
    </div>
  </div>
</template>
```

## Agent 状态管理

### Pinia Store

```typescript
// stores/agentStore.ts
import { defineStore } from 'pinia'

export const useAgentStore = defineStore('agent', {
  state: () => ({
    agents: [],
    currentAgent: null,
    isLoading: false,
  }),
  
  actions: {
    async loadAgents() {
      this.isLoading = true
      this.agents = await fetchAgents()
      this.isLoading = false
    },
    
    selectAgent(name: string) {
      this.currentAgent = this.agents.find(a => a.name === name)
    },
  },
})
```

## Session 管理

### Session Store

```typescript
// stores/sessionStore.ts
export const useSessionStore = defineStore('session', {
  state: () => ({
    sessionId: null,
    messages: [],
    contextLength: 0,
  }),
  
  actions: {
    async createSession(agentName: string) {
      const response = await createSessionAPI({ agent_name: agentName })
      this.sessionId = response.session_id
    },
    
    async loadSession(sessionId: string) {
      const data = await getSessionAPI(sessionId)
      this.sessionId = sessionId
      this.contextLength = data.context_length
    },
  },
})
```

## 完整集成示例

```typescript
// App.vue
<template>
  <div class="app">
    <AgentSelector :agents="agents" @select="selectAgent" />
    <ChatView :agent="currentAgent" />
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useAgentStore } from '@/stores/agentStore'

const agentStore = useAgentStore()

onMounted(async () => {
  await agentStore.loadAgents()
})

function selectAgent(name: string) {
  agentStore.selectAgent(name)
}
</script>
```

## 下一步

- [10-knowledge.md](10-knowledge.md) — 前置知识清单
- [demo/07-service](../../demo/07-service) — Service 示例