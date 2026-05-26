# VitePress 文档站点设计文档

**日期**: 2026-05-26  
**目标**: 创建 VitePress 文档站点并部署到 GitHub Pages

---

## 一、项目目标

### 总体目标
为 hello-agent 项目创建 VitePress 文档站点，整合所有项目文档，并自动部署到 GitHub Pages。

### 文档范围
- DeerFlow 技术学习笔记（2594行）
- adk-go 项目文档
- agentscope 及 agentscope-java 文档
- eino 项目文档
- hiclaw 项目文档

### 成功标准
- [ ] VitePress 站点成功创建和构建
- [ ] 所有项目文档可访问
- [ ] GitHub Pages 自动部署配置完成
- [ ] 站点可通过 https://baxiang.github.io/hello-agent/ 访问

---

## 二、设计方案

### 2.1 目录结构

```
hello-agent/
│
├── docs/                    ← VitePress 站点源码
│   ├── .vitepress/
│   │   ├── config.ts        ← VitePress 配置文件
│   │   └── cache/           ← 缓存目录（自动生成）
│   │   └── dist/            ← 构建输出（自动生成）
│   │
│   ├── index.md             ← 站点首页
│   ├── guide.md             ← 使用指南
│   │
│   ├── deer-flow/           ← DeerFlow 学习笔记
│   │   ├── index.md         ← DeerFlow 模块首页
│   │   ├── overview.md      ← 项目概览
│   │   ├── deployment.md    ← 快速部署
│   │   ├── agent.md         ← Agent编排架构
│   │   ├── skills.md        ← 技能与工具系统
│   │   ├── sandbox.md       ← 沙箱与执行环境
│   │   ├── memory.md        ← 记忆与上下文管理
│   │   └── architecture.md  ← 完整架构分析
│   │
│   ├── adk-go/
│   │   └── index.md         ← adk-go 文档首页
│   │
│   ├── agentscope/
│   │   ├── index.md         ← agentscope 文档首页
│   │   └── java.md          ← agentscope-java 文档
│   │
│   ├── eino/
│   │   └── index.md         ← eino 文档首页
│   │
│   ├── hiclaw/
│   │   └── index.md         ← hiclaw 文档首页
│   │
│   ├── public/
│   │   └── logo.svg         ← 站点 Logo
│   │   └── favicon.ico      ← 站点图标
│   │
│   ├── package.json         ← Node.js 依赖
│   ├── package-lock.json    ← 依赖锁定文件
│   └── .gitignore           ← Git 忽略配置
│
├── .github/
│   └── workflows/
│       └── deploy-docs.yml  ← GitHub Pages 部署 workflow
│
├── deer-flow/               ← 现有文档（保持不变）
├── adk-go/                  ← 现有文档（保持不变）
├── agentscope/              ← 现有文档（保持不变）
├── agentscope-java/         ← 现有文档（保持不变）
├── eino/                    ← 现有文档（保持不变）
└── hiclaw/                  ← 现有文档（保持不变）
```

### 2.2 VitePress 配置设计

**config.ts 核心配置**：

```typescript
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Hello Agent',
  description: 'Agent 框架技术学习文档',
  
  base: '/hello-agent/',  // GitHub Pages base path
  
  head: [
    ['link', { rel: 'icon', href: '/hello-agent/favicon.ico' }],
    ['link', { rel: 'icon', href: '/hello-agent/logo.svg', type: 'image/svg+xml' }],
  ],
  
  themeConfig: {
    logo: '/hello-agent/logo.svg',
    
    nav: [
      { text: '首页', link: '/' },
      { text: 'DeerFlow', link: '/deer-flow/' },
      { text: 'ADK-Go', link: '/adk-go/' },
      { text: 'AgentScope', link: '/agentscope/' },
      { text: 'Eino', link: '/eino/' },
      { text: 'Hiclaw', link: '/hiclaw/' },
    ],
    
    sidebar: {
      '/deer-flow/': [
        {
          text: 'DeerFlow 学习笔记',
          items: [
            { text: '项目概览', link: '/deer-flow/overview' },
            { text: '快速部署', link: '/deer-flow/deployment' },
            { text: 'Agent编排架构', link: '/deer-flow/agent' },
            { text: '技能与工具系统', link: '/deer-flow/skills' },
            { text: '沙箱与执行环境', link: '/deer-flow/sandbox' },
            { text: '记忆与上下文管理', link: '/deer-flow/memory' },
            { text: '完整架构分析', link: '/deer-flow/architecture' },
          ]
        }
      ],
      '/agentscope/': [
        {
          text: 'AgentScope',
          items: [
            { text: '简介', link: '/agentscope/' },
            { text: 'Java版本', link: '/agentscope/java' },
          ]
        }
      ],
    },
    
    socialLinks: [
      { icon: 'github', link: 'https://github.com/baxiang/hello-agent' }
    ],
    
    search: {
      provider: 'local'  // 本地搜索
    },
    
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026-present baxiang'
    }
  }
})
```

### 2.3 导航结构

```
首页 (/)
│
├── DeerFlow (/deer-flow/)
│   ├── 项目概览 (/deer-flow/overview)
│   ├── 快速部署 (/deer-flow/deployment)
│   ├── Agent编排架构 (/deer-flow/agent)
│   ├── 技能与工具系统 (/deer-flow/skills)
│   ├── 沙箱与执行环境 (/deer-flow/sandbox)
│   ├── 记忆与上下文管理 (/deer-flow/memory)
│   └── 完整架构分析 (/deer-flow/architecture)
│
├── ADK-Go (/adk-go/)
│   └── 文档首页
│
├── AgentScope (/agentscope/)
│   ├── 文档首页
│   └── Java版本
│
├── Eino (/eino/)
│   └── 文档首页
│
└── Hiclaw (/hiclaw/)
    └── 文档首页
```

### 2.4 文档处理策略

**DeerFlow 文档处理**：
现有 deer-flow 目录下的文档需要整合：
- `00-项目概览.md` → `docs/deer-flow/overview.md`
- `01-快速部署.md` → `docs/deer-flow/deployment.md`
- `02-Agent编排架构/` 三个文件 → 合并为 `docs/deer-flow/agent.md`
- `03-技能与工具系统/` 三个文件 → 合并为 `docs/deer-flow/skills.md`
- `04-沙箱与执行环境/` 三个文件 → 合并为 `docs/deer-flow/sandbox.md`
- `05-记忆与上下文管理/` 三个文件 → 合并为 `docs/deer-flow/memory.md`
- `06-集成与扩展.md` → `docs/deer-flow/architecture.md`

**其他项目文档处理**：
- 检查各项目目录是否有 README.md
- 如果有，复制到 docs 对应目录
- 如果没有，创建简单的介绍页面

---

## 三、GitHub Pages 部署设计

### 3.1 GitHub Actions Workflow

```yaml
name: Deploy VitePress site to Pages

on:
  push:
    branches: [main]
    paths:
      - 'docs/**'
      - '.github/workflows/deploy-docs.yml'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: docs/package-lock.json
      
      - name: Setup Pages
        uses: actions/configure-pages@v4
      
      - name: Install dependencies
        run: npm ci
        working-directory: docs
      
      - name: Build with VitePress
        run: npm run docs:build
        working-directory: docs
      
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: docs/.vitepress/dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

### 3.2 部署流程

```
代码提交 (docs/** 或 workflow) →
GitHub Actions 触发 →
Checkout → Setup Node 22 → Setup Pages →
Install dependencies (npm ci) →
Build (npm run docs:build) →
Upload artifact →
Deploy to GitHub Pages →
站点发布 (https://baxiang.github.io/hello-agent/)
```

### 3.3 GitHub Pages 设置

**Settings 配置**：
- Build and deployment: GitHub Actions
- Branch: gh-pages（自动创建）
- Custom domain: 无（使用默认）
- Enforce HTTPS: 是

---

## 四、技术栈

### 4.1 VitePress 配置
- **版本**: VitePress 1.x（最新稳定版）
- **Node.js**: 22.x
- **包管理器**: npm（兼容 GitHub Actions）

### 4.2 主题配置
- **主题**: VitePress 默认主题
- **颜色**: 默认配色（可选自定义）
- **布局**: 默认布局 + 自定义侧边栏
- **搜索**: 本地搜索（local search）

### 4.3 构建配置
- **输出目录**: `docs/.vitepress/dist`
- **静态资源**: `docs/public/`
- **Base path**: `/hello-agent/`（GitHub Pages）

---

## 五、实施步骤

### 步骤 1: 创建 docs 目录结构
- 创建 `docs/` 目录
- 创建 `.vitepress/config.ts`
- 创建 `public/` 目录
- 创建各项目文档目录

### 步骤 2: 编写 VitePress 配置
- 编写 `config.ts`
- 配置导航栏
- 配置侧边栏
- 配置主题选项

### 步骤 3: 整合现有文档
- 复制 DeerFlow 文档到 docs/deer-flow/
- 合并各模块的子文档
- 创建其他项目文档页面

### 步骤 4: 创建首页和引导页
- 创建 `index.md` 首页
- 创建 `guide.md` 使用指南
- 创建各项目首页

### 步骤 5: 配置 package.json
- 添加 VitePress 依赖
- 配置构建脚本
- 配置开发脚本

### 步骤 6: 配置 GitHub Actions
- 创建 `.github/workflows/deploy-docs.yml`
- 配置部署流程
- 测试构建

### 步骤 7: 部署和测试
- 提交代码到 GitHub
- 触发 GitHub Actions
- 验证 GitHub Pages 访问

---

## 六、文件清单

### 新建文件

| 文件路径 | 内容 |
|---------|------|
| `docs/.vitepress/config.ts` | VitePress 配置文件 |
| `docs/index.md` | 站点首页 |
| `docs/guide.md` | 使用指南 |
| `docs/deer-flow/index.md` | DeerFlow 模块首页 |
| `docs/deer-flow/overview.md` | 项目概览（复制现有） |
| `docs/deer-flow/deployment.md` | 快速部署（复制现有） |
| `docs/deer-flow/agent.md` | Agent编排架构（合并现有） |
| `docs/deer-flow/skills.md` | 技能与工具系统（合并现有） |
| `docs/deer-flow/sandbox.md` | 沙箱与执行环境（合并现有） |
| `docs/deer-flow/memory.md` | 记忆与上下文管理（合并现有） |
| `docs/deer-flow/architecture.md` | 完整架构分析（复制现有） |
| `docs/adk-go/index.md` | adk-go 文档首页 |
| `docs/agentscope/index.md` | agentscope 文档首页 |
| `docs/agentscope/java.md` | agentscope-java 文档 |
| `docs/eino/index.md` | eino 文档首页 |
| `docs/hiclaw/index.md` | hiclaw 文档首页 |
| `docs/public/logo.svg` | 站点 Logo |
| `docs/public/favicon.ico` | 站点图标 |
| `docs/package.json` | Node.js 依赖 |
| `docs/.gitignore` | Git 忽略配置 |
| `.github/workflows/deploy-docs.yml` | GitHub Actions workflow |

---

## 七、注意事项

### 7.1 文档路径
- VitePress 使用 `/hello-agent/` 作为 base path
- 所有链接需要包含 base path
- 部署后访问地址：`https://baxiang.github.io/hello-agent/`

### 7.2 构建注意事项
- Node.js 版本需要 >= 18（推荐 22）
- 使用 npm ci 而不是 npm install（确定性构建）
- 构建输出在 `docs/.vitepress/dist`

### 7.3 GitHub Pages 设置
- 需要在 GitHub Settings → Pages 中选择 GitHub Actions
- 部署成功后会自动创建 gh-pages 分支
- 首次部署可能需要等待几分钟

### 7.4 现有文档保持不变
- deer-flow/ 目录下的文档保持原位置
- docs/ 是独立站点源码
- 两个目录互不影响

---

## 八、验收标准

- [ ] 本地运行 `npm run docs:dev` 可启动开发服务器
- [ ] 本地运行 `npm run docs:build` 可成功构建
- [ ] 代码提交到 GitHub 后自动触发部署
- [ ] GitHub Actions 构建成功
- [ ] GitHub Pages 可访问：`https://baxiang.github.io/hello-agent/`
- [ ] 所有导航链接正常
- [ ] DeerFlow 文档完整显示
- [ ] 其他项目文档可访问
- [ ] 搜索功能正常工作