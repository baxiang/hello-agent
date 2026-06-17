# Human-in-the-Loop - 人工审批介入的报销流程 Agent

## 概述

Human-in-the-Loop（HIL）示例演示了如何在 tRPC-Agent-Go 框架中实现人工审批流程。以报销审批为场景，当金额超过阈值时 Agent 自动暂停执行、等待人工审批，审批通过后继续完成报销操作。该模式适用于涉及资金操作、权限变更等需要人工确认的高风险场景。

## 核心概念

### 长时运行工具（Long-Running Tool）

框架通过 `function.WithLongRunning(true)` 标记需要外部异步确认的工具调用。当 Agent 调用该工具时，框架不会立即将结果作为最终响应，而是暂停当前执行流程，等待外部输入（如人工审批结果）后再继续。

```go
function.NewFunctionTool(
    askForApproval,
    function.WithLongRunning(true),
    function.WithName("ask_for_approval"),
    function.WithDescription("Ask for approval for the reimbursement."),
)
```

### 事件驱动的审批流程

通过 `event.LongRunningToolIDs` 字段检测到长时运行工具调用后，外部系统可将审批结果作为新的用户消息注入到会话中，触发 Agent 继续执行。

## 代码解析

### Agent 定义（agent.go）

Agent 配置了两个工具和基于金额的审批策略：

```go
llmagent.WithInstruction(`
    If the amount is less than $100, automatically approve the reimbursement.
    If the amount is greater than $100, ask for approval from the manager.
    If the manager approves, call reimburse() to reimburse.
    If the manager rejects, inform the employee of the rejection.
`),
llmagent.WithTools([]tool.Tool{
    function.NewFunctionTool(reimburse, ...),        // 普通工具
    function.NewFunctionTool(askForApproval,          // 长时运行工具
        function.WithLongRunning(true), ...),
}),
```

`askForApproval` 返回包含 `status: "pending"` 和 `ticket_id` 的结构，表示等待审批。

### 事件处理与审批模拟（main.go）

主循环通过事件通道检测长时运行工具调用：

```go
if _, ok := e.LongRunningToolIDs[toolCall.ID]; ok {
    longRunningFunctionCall = &tc
    lastPendingTicketID = toolCall.ID
    fmt.Printf("Waiting for approval.\n")
}
```

检测到审批等待后，模拟外部审批并将结果注入会话：

```go
updated := map[string]string{
    "status":            "approved",
    "ticket_id":         lastPendingTicketID,
    "approver_feedback": "Approved by manager",
}
bts, _ := json.Marshal(updated)
processStreamingResponse(ctx, r, model.NewUserMessage(string(bts)))
```

Agent 收到审批结果后，根据状态决定调用 `reimburse()` 完成报销或通知拒绝。

### 流式响应处理

示例完整实现了流式响应的三种事件类型处理：工具调用事件（显示调用信息）、工具响应事件（显示执行结果）、文本内容事件（逐字输出 Assistant 回复）。

## 运行方式

**环境准备**：

```bash
export OPENAI_API_KEY="your-api-key"
```

**运行命令**：

```bash
go run ./examples/humaninloop/ --model deepseek-v4-flash --streaming=true
```

**交互示例**：

```
👤 You: Please reimburse $50 for meals
🤖 Assistant: (自动审批，直接完成报销)

👤 You: Please reimburse $200 for conference travel
🔧 Tool calls: ask_for_approval
⏸️ Waiting for human approval...
--- Simulating external approval ---
🤖 Assistant: Your reimbursement of $200 has been approved and processed.
```

## 总结

Human-in-the-Loop 模式通过长时运行工具实现了 Agent 执行流的暂停与恢复，是构建安全可控 Agent 系统的关键模式。在生产环境中，审批结果通常来自 Web 界面、消息队列或审批系统的回调，而非本示例中的自动模拟。该示例与 `guardrail` 示例互补——guardrail 在运行时自动拦截，HIL 则将决策权交给人类。
