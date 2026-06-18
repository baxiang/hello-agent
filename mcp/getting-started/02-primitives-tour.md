# 三大原语初体验

> [上一节](./01-first-server.md) 你写了一个含 1 个 Tool 的 MCP Server。但 Server 其实能暴露**三种**东西，本节各做一个最小例子。
>
> **本节你将学到**：MCP 三大原语——**Resources**（资源）、**Tools**（工具）、**Prompts**（提示词模板）——分别怎么写、什么时候用哪个。
>
> **一句话比喻**：三大原语像「**文件柜 / 工具箱 / 模板库**」——Resources 是只读的资料柜（你给模型看）、Tools 是可调用的工具箱（模型自己拿）、Prompts 是可复用的模板（用户主动选）。

## 三大原语一览

MCP Server 可以暴露三种原语：

| 原语 | 比喻 | 谁主导 | 典型场景 |
|------|------|--------|---------|
| **Resources** | 文件柜 | **应用**（Host 决定何时把资源塞给模型） | 暴露文件、数据库 schema、配置、API 文档 |
| **Tools** | 工具箱 | **模型**（LLM 自动决定调用） | 调用 API、执行查询、发邮件、操作外部系统 |
| **Prompts** | 模板库 | **用户**（用户主动选） | 预设工作流、slash 命令、可复用的复杂指令 |

::: tip 「谁主导」是核心设计点
很多人会混。MCP 规范明确区分：
- **Resources 是 application-driven**——由 Host 应用决定何时把资源内容塞进上下文
- **Prompts 是 user-controlled**——由用户在 UI 里主动选「用这个模板」
- **Tools 是 model-controlled**——由 LLM 在对话中自动决定是否调用

记住这条，能解决「这个功能该做成 Resource 还是 Tool」的疑问。
:::

## 用一个 Server 同时暴露三种原语

新建 `server.py`，用 FastMCP 装饰器一次性暴露三类：

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("demo")

# ========== 1. Resource：只读资源 ==========
@mcp.resource("config://app-settings")
def get_app_settings() -> str:
    """返回应用的当前配置（只读）"""
    return """
    theme: dark
    language: zh-CN
    max_file_size_mb: 100
    """

# ========== 2. Tool：可调用工具 ==========
@mcp.tool()
def search_docs(query: str, limit: int = 5) -> str:
    """在文档库里搜索关键词，返回匹配的文档标题"""
    # 演示：返回固定结果
    return f"搜到关于「{query}」的 {limit} 篇文档：[文档A, 文档B, ...]"

# ========== 3. Prompt：可复用模板 ==========
@mcp.prompt()
def code_review(code: str) -> str:
    """代码审查的预设提示词——用户可在 Host UI 里选这个 prompt"""
    return f"请审查这段代码，从安全、性能、可读性三个维度：\n\n{code}"

if __name__ == "__main__":
    mcp.run()
```

启动它（和上一节一样）：

```bash
uv run server.py
# 或用 Inspector 测：
npx @modelcontextprotocol/inspector uv run server.py
```

在 Inspector 里你会看到三个标签页：**Resources / Tools / Prompts**，每个标签页列出对应原语。下面分别看怎么测。

## Resource：只读资源

Resource 用 URI 标识（`config://app-settings`），Host 可以 `resources/list` 列出所有资源、`resources/read` 读具体内容。

**在 Inspector 里**：Resources 标签页 → 点 `config://app-settings` → 看返回的配置文本。

**在 Claude Desktop 里**：Claude 会把可用的 Resources 列在「📎 附件」菜单，你可以手动选哪些资源塞进当前对话。

**典型 Resource 场景**：
- `file:///path/to/README.md` —— 暴露本地文档
- `db://schema/users` —— 暴露数据库表结构
- `api://spec/github` —— 暴露 OpenAPI 规范
- `config://app-settings` —— 暴露配置（本例）

::: tip 什么时候用 Resource 而非 Tool
- **数据是「给模型读的上下文」** → Resource（文件内容、schema、文档）
- **数据是「执行动作的输入」** → Tool 的参数
- **要触发副作用**（写库、发邮件）→ 一定是 Tool，Resource 是只读的
:::

## Tool：可调用工具

Tool 是 LLM 自动决定调用的函数。它的声明带 `inputSchema`（FastMCP 自动从 Python 类型注解生成）。

**在 Inspector 里**：Tools 标签页 → 点 `search_docs` → 填参数 `query="MCP"` `limit=3` → Run。

返回类似：

```json
{
  "content": [
    { "type": "text", "text": "搜到关于「MCP」的 3 篇文档：[文档A, 文档B, ...]" }
  ]
}
```

**在 Claude Desktop 里**：用户问「帮我搜 MCP 的文档」，Claude 自动识别该调 `search_docs`，自动填参数、自动调用。

::: warning Tool 的 description 极重要
LLM 决定**是否调用、调用哪个**，唯一依据就是 Tool 的 `description`（FastMCP 自动取自 docstring）。描述写得烂的工具，永远不会被调用，或被错误调用。每个 Tool 都要写清楚：能干什么、什么时候该用、什么时候不该用。
:::

## Prompt：可复用模板

Prompt 是**用户主动选**的预设工作流。Host 会把它们做成菜单项（如 Claude 的 slash 命令、Cursor 的命令面板）。

**在 Inspector 里**：Prompts 标签页 → 点 `code_review` → 填 `code="<一段代码>"` → 看 Prompt 内容。

**在 Claude Desktop 里**：输入 `/` 调出命令面板 → 选 `code-review` → Claude 会让你填 code → 然后它用这个 Prompt 起一段对话。

返回的是组装好的 Prompt 文本，Host 把它当作用户的输入送给模型。

**典型 Prompt 场景**：
- 复杂代码审查工作流（如本例）
- 「调试这个报错」的标准化提问模板
- 「生成符合公司规范的 commit message」
- 「按这个架构图评审我的设计」

::: tip Prompt ≠ System Prompt
MCP 的 Prompt 是「**用户选用的预设工作流**」，不是「**系统的全局人设**」。Host 的全局 system prompt（如「你是 Claude」）由 Host 自己管，和 MCP Prompt 是两回事。
:::

## 怎么选：Resource vs Tool vs Prompt

当你不确定某个功能该做成哪个时，按这张表判断：

| 你的需求 | 做成 |
|---------|------|
| 暴露静态/半静态数据给模型当上下文（文档、schema、配置） | **Resource** |
| 让模型执行动作、产生副作用（查 API、写库、发消息） | **Tool** |
| 让用户一键触发复杂工作流（代码审查、调试、生成 commit） | **Prompt** |
| 既要返回数据又要触发动作 | 拆成两个：Resource + Tool |
| 既是数据又是预设流程 | 拆成两个：Resource + Prompt |

## 动手实验

1. **三类原语全跑通**：把本节的 `server.py` 跑起来，用 Inspector 在 Resources / Tools / Prompts 三个标签页各调用一次，亲眼看到三种返回。
2. **加 Resource**：给你的 Server 加一个 `file:///etc/hostname` 风格的 Resource，返回机器名，在 Inspector 里读它。
3. **加 Tool**：复制 [上一节](./01-first-server.md) 的 `get_weather` 进来，让这个 demo Server 同时有 Resource + 多个 Tool + Prompt。
4. **接 Claude 用 Prompt**：把这个 Server 接进 Claude Desktop，输入 `/` 看到你的 `code-review` 命令，填代码试用，体会 Prompt 是「用户主导」的工作流。
5. **判断题**：思考下面三个需求各该做成什么原语——「暴露公司 API 文档」「查询员工薪资」「标准化 bug 报告模板」（答案：Resource / Tool / Prompt）。
