# Web UI 模块分析

## 源码位置

`examples/web_ui/`

## 前端架构

```
web_ui/
├── src/
│   ├── components/
│   │   ├── ChatView.vue       # 聯天主界面
│   │   ├── MessageItem.vue    # 消息组件
│   │   ├── ToolCallCard.vue   # 工具调用卡片
│   │   ├── ThinkingBlock.vue  # 思考块渲染
│   │   ├── EventStream.vue    # 事件流容器
│   │   ├── InputBar.vue       # 输入框
│   │   └── AgentSelector.vue  # Agent 选择器
│   ├── stores/
│   │   ├── agentStore.ts      # Agent 状态管理
│   │   ├── sessionStore.ts    # Session 状态管理
│   │   ├── eventStore.ts      # Event 状态管理
│   ├── api/
│   │   ├── agentApi.ts        # Agent API 调用
│   │   ├── streamApi.ts       # SSE 流式 API
│   │   ├── sessionApi.ts      # Session API
│   ├── utils/
│   │   ├── eventParser.ts     # SSE 解析
│   │   ├── markdownRenderer.ts # Markdown 渲染
│   ├── App.vue                # 主应用
│   ├── main.ts                # 入口
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## 核心组件

### ChatView

```vue
<template>
  <div class="chat-view">
    <MessageList :messages="messages" />
    <InputBar @send="handleSend" :disabled="isLoading" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { streamMessage } from '@/api/streamApi'

const agentStore = useAgentStore()
const messages = ref<Message[]>([])
const isLoading = ref(false)

async function handleSend(text: string) {
  messages.value.push({ role: 'user', content: text })
  isLoading.value = true
  
  try {
    const events = await streamMessage(text)
    const assistantMsg = { role: 'assistant', content: '', events: [] }
    messages.value.push(assistantMsg)
    
    for await (const evt of events) {
      assistantMsg.events.push(evt)
      if (evt.type === 'TEXT_BLOCK_DELTA') {
        assistantMsg.content += evt.text
      }
    }
  } finally {
    isLoading.value = false
  }
}
</script>
```

### EventStream

```vue
<template>
  <div class="event-stream">
    <template v-for="evt in events" :key="evt.id">
      <TextBlock 
        v-if="evt.type === 'TEXT_BLOCK_DELTA'" 
        :text="evt.text" 
      />
      <ThinkingBlock 
        v-if="evt.type === 'THINKING_BLOCK_DELTA'" 
        :text="evt.text" 
      />
      <ToolCallCard 
        v-if="evt.type === 'TOOL_CALL_START'" 
        :tool-name="evt.tool_name"
        :tool-call-id="evt.tool_call_id"
      />
      <ToolResultBlock 
        v-if="evt.type === 'TOOL_RESULT_END'" 
        :state="evt.state"
      />
    </template>
  </div>
</template>
```

## SSE API

### streamApi.ts

```typescript
export async function streamMessage(message: string, agentName: string = 'default') {
  const response = await fetch(`/api/agents/${agentName}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  
  return {
    async *[Symbol.asyncIterator]() {
      let buffer = ''
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data.trim()) {
              yield JSON.parse(data)
            }
          }
        }
      }
    }
  }
}
```

## 状态管理

### agentStore.ts

```typescript
import { defineStore } from 'pinia'
import { fetchAgents } from '@/api/agentApi'

export interface Agent {
  name: string
  description: string
  model: string
}

export const useAgentStore = defineStore('agent', {
  state: () => ({
    agents: [] as Agent[],
    currentAgent: null as Agent | null,
    isLoading: false,
  }),
  
  actions: {
    async loadAgents() {
      this.isLoading = true
      try {
        this.agents = await fetchAgents()
        if (this.agents.length > 0 && !this.currentAgent) {
          this.currentAgent = this.agents[0]
        }
      } finally {
        this.isLoading = false
      }
    },
    
    selectAgent(agent: Agent) {
      this.currentAgent = agent
    },
  },
})
```

### eventStore.ts

```typescript
import { defineStore } from 'pinia'

export interface Event {
  id: string
  type: string
  timestamp: number
  // ... 其他字段
}

export const useEventStore = defineStore('event', {
  state: () => ({
    events: [] as Event[],
    currentReplyId: null as string | null,
  }),
  
  actions: {
    addEvent(evt: Event) {
      this.events.push(evt)
    },
    
    clearEvents() {
      this.events = []
    },
    
    getEventsByReplyId(replyId: string): Event[] {
      return this.events.filter(e => e.reply_id === replyId)
    },
  },
})
```

## 启动命令

```bash
cd examples/web_ui

# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 生产构建
pnpm build
```

## 设计模式

| 模式 | 应用 |
|---|---|
| **组件化** | Vue 组件拆分 |
| **状态管理** | Pinia Store |
| **观察者模式** | SSE 事件流 |