# 第一次写 MCP Server：5 分钟跑通

> 本节带你用 Python 的 FastMCP 写一个**最小可运行的 MCP Server**，暴露一个工具，然后用官方 Inspector 工具连接验证。
>
> **本节你将学到**：装 SDK、写最小 Server（1 个 Tool）、用 stdio 启动、用 MCP Inspector 连接测试、最常见的 3 个错误。
>
> **一句话比喻**：本节像「**装一个最简的 USB-C U 盘并插上电脑试读**」——你先会做最简的一件，再去做复杂的。

## 准备：装好 Python 和 uv

MCP 的 Python SDK 主推用 [`uv`](https://docs.astral.sh/uv/) 管理依赖（比 pip 快、隔离干净）。先确认环境：

```bash
python3 --version    # 至少 3.10+
uv --version         # 没有就装：curl -LsSf https://astral.sh/uv/install.sh | sh
```

## 第一步：装 SDK 并建项目

```bash
uv init my-first-mcp
cd my-first-mcp
uv add "mcp[cli]"
```

这会创建一个 Python 项目，并把 `mcp` 包（含 FastMCP 和 CLI 工具）加进依赖。

::: tip 为什么用 FastMCP
MCP Python SDK 提供两种写 Server 的方式：底层 SDK（要手写 JSON-RPC 消息处理）和 **FastMCP**（装饰器风格，类似 FastAPI）。**新手一律用 FastMCP**——5 行代码就能跑起来，官方主推。本节和后续入门篇全部用 FastMCP。
:::

## 第二步：写最小 Server（一个工具）

新建 `server.py`：

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("weather")

@mcp.tool()
def get_weather(city: str) -> str:
    """查询指定城市的当前天气（演示用，返回固定值）"""
    # 真实项目里这里调真 API
    return f"{city} 现在 22°C，晴天"

if __name__ == "__main__":
    mcp.run()   # 默认用 stdio 传输
```

逐行看：

- `FastMCP("weather")` —— 创建一个 Server 实例，名字叫 `weather`
- `@mcp.tool()` —— **把这个函数声明为 MCP 工具**（自动从函数签名和 docstring 推导出 name/description/inputSchema）
- `mcp.run()` —— 启动 Server，默认用 **stdio 传输**（从标准输入读消息、写到标准输出）

::: warning 注意
**不要用 `print()` 调试！** stdio 传输下，标准输出是协议通道——任何 `print` 都会污染 JSON-RPC 消息，导致 Host 无法解析。要输出调试信息用 `print(..., file=sys.stderr)`。
:::

## 第三步：用 MCP Inspector 连接验证

MCP Inspector 是官方的交互式调试工具。开一个**新终端**运行：

```bash
npx @modelcontextprotocol/inspector uv run server.py
```

它会自动启动你的 Server，并打开一个本地网页（默认 `http://localhost:6274`）让你手动测试。

::: warning 首次会要求 Token
Inspector 因安全考虑（CVE-2025-49596）默认开启本地鉴权——它会打印一个 token 到终端，并自动打开浏览器带上这个 token。如果浏览器没自动开，手动复制终端里提示的 URL。
:::

在 Inspector 网页里：

1. **左侧**：连接状态、Server 名字、能力列表（应该看到 `tools` 被勾选）
2. **Tools 标签页**：列出所有工具（应该看到 `get_weather`）
3. 点 `get_weather` → 填入 `city` 参数（如 `Tokyo`）→ 点 **Run** → 看返回结果

返回类似：

```json
{
  "content": [
    { "type": "text", "text": "Tokyo 现在 22°C，晴天" }
  ]
}
```

**恭喜！你刚跑通了一个 MCP Server。** 它已经可以被任何兼容 MCP 的 Host（Claude Desktop、Cursor 等）使用了。

## 第四步（可选）：接入 Claude Desktop

如果你想直接在 Claude Desktop 里用这个工具：

1. 找到 Claude Desktop 的配置文件：
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
2. 加上你的 Server 配置：

```json
{
  "mcpServers": {
    "weather": {
      "command": "uv",
      "args": ["--directory", "/绝对路径/到/my-first-mcp", "run", "server.py"]
    }
  }
}
```

3. 完全退出 Claude Desktop 并重新启动
4. 在对话框里问「东京天气怎么样」——Claude 会自动调用你的 `get_weather` 工具

## 最常见的 3 个错误

### Server 一直连接失败

**原因**：`command`/`args` 路径错、或 Python 脚本有语法错误、或 `uv` 没装。
**修复**：先在终端**手动跑** `uv run server.py` 看能不能正常启动（它会等你输入，按 `Ctrl+C` 退出）；再确认 config 里的绝对路径对。

### Inspector 报「Unauthorized」或要 Token

**原因**：Inspector 默认开启了本地鉴权。
**修复**：从终端复制带 token 的 URL 用浏览器打开；或仅在受控本地调试时设 `DANGEROUSLY_OMIT_AUTH=true`（**不推荐**生产/共享环境）。

### Server 内部 print 导致协议错乱

**现象**：Host 报 JSON 解析失败、收不到工具列表。
**原因**：你在 Server 代码里用了 `print()` 输出调试信息，污染了 stdio 协议通道。
**修复**：把所有 `print(...)` 换成 `print(..., file=sys.stderr)`，或用 SDK 的 logging 能力。

## 动手实验

1. **跑通 Inspector 流程**：完整跑一遍第二步、第三步，在 Inspector 里成功调用一次 `get_weather`，看到返回。
2. **加第二个工具**：在同一个 Server 里再加一个 `@mcp.tool()` 函数，如 `calculate(expression: str) -> str`，重启后在 Inspector 里看到两个工具都能调用。
3. **故意踩 print 坑**：在工具函数里加一行 `print("hello")`，重启后看 Inspector 报什么错——亲身体验 stdio 协议污染。
4. **接 Claude Desktop**：按第四步配置，在 Claude 里真的问一次天气，看到它调用你写的工具。
