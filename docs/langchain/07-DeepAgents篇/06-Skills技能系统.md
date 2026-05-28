# 06-Skills技能系统

> 按需加载可复用的专业能力

## 什么是 Skills

Skills 是**可复用的 Agent 能力包**，遵循 [Agent Skills 规范](https://agentskills.io/specification)。每个 Skill 是一个包含 `SKILL.md` 的目录：

```
skills/
├── langgraph-docs
│   └── SKILL.md
└── arxiv_search
    ├── SKILL.md
    └── arxiv_search.py    # 可选：辅助脚本
```

**渐进式加载：**
1. Agent 启动 → 读取所有 `SKILL.md` 的 frontmatter（元数据）
2. 收到用户输入 → 检查 description 是否匹配
3. 匹配 → 读取完整 SKILL.md 内容
4. 按 skill 指令执行

> 只在相关时加载，不占用初始上下文。

## SKILL.md 格式

### 最简格式

```markdown
---
name: langgraph-docs
description: 用于 LangGraph 相关问题，获取最新文档信息以提供准确指导
---

# langgraph-docs

## 概述
本技能说明如何访问 LangGraph Python 文档。

## 使用说明

### 1. 获取文档索引
使用 fetch_url 工具读取：
https://docs.langchain.com/llms.txt

### 2. 选择相关文档
根据问题，选择 2-4 篇最相关的文档。

### 3. 获取选中内容
使用 fetch_url 工具读取选中的文档 URL。

### 4. 提供准确指导
阅读文档后，完成用户的请求。
```

### 完整格式（所有 Frontmatter 字段）

```markdown
---
name: langgraph-docs
description: 用于 LangGraph 相关问题，获取最新文档信息
license: MIT
compatibility: 需要网络访问
metadata:
  author: langchain
  version: "1.0"
allowed-tools: fetch_url
---

# langgraph-docs

## 概述
...
```

### Frontmatter 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `str` | 技能唯一标识名 |
| `description` | `str` | 技能描述（**截断至 1024 字符**） |
| `license` | `str` | 许可证（可选） |
| `compatibility` | `str` | 兼容性要求（可选） |
| `metadata` | `dict` | 自定义元数据（可选） |
| `allowed-tools` | `list[str]` | 允许使用的工具（可选） |

> ⚠️ `SKILL.md` 文件必须小于 **10 MB**，否则会被跳过。

## 使用 Skills

### StateBackend 方式

```python
from urllib.request import urlopen
from deepagents import create_deep_agent
from deepagents.backends.utils import create_file_data
from langgraph.checkpoint.memory import MemorySaver

checkpointer = MemorySaver()

# 获取 Skill 内容
skill_url = "https://raw.githubusercontent.com/langchain-ai/deepagents/main/libs/cli/examples/skills/langgraph-docs/SKILL.md"
with urlopen(skill_url) as response:
    skill_content = response.read().decode('utf-8')

# 预填技能文件
skills_files = {
    "/skills/langgraph-docs/SKILL.md": create_file_data(skill_content)
}

agent = create_deep_agent(
    model="moonshot:moonshot-v1-8k",
    skills=["/skills/"],
    checkpointer=checkpointer,
)

result = agent.invoke(
    {
        "messages": [{"role": "user", "content": "什么是 LangGraph？"}],
        "files": skills_files,  # 注入技能文件
    },
    config={"configurable": {"thread_id": "12345"}},
)
```

### StoreBackend 方式

```python
from deepagents import create_deep_agent
from deepagents.backends import StoreBackend
from deepagents.backends.utils import create_file_data
from langgraph.store.memory import InMemoryStore

store = InMemoryStore()

# 存入技能文件到 Store
store.put(
    namespace=("filesystem",),
    key="/skills/langgraph-docs/SKILL.md",
    value=create_file_data(skill_content)
)

agent = create_deep_agent(
    model="moonshot:moonshot-v1-8k",
    backend=StoreBackend(),
    store=store,
    skills=["/skills/"],
)

result = agent.invoke(
    {"messages": [{"role": "user", "content": "什么是 LangGraph？"}]},
    config={"configurable": {"thread_id": "12345"}},
)
```

### FilesystemBackend 方式

```python
from deepagents import create_deep_agent
from deepagents.backends.filesystem import FilesystemBackend

agent = create_deep_agent(
    model="moonshot:moonshot-v1-8k",
    backend=FilesystemBackend(root_dir="/path/to/project"),
    skills=["/path/to/project/skills/"],  # 从磁盘加载
)
```

## 技能工作原理

```
用户输入
  ↓
┌─ 匹配阶段 ─────────────────────────────┐
│ 检查所有 SKILL.md 的 description        │
│ "LangGraph 相关？" → 是的，匹配！        │
└────────────────────────────────────────┘
  ↓
┌─ 读取阶段 ─────────────────────────────┐
│ 读取完整的 SKILL.md 文件                │
│ 包括指令、脚本引用、模板路径             │
└────────────────────────────────────────┘
  ↓
┌─ 执行阶段 ─────────────────────────────┐
│ 按照 skill 指令执行                     │
│ 按需访问辅助文件（脚本、模板、文档）      │
└────────────────────────────────────────┘
```

## 多源技能与优先级

当多个源包含同名 Skill 时，**后加载的覆盖先加载的**（Last One Wins）：

```python
agent = create_deep_agent(
    model="moonshot:moonshot-v1-8k",
    skills=["/skills/user/", "/skills/project/"],
    # 如果两个源都有 "web-search"，/skills/project/ 的版本生效
)
```

> SDK 不自动扫描 `~/.deepagents/` 等目录。需要显式传递路径。

## 子代理的 Skills

| 子代理类型 | Skills 继承 |
|-----------|-----------|
| 通用子代理（general-purpose） | ✅ 自动继承 |
| 自定义子代理 | ❌ 不继承，需单独配置 |

```python
research_subagent = {
    "name": "researcher",
    "description": "研究助手",
    "system_prompt": "你是研究员。",
    "tools": [web_search],
    "skills": ["/skills/research/", "/skills/web-search/"],  # 自定义技能
}

agent = create_deep_agent(
    model="moonshot:moonshot-v1-8k",
    skills=["/skills/main/"],  # 主 Agent 和通用子代理
    subagents=[research_subagent],  # researcher 用自己的技能
)
```

> 技能状态完全隔离：父代理的技能对子代理不可见，反之亦然。

## 编写高质量 Skill

### 好的 description

```yaml
description: 用于 LangGraph 相关问题，获取最新文档信息以提供准确、最新的指导
```

### 差的 description

```yaml
description: 文档相关
```

### 结构建议

```
skills/my-skill/
├── SKILL.md              # 主技能文件（指令）
├── reference/            # 可选：详细参考资料
│   └── api-reference.md
├── templates/            # 可选：模板文件
│   └── report-template.md
└── scripts/              # 可选：辅助脚本
    └── fetch_data.py
```

- `SKILL.md` 保持简洁
- 详细资料放入单独文件
- `SKILL.md` 中引用这些文件

## Skills vs Tools

| | Tools | Skills |
|---|-------|--------|
| **粒度** | 单一功能 | 完整工作流 |
| **加载** | 始终在提示词中 | 渐进式，按需加载 |
| **上下文量** | 小（描述 + schema） | 可大可小 |
| **适用** | 简单操作（搜索、计算） | 复杂流程（文档查询、代码生成） |
| **当上下文过多时** | 增加 token 占用 | 减少初始 token |

**建议：**
- 上下文量大 → 用 Skills（按需加载节省 Token）
- 需要捆绑多个能力 → 用 Skills
- 没有文件系统访问 → 用 Tools

## 小结

| 要点 | 说明 |
|------|------|
| 渐进式加载 | Agent 启动时只读 frontmatter，匹配后才加载全文 |
| SKILL.md | 必须包含 name 和 description，< 10 MB |
| 多源优先级 | Last One Wins |
| 子代理 Skills | 通用子代理继承，自定义不继承 |
| 描述清晰 | Agent 根据 description 决定是否使用技能 |
