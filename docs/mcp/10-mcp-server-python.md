# Python MCP Server 实战 — 从零构建工具服务

> 本文基于官方 `mcp` Python SDK，从零构建一个完整的 MCP Server，包含文件操作、数据库查询、外部 API 调用三种典型工具。

## 1. 环境搭建

```bash
pip install mcp httpx python-dotenv
```

## 2. 最简 MCP Server

```python
# server.py
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

server = Server("my-first-server")

@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="hello",
            description="Say hello to someone",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Name to greet"}
                },
                "required": ["name"]
            }
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "hello":
        return [TextContent(type="text", text=f"Hello, {arguments['name']}!")]
    raise ValueError(f"Unknown tool: {name}")

if __name__ == "__main__":
    import asyncio
    asyncio.run(stdio_server(server))
```

### 测试

```bash
npx @anthropic-ai/mcp-inspector python server.py
```

### Claude Desktop 配置

```json
{
    "mcpServers": {
        "my-first-server": {
            "command": "python",
            "args": ["server.py"]
        }
    }
}
```

## 3. 综合 MCP Server：文件操作 + 数据库 + API

```python
# advanced_server.py
import os, json, sqlite3
from datetime import datetime
from pathlib import Path
import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

server = Server("developer-toolkit")
WORK_DIR = Path(os.environ.get("WORK_DIR", "./workspace"))
WORK_DIR.mkdir(parents=True, exist_ok=True)

@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="read_file",
            description="读取工作目录下的文件内容",
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对于工作目录的文件路径"}
                },
                "required": ["path"]
            }
        ),
        Tool(
            name="write_file",
            description="写入内容到文件（原子写入）",
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件路径"},
                    "content": {"type": "string", "description": "文件内容"}
                },
                "required": ["path", "content"]
            }
        ),
        Tool(
            name="list_files",
            description="列出工作目录下的所有文件",
            inputSchema={
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "可选的文件匹配模式，如 *.py"}
                }
            }
        ),
        Tool(
            name="query_database",
            description="执行 SELECT 查询（仅只读）",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "SELECT 查询语句"}
                },
                "required": ["query"]
            }
        ),
        Tool(
            name="search_github",
            description="在 GitHub 上搜索仓库",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "language": {
                        "type": "string",
                        "enum": ["python", "go", "rust", "javascript", "typescript", "java"]
                    },
                    "max_results": {"type": "integer", "description": "最大结果数", "default": 5, "minimum": 1, "maximum": 20}
                },
                "required": ["query"]
            }
        ),
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "read_file":
        file_path = (WORK_DIR / arguments["path"]).resolve()
        if not str(file_path).startswith(str(WORK_DIR.resolve())):
            return [TextContent(type="text", text="❌ 拒绝访问：路径超出工作目录范围")]
        if not file_path.exists():
            return [TextContent(type="text", text=f"❌ 文件不存在: {arguments['path']}")]
        if file_path.stat().st_size > 10 * 1024 * 1024:
            return [TextContent(type="text", text="❌ 文件过大（>10MB）")]
        content = file_path.read_text(encoding="utf-8")
        if len(content) > 100_000:
            content = content[:100_000] + "\n\n...(已截断)"
        return [TextContent(type="text", text=content)]

    elif name == "write_file":
        file_path = (WORK_DIR / arguments["path"]).resolve()
        if not str(file_path).startswith(str(WORK_DIR.resolve())):
            return [TextContent(type="text", text="❌ 路径超出范围")]
        file_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = file_path.with_suffix(".tmp")
        tmp.write_text(arguments["content"], encoding="utf-8")
        tmp.rename(file_path)
        return [TextContent(type="text", text=f"✅ 写入成功: {arguments['path']} ({file_path.stat().st_size:,} bytes)")]

    elif name == "list_files":
        pattern = arguments.get("pattern")
        files = []
        for fp in WORK_DIR.rglob("*"):
            if fp.is_file() and ".tmp" not in fp.suffixes:
                rel = fp.relative_to(WORK_DIR)
                if not pattern or fp.match(pattern):
                    files.append(f"  {rel} ({fp.stat().st_size:,} bytes)")
        return [TextContent(type="text", text="📂 文件:\n" + "\n".join(files) if files else "📂 空目录")]

    elif name == "query_database":
        query = arguments["query"].strip()
        if not query.upper().startswith("SELECT"):
            return [TextContent(type="text", text="❌ 仅允许 SELECT")]
        for kw in ["DROP", "DELETE", "UPDATE", "INSERT", "ALTER", "CREATE", "TRUNCATE"]:
            if kw in query.upper():
                return [TextContent(type="text", text=f"❌ 禁止操作: {kw}")]
        conn = sqlite3.connect(os.environ.get("DB_PATH", "data.db"))
        cur = conn.cursor()
        cur.execute(query)
        cols = [d[0] for d in cur.description] if cur.description else []
        rows = cur.fetchall()[:50]
        conn.close()
        if not cols:
            return [TextContent(type="text", text=f"✅ {len(rows)} 行")]
        lines = [" | ".join(cols), "-" * len(" | ".join(cols))]
        for r in rows:
            lines.append(" | ".join(str(v) for v in r))
        return [TextContent(type="text", text="\n".join(lines))]

    elif name == "search_github":
        q = arguments["query"]
        lang = arguments.get("language", "")
        max_r = arguments.get("max_results", 5)
        search_q = f"{q} language:{lang}" if lang else q
        headers = {"Accept": "application/vnd.github.v3+json"}
        if token := os.environ.get("GITHUB_TOKEN"):
            headers["Authorization"] = f"Bearer {token}"
        async with httpx.AsyncClient() as c:
            resp = await c.get("https://api.github.com/search/repositories",
                params={"q": search_q, "per_page": max_r, "sort": "stars"},
                headers=headers, timeout=10.0)
            resp.raise_for_status()
            data = resp.json()
            if not data["items"]:
                return [TextContent(type="text", text="🔍 未找到")]
            lines = [f"🔍 {data['total_count']} 个仓库，显示前 {max_r}:"]
            for i, r in enumerate(data["items"], 1):
                lines.append(f"{i}. ⭐{r['stargazers_count']:,} | {r['full_name']}")
                lines.append(f"   {r['description'] or '(无描述)'}")
                lines.append(f"   {r['html_url']}")
            return [TextContent(type="text", text="\n".join(lines))]

    raise ValueError(f"Unknown tool: {name}")

if __name__ == "__main__":
    import asyncio
    asyncio.run(stdio_server(server))
```

## 4. 进阶特性

### Resource 资源暴露

```python
@server.list_resources()
async def list_resources() -> list[Resource]:
    return [
        Resource(uri="config://settings", name="应用设置", mimeType="application/json"),
        Resource(uri="file:///docs/README.md", name="项目说明", mimeType="text/markdown"),
    ]

@server.read_resource()
async def read_resource(uri: str) -> str:
    if uri == "config://settings":
        return json.dumps({"version": "1.0", "debug": True}, indent=2)
    elif uri.startswith("file://"):
        return (WORK_DIR / uri.replace("file:///", "")).read_text()
```

### Prompt 模板

```python
@server.list_prompts()
async def list_prompts() -> list:
    return [
        Prompt(
            name="code_review",
            description="代码审查模板",
            arguments=[
                PromptArgument(name="language", description="编程语言", required=True),
                PromptArgument(name="code", description="代码", required=True),
            ],
        ),
    ]

@server.get_prompt()
async def get_prompt(name: str, arguments: dict) -> PromptMessage:
    if name == "code_review":
        return PromptMessage(role="user",
            content=f"请审查以下 {arguments['language']} 代码:\n\n```\n{arguments['code']}\n```")
```

## 5. 安全最佳实践

```python
# 1. 路径遍历防护
def safe_path(user_path: str, base_dir: Path) -> Path | None:
    full = (base_dir / user_path).resolve()
    if not str(full).startswith(str(base_dir.resolve())):
        return None
    return full

# 2. SQL 注入防护（仅允许 SELECT）
# 3. 速率限制
from collections import defaultdict
import time

class RateLimiter:
    def __init__(self, max_calls=10, window=1.0):
        self.max_calls, self.window = max_calls, window
        self.calls = defaultdict(list)

    def check(self, tool_name: str) -> bool:
        now = time.time()
        self.calls[tool_name] = [t for t in self.calls[tool_name] if now - t < self.window]
        return len(self.calls[tool_name]) < self.max_calls
```
