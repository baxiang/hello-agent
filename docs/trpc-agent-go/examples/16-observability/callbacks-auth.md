# 鉴权与审计回调（Auth）- 用 Invocation State 传递用户上下文

> **源码路径**：[`trpc-agent-go/examples/callbacks/auth/`](../../../../trpc-agent-go/examples/callbacks/auth)
> **示例类型**：交互式 Chat · **难度**：进阶

## 概述

`auth/` 子示例演示回调系统的一个高频实战用法：**通过 `Invocation.State` 在一次执行的各个回调之间共享用户上下文**，从而实现工具级别的鉴权和审计。模型本身不感知权限，所有检查发生在 `BeforeToolCallback`，所有日志写入发生在 `AfterToolCallback`。

与兄弟示例的差别：

- [`basic`](./callbacks-basic.md) 关注"如何干预执行"，本文关注"如何在回调间**安全传递状态**"
- [`timer`](./callbacks-timer.md) 用同样的 `Invocation.State` 机制传递计时数据，本文传递的是用户身份
- [`imagetool`](./callbacks-imagetool.md) 不依赖 State，而是改写工具返回的消息

## 核心概念

### Invocation State 是什么

`agent.Invocation` 是一次 Agent 执行的上下文对象。除了携带 AgentName、InvocationID、Message 等元数据，还内建了一个**线程安全、invocation 级别**的 KV 存储：

```go
args.Invocation.SetState(key, value)        // 写
v, ok := args.Invocation.GetState(key)      // 读
args.Invocation.DeleteState(key)            // 删
```

特点：

| 特性 | 说明 |
|------|------|
| 作用域 | 一次 Invocation 内有效，结束自动清理 |
| 并发安全 | 内置 RWMutex |
| 类型 | 任意 Go 类型（取出时需类型断言） |
| 可变性 | 可在任意回调里 Set/Get/Delete |

### 为什么不用 context.Context 或全局变量

| 方案 | 问题 |
|------|------|
| 全局变量 | 多并发请求互相污染、无线程安全 |
| `context.WithValue` | Context 不可变，回调里无法追加数据 |
| `Invocation.State` | invocation 级别隔离 + 可变 + 线程安全 ✅ |

### State Key 命名约定（本示例）

| Key | 存放对象 | 写入点 | 读取点 |
|-----|----------|--------|--------|
| `custom:user_context` | `*UserContext` | `BeforeAgent` | `BeforeTool` / `AfterTool` |
| `custom:audit_log` | `[]AuditEntry` | `AfterTool`（追加） | `AfterAgent`（汇总打印） |

加 `custom:` 前缀是为了避免与框架内部 key 冲突（参见 [`timer`](./callbacks-timer.md) 用 `agent:` / `model:` / `tool:` 前缀）。

## 代码解析

### 文件结构

- `main.go`：CLI、Runner 接线、交互循环（支持 `/switch`、`/whoami`）
- `callbacks.go`：用户上下文注入、鉴权、审计的回调实现
- `tools.go`：4 个模拟文件工具（`read_file` / `write_file` / `delete_file` / `list_files`）
- `user.go`：`UserContext` 结构、角色→权限映射、`hasPermission`

### 角色 / 权限 / 工具映射

```go
// 三种角色
const (
    roleAdmin = "admin"
    roleUser  = "user"
    roleGuest = "guest"
)

// 四种权限
const (
    permissionRead   = "read"
    permissionWrite  = "write"
    permissionDelete = "delete"
    permissionList   = "list"
)

// 角色 → 权限集合
func getPermissionsForRole(role string) []string {
    switch role {
    case roleAdmin: return []string{permissionRead, permissionWrite, permissionDelete, permissionList}
    case roleUser:  return []string{permissionRead, permissionWrite, permissionList}
    case roleGuest: return []string{permissionRead, permissionList}
    default:        return []string{}
    }
}

// 工具 → 必需权限
var toolPermissions = map[string][]string{
    toolReadFile:   {permissionRead},
    toolWriteFile:  {permissionWrite},
    toolDeleteFile: {permissionDelete},
    toolListFiles:  {permissionList},
}
```

### Step 1：BeforeAgent 注入用户上下文

```go
func (e *userContextExample) createBeforeAgentCallback() agent.BeforeAgentCallbackStructured {
    return func(ctx context.Context, args *agent.BeforeAgentArgs) (*agent.BeforeAgentResult, error) {
        userCtx := &UserContext{
            UserID:      e.userID,
            Role:        e.role,
            Permissions: getPermissionsForRole(e.role),
        }
        args.Invocation.SetState("custom:user_context", userCtx)
        return nil, nil
    }
}
```

真实生产环境里，这里会从 JWT、请求头或 tRPC metadata 中解析用户，而不是直接读 CLI 字段。

### Step 2：BeforeTool 校验权限

```go
func (e *userContextExample) createBeforeToolCallback() tool.BeforeToolCallbackStructured {
    return func(ctx context.Context, args *tool.BeforeToolArgs) (*tool.BeforeToolResult, error) {
        inv, _ := agent.InvocationFromContext(ctx)
        userCtxVal, ok := inv.GetState("custom:user_context")
        if !ok {
            return nil, errors.New("user context not found - authentication required")
        }
        userCtx := userCtxVal.(*UserContext)

        if !hasPermission(userCtx, args.ToolName) {
            errMsg := fmt.Sprintf("permission denied: user %s (role: %s) cannot use tool %s",
                userCtx.UserID, userCtx.Role, args.ToolName)
            // 失败也要写审计
            e.appendAuditLog(inv, AuditEntry{
                Timestamp: time.Now().Format(time.RFC3339),
                UserID:    userCtx.UserID, Role: userCtx.Role,
                ToolName: args.ToolName, Error: "permission denied",
            })
            return nil, errors.New(errMsg)
        }
        return nil, nil
    }
}
```

> 注意：**鉴权失败以 `error` 形式返回**，而不是 `BeforeToolResult.CustomResult`。框架会把该 error 透传给工具调用方，模型据此生成"无权限"的回复。

### Step 3：AfterTool 追加审计日志

```go
entry := AuditEntry{
    Timestamp: time.Now().Format(time.RFC3339),
    UserID:    userCtx.UserID,
    Role:      userCtx.Role,
    ToolName:  args.ToolName,
    Args:      string(args.Arguments),
}
if args.Error != nil {
    entry.Error = args.Error.Error()
} else if args.Result != nil {
    entry.Result = fmt.Sprintf("%v", args.Result)
}
e.appendAuditLog(inv, entry)
```

`appendAuditLog` 每次取出旧切片、append、再写回 State——这是 State 里**修改集合类型**的标准范式（不能就地改，必须 Set 回去）。

### Step 4：AfterAgent 汇总并清理

```go
if auditLogVal, ok := args.Invocation.GetState("custom:audit_log"); ok {
    auditLog := auditLogVal.([]AuditEntry)
    // 打印汇总...
    args.Invocation.DeleteState("custom:audit_log")
}
args.Invocation.DeleteState("custom:user_context")
```

虽然 Invocation 结束后 State 会被框架自动回收，但显式 `DeleteState` 是好习惯，避免长生命周期 Invocation 的内存堆积。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 是 | 模型 API Key |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--user-id` | 用户 ID | `alice` |
| `--role` | 角色：`admin` / `user` / `guest` | `user` |
| `--model` | 模型名 | `deepseek-v4-flash` |

### 运行命令

```bash
cd examples/callbacks/auth
export OPENAI_API_KEY="your-api-key"

go run . --user-id alice   --role admin    # 全权限
go run . --user-id bob     --role user     # 不可 delete
go run . --user-id charlie --role guest    # 仅 read + list
```

### 交互命令

| 输入 | 效果 |
|------|------|
| `list files in the current directory` | 触发 `list_files` |
| `read the config.txt file` | 触发 `read_file` |
| `write 'hello' to test.txt` | 触发 `write_file` |
| `delete the old_data.txt file` | 触发 `delete_file`（普通用户会被拒） |
| `/switch bob admin` | 运行中切换用户与角色 |
| `/whoami` | 查看当前用户与权限 |
| `/exit` | 退出 |

### 预期输出（普通用户尝试 delete）

```
🔐 User Context and Authorization Example
...
✅ Example ready!
   User: bob
   Role: user
   Permissions: [read write list]
   Session: session-bob-1750000000

👤 You (bob, user): delete the old_data.txt file
👤 User Context Injected: bob (role: user, permissions: [read write list])
❌ permission denied: user bob (role: user) cannot use tool delete_file

📋 Audit Summary:
   ❌ [2025-...Z] bob (user) → delete_file
      Error: permission denied

🤖 Assistant: I don't have permission to delete files. Only administrators can perform this action.
```

## 适用场景与对比

**选 auth 当：**
- 需要在工具调用层做权限控制（而非网络层）
- 需要把用户上下文（租户、JWT claims、配额）一路透传到工具实现
- 需要审计每次工具调用
- 多租户 / SaaS 场景

**对比兄弟示例：**

| 维度 | auth | basic | timer | imagetool |
|------|------|-------|-------|-----------|
| 使用的 State Key | `custom:user_context`、`custom:audit_log` | 不用 | `agent:model:tool:*` | 不用 |
| 主要手法 | `hasPermission` + error 拒绝 | CustomResponse 短路 | `time.Since` + OTEL | 改写消息 |
| 是否需外部依赖 | 否 | 否 | OTEL Collector | 多模态模型 |
| 适用阶段 | 生产 | 调试 / Mock | 可观测 | 多模态 |

## 关键要点

1. **Invocation.State 是回调间共享状态的正解**：替代全局变量和不可变的 context.Value
2. **用户上下文在 BeforeAgent 注入**：所有后续回调从同一个 State 槽位读取
3. **鉴权失败用 error 返回**：而非 `CustomResult`，让框架把错误透传给模型
4. **修改集合类型必须 Set 回去**：State 存的是值，slice append 后要重新 `SetState`
5. **State Key 加前缀**：`custom:` 避免与框架内部 key 冲突
6. **显式 DeleteState**：长生命周期 Invocation 防内存泄漏的好习惯

## 总结

auth 示例把 `Invocation.State` 这把"手术刀"用在了最典型的位置：身份传播 + 鉴权 + 审计。同样的模式稍加改造就能做配额扣减、租户路由、A/B 实验分桶等。若想做**性能观测**而非鉴权，下一站是 [`timer`](./callbacks-timer.md)；若想看到回调如何**改变消息形状**，下一站是 [`imagetool`](./callbacks-imagetool.md)。回到 [`callbacks`](./callbacks.md) 索引页查看完整导航。
