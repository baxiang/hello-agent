# 03 - MCP Client 能力：Roots、Sampling、Elicitation 与辅助能力

MCP 不是“Server 暴露工具，Client 调用工具”这么简单。Client 也可以向 Server 暴露受控能力。理解 Client 能力，才能正确设计权限边界和高级工作流。

## 1. 为什么需要 Client 能力

Server 经常需要回答这些问题：

- 我能访问哪些工作区？
- 我是否能请求模型帮我生成内容？
- 我是否能向用户询问缺失参数？
- 我能否发送日志？
- 某个参数能不能自动补全？

如果这些能力由 Server 自己随意做，会造成安全问题：

- Server 直接读本地文件。
- Server 自己调用模型，绕过用户和 Host。
- Server 收集敏感凭证。
- Server 往 UI 塞不可信内容。

MCP 的做法是：这些能力必须由 Client/Host 明确声明和控制。

## 2. Roots

Roots 表示 Client 告诉 Server 的可操作边界。常见是工作区目录。

示例：Client 声明支持 roots 后，Server 可以请求列表。

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "roots/list",
  "params": {}
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "roots": [
      {
        "uri": "file:///Users/alice/project",
        "name": "project"
      }
    ]
  }
}
```

设计原则：

- Root 是边界提示，不是免校验通行证。
- Server 仍要校验路径穿越，例如 `../`。
- 多 root 时不要假设只有一个工作区。
- roots 变更时，Client 可以发送 `notifications/roots/list_changed`。

## 3. Sampling

Sampling 允许 Server 请求 Client 调用模型生成内容。

这很强大，也很敏感。因为它涉及：

- 模型成本。
- 上下文泄露。
- 用户意图。
- 模型供应商和策略。

示例：

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "sampling/createMessage",
  "params": {
    "messages": [
      {
        "role": "user",
        "content": {
          "type": "text",
          "text": "Summarize this database schema."
        }
      }
    ],
    "maxTokens": 500
  }
}
```

Client 可以：

- 接受请求。
- 修改或裁剪上下文。
- 选择模型。
- 要求用户确认。
- 拒绝请求。

Sampling 适合：

- Server 需要模型帮助处理自己的数据。
- Server 想生成 Resource 摘要。
- Server 想把复杂数据转成用户可读解释。

不适合：

- Server 绕过 Host 自己做 Agent。
- Server 请求完整聊天记录。
- Server 用模型处理敏感信息但不告知用户。

## 4. Elicitation

Elicitation 是 Server 通过 Client 向用户请求更多信息。

典型场景：

- Tool 参数不完整。
- 需要用户选择一个选项。
- 需要用户确认外部流程。
- 需要用户通过安全页面完成授权。

### 4.1 form 模式

适合普通结构化输入。

示例：

```json
{
  "jsonrpc": "2.0",
  "id": 20,
  "method": "elicitation/create",
  "params": {
    "message": "请选择要查询的环境",
    "requestedSchema": {
      "type": "object",
      "properties": {
        "environment": {
          "type": "string",
          "enum": ["dev", "staging", "prod"]
        }
      },
      "required": ["environment"]
    }
  }
}
```

### 4.2 url 模式

适合敏感或外部交互，例如 OAuth 登录、支付确认、企业审批。

原则：

- Host 应显示目标域名。
- 用户应明确知道要离开当前应用。
- 不要通过普通表单收集密码、API key、token、银行卡等敏感信息。

## 5. Logging

Server 可以发送日志，Client 可以设置日志级别。

设置日志级别：

```json
{
  "jsonrpc": "2.0",
  "id": 30,
  "method": "logging/setLevel",
  "params": {
    "level": "info"
  }
}
```

日志通知：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/message",
  "params": {
    "level": "info",
    "logger": "indexer",
    "data": "Index completed"
  }
}
```

日志不要包含：

- API key。
- 用户隐私数据。
- 完整文件内容。
- 内部 stack trace 中的敏感路径。

## 6. Completion

Completion 用于参数补全，常用于 Prompt 参数或 Resource URI 参数。

示例：补全 prompt 参数。

```json
{
  "jsonrpc": "2.0",
  "id": 40,
  "method": "completion/complete",
  "params": {
    "ref": {
      "type": "ref/prompt",
      "name": "review_code"
    },
    "argument": {
      "name": "path",
      "value": "src/"
    }
  }
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "id": 40,
  "result": {
    "completion": {
      "values": ["src/auth.ts", "src/server.ts"],
      "total": 2,
      "hasMore": false
    }
  }
}
```

Completion 能改善用户体验，但不能替代权限检查。补全结果也要遵守 roots 和访问控制。

## 7. Ping

Ping 用于健康检查。

```json
{
  "jsonrpc": "2.0",
  "id": 50,
  "method": "ping",
  "params": {}
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "id": 50,
  "result": {}
}
```

## 8. Client 能力设计清单

实现 Host 或 Client 时，应明确：

- 是否支持 roots？roots 如何随工作区变化更新？
- 是否支持 sampling？每次 sampling 是否需要用户确认？
- sampling 是否允许 Server 指定模型，还是 Host 统一选择？
- 是否支持 elicitation？表单字段怎么校验？
- URL elicitation 如何展示域名和风险？
- Server 日志显示在哪里？是否持久化？
- Completion 是否会泄露用户无权访问的路径或对象？

## 9. 本章检查点

读完本章，你应该能解释：

- Roots 和文件系统权限的关系。
- Sampling 为什么必须由 Host 控制。
- Elicitation 为什么不能直接收集敏感凭证。
- Completion 的体验价值和安全限制。
- MCP 为什么是双向能力协议。

