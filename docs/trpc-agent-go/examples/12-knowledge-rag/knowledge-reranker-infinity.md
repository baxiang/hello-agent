# Infinity Reranker 示例 - 自托管 Cross-Encoder 重排

> **源码路径**：[`trpc-agent-go/examples/knowledge/reranker/infinity/`](../../../../trpc-agent-go/examples/knowledge/reranker/infinity)
> **示例类型**：检索质量增强（自托管） · **难度**：进阶

## 概述

`reranker/infinity/` 与 [`cohere`](./knowledge-reranker-cohere.md) 是一对镜像示例：代码结构、测试用例、对照输出几乎完全相同，唯一区别是后端——它通过 HTTP 调用**自托管**的 rerank 推理服务（Infinity 或 HuggingFace TEI），数据不离开本机。适合合规要求高、想用开源 reranker 模型（如 `BAAI/bge-reranker-v2-m3`）的场景。

## 核心概念

### Infinity vs TEI

两个流行的开源 reranker 推理引擎：

| 引擎 | 全称 | 特点 |
|------|------|------|
| **Infinity** | [michaelfeil/infinity](https://github.com/michaelfeil/infinity) | 高性能，自动 GPU/CPU 检测 |
| **TEI** | Text Embeddings Inference（HuggingFace 官方） | 官方维护，与 HF 生态贴合 |

本目录附带两个部署脚本：`deploy_infinity.py` 和 `deploy_reranker.py`，都把模型暴露成 HTTP `/rerank` 端点，对 Go 侧完全透明。

### 与 cohere 的代码差异

两者 99% 相同，只有创建 reranker 的部分不同：

```go
// cohere 版
r, _ := cohere.New(cohere.WithAPIKey(*apiKey), cohere.WithModel(*modelName))

// infinity 版
r, _ := infinity.New(
    infinity.WithEndpoint(*endpoint),     // http://localhost:7997/rerank
    infinity.WithModel(*modelName),       // BAAI/bge-reranker-v2-m3
)
```

`reranker.Query` / `reranker.Result` 数据结构、`Rerank(ctx, query, candidates)` 调用方式完全一致——这就是 `reranker.Reranker` 接口抽象的价值。

## 代码解析

### 默认 endpoint 探测

```go
func getDefaultEndpoint() string {
    if url := os.Getenv("INFINITY_URL"); url != "" { return url }
    return "http://localhost:7997/rerank"
}
```

支持 `INFINITY_URL` 环境变量覆盖，默认假设本地 7997 端口（与 `deploy_infinity.py` 默认端口对齐）。

### 三个测试用例（与 cohere 完全相同）

```go
testCases := []testCase{
    {name: "Lexical Overlap Trap", query: "How to kill a Python process?", ...},
    {name: "Semantic Precision",   query: "What year was Bitcoin created?", ...},
    {name: "Implicit Answer",      query: "Can I use React without Node.js?", ...},
}
```

### bge-reranker-v2-m3 的对照结果

以 Lexical Overlap Trap 为例：

```
--- Embedding Similarity (Bi-Encoder) ---
1. [0.718] Use kill -9 PID or pkill python to terminate a Python process.
2. [0.485] Python is a non-venomous snake that kills prey by constriction.
3. [0.454] Kill is a Unix command to send signals to processes.
4. [0.337] The process of learning Python takes about 3 months.
5. [0.269] Python programming language was created by Guido van Rossum.

--- Reranker Scores (Cross-Encoder) ---   ← bge-reranker-v2-m3
1. [0.9877] Use kill -9 PID or pkill python to terminate a Python process.
2. [0.0146] Python is a non-venomous snake that kills prey by constriction.
3. [0.0055] Kill is a Unix command to send signals to processes.
4. [0.0004] The process of learning Python takes about 3 months.
5. [0.0001] Python programming language was created by Guido van Rossum.
```

开源 bge-reranker 同样把"Python 蛇"压到 0.014，效果接近 Cohere v3.0。

## 运行方式

### 前置：部署 rerank 服务

```bash
# 方式 1：Infinity（自动 GPU/CPU）
python deploy_infinity.py --model BAAI/bge-reranker-v2-m3 --port 7997

# 方式 2：Transformers + FastAPI
python deploy_reranker.py --model BAAI/bge-reranker-v2-m3 --port 7997

# 方式 3：HuggingFace Inference Endpoints（托管）
# 在 https://ui.endpoints.huggingface.co/ 创建
```

### 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 是 | 用于 embedding 对比 |
| `OPENAI_BASE_URL` | 否 | 自定义端点 |
| `INFINITY_URL` | 否 | rerank 服务 URL（默认 `http://localhost:7997/rerank`） |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-endpoint` | rerank 服务 URL | `INFINITY_URL` 或 `http://localhost:7997/rerank` |
| `-model` | reranker 模型名 | `bge-reranker-v2-m3` |
| `-embedding-model` | OpenAI embedding 模型 | `text-embedding-3-small` |

### 运行命令

```bash
cd examples/knowledge/reranker/infinity
python deploy_infinity.py --model BAAI/bge-reranker-v2-m3 --port 7997 &

export OPENAI_API_KEY="sk-xxxx"
go run main.go
go run main.go -endpoint http://your-host.hf.space/rerank -model BAAI/bge-reranker-v2-m3
```

## 适用场景与对比

**选 infinity 当：**
- 金融/医疗/政务等合规场景，数据不能出境
- 想用 `bge-reranker-v2-m3` 等中文友好的开源模型
- 已有 GPU 服务器，想省 SaaS 费用
- 团队有 K8s 运维能力（Infinity 支持 K8s 部署）

**选 [`cohere`](./knowledge-reranker-cohere.md) 当：**
- 不想运维，付费用 SaaS
- 需要 Cohere 私有模型的高精度
- 团队已在 Cohere 生态

| 维度 | infinity | cohere |
|------|----------|--------|
| 部署复杂度 | 高（需部署推理服务） | 低（一个 API Key） |
| 数据出境 | 否 | 是 |
| 模型选择 | 任意 HF 模型 | Cohere 私有 |
| 中文支持 | bge 系列原生 | multilingual-v3.0 |
| 延迟 | 取决于本地硬件 | 网络 + Cohene 推理 |

## 关键要点

1. **接口透明**：与 cohere 共享 `reranker.Reranker` 接口，切换零代码改动。
2. **部署可选**：Infinity、TEI、HF Endpoints 三种部署方式都暴露同样的 `/rerank` HTTP。
3. **开源模型可用**：`BAAI/bge-reranker-v2-m3` 中文友好，是 cohere 的开源替代。
4. **三案例对照**：与 cohere 用同样的测试用例，便于横向比较模型效果。
5. **数据合规**：自托管满足金融/医疗等不出本地的要求。

## 总结

infinity reranker 是 cohere 的"私有化部署版本"，让重排能力落地到合规场景。代码层面只换 `cohere.New` → `infinity.New`，集成进 Knowledge Base 的方式完全相同。生产建议：先在 [`cohere`](./knowledge-reranker-cohere.md) 上验证 reranker 是否带来收益，确认有效后再用 infinity 私有化部署。
