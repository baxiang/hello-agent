# Go 迭代器（iter.Seq2）从零到精通

> 一份独立的技术文章，帮助 Go 初学者彻底掌握 Go 1.23 迭代器协议。

## 学习目标

阅读本文后，你将能够：

1. **理解闭包**在工作中的实际角色——不再对 `func(yield func(...) bool)` 感到困惑
2. **手写迭代器**——从最简单的 `iter.Seq2` 到复杂的迭代器组合
3. **掌握 4 种核心组合模式**——转发、过滤、串联、循环
4. **读懂 ADK-Go 源码**中的迭代器用法——SequentialAgent、ParallelAgent、LoopAgent、LlmAgent
5. **调试迭代器问题**——识别常见陷阱，理解 yield 返回值和背压机制

## 阅读路径

| # | 内容 | 适合 |
|---|------|------|
| [00](./00-go-iterators-from-zero.md) | 闭包基础 → 迭代器构造 → 组合模式 → ADK 源码实战 | Go 初学者必读 |

## 文章结构

```
第 1 层：闭包入门（解决 "看不懂 func(yield) " 的问题）
第 2 层：从零构建迭代器（逐行追踪执行流程）
第 3 层：yield 返回值与背压（理解 break 如何生效）
第 4 层：4 种迭代器组合模式（ADK 的核心模式）
第 5 层：手写迷你 Agent 系统（独立可运行的完整代码）
第 6 层：ADK 源码迭代器拆解（附执行流程追踪）
第 7 层：完整调用链图（用户消息 → Runner → Agent → LLM）
第 8 层：常见陷阱
第 9 层：4 个梯度练习
```

## 相关链接

- ADK-Go 官方仓库：<https://github.com/google/adk-go>
- Go 1.23 Release Notes：<https://go.dev/doc/go1.23#iterators>
- iter 包文档：<https://pkg.go.dev/iter>
