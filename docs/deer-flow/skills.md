# 技能与工具系统 - 架构理解

**状态**: ⬜ 未开始

**计划开始时间**: 完成部署体验后

---

## 内容大纲

（待填写）

---

## 学习记录

（待填写）# 技能与工具系统 - 源码分析

## 概览

DeerFlow 的技能系统采用 Markdown 定义的工作流描述，支持按需加载和扩展。

## 源码目录结构

```
backend/packages/harness/deerflow/skills/
├── types.py              (68行)  ← Skill 类型定义
├── parser.py             (110行) ← SKILL.md 解析器
├── installer.py          ← Skill 安装器
├── security_scanner.py   ← 安全扫描
├── validation.py         ← 验证逻辑
├── tool_policy.py        ← 工具策略过滤
└── storage/
    ├── skill_storage.py      ← 存储抽象
    └── local_skill_storage.py ← 本地存储实现
```

## Skill 类型定义 (types.py)

### SkillCategory
```python
class SkillCategory(StrEnum):
    PUBLIC = "public"   # 内置技能，只读
    CUSTOM = "custom"   # 用户自定义，可编辑删除
```

### Skill 数据类
```python
@dataclass
class Skill:
    name: str                    # 技能名称
    description: str             # 描述
    license: str | None          # 许可证
    skill_dir: Path              # 技能目录路径
    skill_file: Path             # SKILL.md 文件路径
    relative_path: Path          # 相对路径
    category: SkillCategory      # 分类
    allowed_tools: list[str] | None  # 允许的工具列表
    enabled: bool = False        # 是否启用
    
    def get_container_path(self, container_base_path: str = "/mnt/skills") -> str:
        """获取容器内的路径"""
        return f"{container_base_path}/{self.category}/{self.skill_path}"
```

## Skill 解析器 (parser.py)

### parse_skill_file
```python
def parse_skill_file(skill_file: Path, category: SkillCategory, relative_path: Path | None = None) -> Skill | None:
    """解析 SKILL.md 文件并提取元数据"""
    # 解析 YAML frontmatter
    # 提取 name, description, license, allowed_tools
    # 返回 Skill 对象
```

### parse_allowed_tools
```python
def parse_allowed_tools(raw: object, skill_file: Path) -> list[str] | None:
    """解析 allowed-tools 字段"""
    # 返回 None 表示未指定（使用默认工具）
    # 返回 [] 表示明确无工具技能
    # 返回工具名称列表
```

## Skill 文件格式 (SKILL.md)

### Frontmatter 格式
```yaml
---
name: skill-name
description: 技能描述
license: MIT
allowed-tools:
  - web_search
  - web_fetch
---
```

### 内容结构
```markdown
# 技能标题

## Overview
技能概述

## When to Use This Skill
使用场景说明

## Research Methodology
具体工作流程步骤

## Output
预期输出格式
```

## 内置技能列表

| 技能名称 | 功能 | 文件大小 |
|---------|------|----------|
| deep-research | 深度研究方法论 | 198行 |
| ppt-generation | 幻灯片生成 | - |
| image-generation | 图像生成 | - |
| video-generation | 视频生成 | - |
| podcast-generation | 播客生成 | - |
| newsletter-generation | 新闻稿生成 | - |
| data-analysis | 数据分析 | - |
| frontend-design | 前端设计 | - |
| github-deep-research | GitHub 深度研究 | - |
| systematic-literature-review | 系统文献综述 | - |
| academic-paper-review | 学术论文评审 | - |
| consulting-analysis | 咨询分析 | - |
| code-documentation | 代码文档 | - |
| skill-creator | 技能创建器 | - |
| find-skills | 技能发现 | - |

## 工具策略 (tool_policy.py)

```python
def filter_tools_by_skill_allowed_tools(skill: Skill, tools: list[BaseTool]) -> list[BaseTool]:
    """根据技能的 allowed_tools 过滤可用工具"""
    if skill.allowed_tools is None:
        return tools  # 使用全部工具
    return [t for t in tools if t.name in skill.allowed_tools]
```

## 技能加载机制

### 按需加载（Progressive Loading）
- 技能不会一次性全部加载
- 根据任务需要动态加载相关技能
- 保持上下文窗口简洁

### 加载流程
```
用户任务 → Lead Agent 分析 → 确定需要的技能 → 加载 SKILL.md → 
解析元数据 → 过滤工具 → 注入到 Agent 上下文 → 执行任务
```

## 技能存储

### 容器内路径映射
```
/mnt/skills/
├── public/           ← 内置技能（只读）
│   ├── deep-research/
│   │   └── SKILL.md
│   ├── ppt-generation/
│   └── ...
└── custom/           ← 自定义技能
    └── your-skill/
        └── SKILL.md
```

### 本地存储实现
- `local_skill_storage.py`: 本地文件系统存储
- 支持技能的安装、更新、删除

## 工具系统 (tools/)

### 工具类型
```
backend/packages/harness/deerflow/tools/
├── tools.py              ← 工具基类
├── types.py              ← 类型定义
├── skill_manage_tool.py  ← Skill 管理工具
└── builtins/
    ├── tool_search.py        ← 工具搜索
    ├── task_tool.py          ← 任务管理
    ├── clarification_tool.py ← 澄清请求
    ├── present_file_tool.py  ← 文件展示
    ├── view_image_tool.py    ← 图像查看
    ├── invoke_acp_agent_tool.py ← ACP代理调用
    ├── update_agent_tool.py  ← Agent更新
    └── setup_agent_tool.py   ← Agent设置
```

### 内置工具功能

| 工具 | 功能 |
|------|------|
| tool_search | 搜索可用工具 |
| task_tool | 任务状态管理 |
| clarification_tool | 向用户请求澄清 |
| present_file_tool | 展示文件内容 |
| view_image_tool | 查看图像 |
| invoke_acp_agent_tool | 调用ACP协议代理 |
| update_agent_tool | 更新Agent状态 |
| setup_agent_tool | 设置Agent配置 |

## MCP Server 集成

```
backend/packages/harness/deerflow/mcp/
← Model Context Protocol 集成
← 支持 HTTP/SSE 传输
← OAuth 认证流程
```

## 设计亮点

### 1. Markdown 定义技能
- 低门槛：无需编程即可创建技能
- 可读性强：Markdown 格式直观
- 易于维护：修改技能只需编辑文本

### 2. 按需加载
- 节省 Token：不加载无关技能
- 灵活扩展：随时添加新技能
- 性能优化：减少上下文负担

### 3. 工具过滤策略
- 安全控制：限制技能可用的工具
- 精细化管理：不同技能不同工具集

### 4. 容器隔离
- 统一路径：`/mnt/skills/`
- 安全隔离：Public 不可写，Custom 可编辑

## 关键代码片段

### 创建 Skill 对象
```python
skill = Skill(
    name="deep-research",
    description="深度研究方法论",
    skill_dir=Path("/mnt/skills/public/deep-research"),
    skill_file=Path("/mnt/skills/public/deep-research/SKILL.md"),
    category=SkillCategory.PUBLIC,
    enabled=True
)
```

### 加载技能
```python
skill_file = Path("skills/public/deep-research/SKILL.md")
skill = parse_skill_file(skill_file, SkillCategory.PUBLIC)

# 过滤工具
filtered_tools = filter_tools_by_skill_allowed_tools(skill, all_tools)
```

## 扩展开发指南

### 创建自定义 Skill

1. 创建目录: `skills/custom/my-skill/`
2. 创建 SKILL.md:
```markdown
---
name: my-skill
description: 我的自定义技能
allowed-tools:
  - web_search
  - bash
---

# My Skill

## Overview
技能说明...

## Workflow
1. 步骤1
2. 步骤2
...
```

### 安装技能包
```bash
# 通过 Gateway API 安装 .skill 包
POST /api/skills/install
```

---

**下一步**: 阅读 sandbox/tools.py 理解沙箱工具实现# 技能与工具系统 - 部署体验

**状态**: ⬜ 未开始

**计划开始时间**: 完成阶段1后

---

## 内容大纲

（待填写）

---

## 学习记录

（待填写）