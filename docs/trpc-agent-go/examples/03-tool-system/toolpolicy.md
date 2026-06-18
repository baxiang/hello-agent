# 工具权限策略 - 基于元数据的工具执行权限控制

## 概述

`toolpolicy` 示例演示如何结合工具元数据（ToolMetadata）和每次运行的权限策略（PermissionPolicy），实现基于角色的工具执行权限控制。不同于 `toolfilter` 在 LLM 请求中隐藏工具，权限策略在工具实际执行前进行拦截，返回允许、拒绝或需要审批三种决策。

## 核心概念

**工具元数据（ToolMetadata）**：描述工具的特性，如是否只读、是否具有破坏性、是否并发安全等。

**权限策略（PermissionPolicy）**：一个函数，接收工具的元数据和调用信息，返回权限决策：
- `tool.AllowPermission()`：允许执行
- `tool.DenyPermission(reason)`：拒绝执行，返回拒绝原因给模型
- `tool.AskPermission(reason)`：需要审批，返回审批原因给模型

## 代码解析

### 定义工具元数据

通过实现 `ToolMetadata()` 接口为工具附加元数据：

```go
type metadataTool struct {
    tool.CallableTool
    metadata tool.ToolMetadata
}

func (m metadataTool) ToolMetadata() tool.ToolMetadata {
    return m.metadata
}
```

为每个工具设置不同的元数据：

```go
// 读取库存工具 - 只读、并发安全
metadataTool{
    CallableTool: readTool,
    metadata: tool.ToolMetadata{
        ReadOnly:        true,
        ConcurrencySafe: true,
        SearchOrRead:    true,
    },
}

// 设置库存工具 - 具有破坏性
metadataTool{
    CallableTool: setTool,
    metadata: tool.ToolMetadata{
        Destructive: true,
    },
}
```

### 实现权限策略

权限策略函数根据用户角色和工具元数据做出决策：

```go
func (e *example) permissionPolicy(
    _ context.Context,
    req *tool.PermissionRequest,
) (tool.PermissionDecision, error) {
    switch e.role {
    case "admin":
        return tool.AllowPermission(), nil
    case "operator":
        if req.Metadata.Destructive {
            return tool.AskPermission("destructive changes require admin"), nil
        }
        return tool.AllowPermission(), nil
    case "viewer":
        if req.Metadata.Destructive {
            return tool.DenyPermission("viewer cannot change inventory"), nil
        }
        return tool.AllowPermission(), nil
    }
}
```

### 注册权限策略

通过 `agent.WithToolPermissionPolicyFunc` 在每次运行时设置：

```go
events, err := e.runner.Run(
    ctx, e.role, e.sessionID,
    model.NewUserMessage(text),
    agent.WithToolPermissionPolicyFunc(e.permissionPolicy),
)
```

### 权限决策的行为

- **Allow**：工具正常执行
- **Deny**：工具不执行，框架将拒绝原因作为工具结果返回给模型，模型会向用户解释
- **Ask**：工具不执行，框架将审批原因返回给模型。在实际应用中可以弹出审批 UI

## 运行方式

```bash
cd examples/toolpolicy
export OPENAI_API_KEY="your-key"

# 以 operator 角色运行（默认）
go run . --role operator

# 以 admin 角色运行（所有操作都允许）
go run . --role admin

# 以 viewer 角色运行（写操作被拒绝）
go run . --role viewer
```

尝试输入：
- `read the inventory`（所有角色都允许）
- `set notebook count to 8`（viewer 被拒绝，operator 需审批，admin 允许）

## 总结

- `ToolMetadata` 将工具特性（只读、破坏性等）与工具逻辑解耦
- 权限策略在工具执行前拦截，比 `toolfilter` 更适合安全控制
- 三种决策（Allow/Deny/Ask）覆盖了常见的权限管理场景
- 与 [toolfilter](./toolfilter.md) 的区别：过滤器控制 LLM 能看到哪些工具，权限策略控制工具能否被执行
