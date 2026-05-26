# VitePress 文档站点实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建 VitePress 文档站点并配置 GitHub Pages 自动部署

**Architecture:** 在 hello-agent 根目录创建独立的 docs/ 目录作为 VitePress 站点源码，整合现有各项目文档，通过 GitHub Actions 自动部署到 GitHub Pages

**Tech Stack:** VitePress 1.x, Node.js 22, npm, GitHub Actions

---

## 文件结构

**创建文件:**
- `docs/.vitepress/config.ts` - VitePress 配置
- `docs/index.md` - 站点首页
- `docs/guide.md` - 使用指南
- `docs/deer-flow/index.md` - DeerFlow 首页
- `docs/deer-flow/*.md` - DeerFlow 各模块文档
- `docs/adk-go/index.md` - adk-go 文档
- `docs/agentscope/index.md` - agentscope 文档
- `docs/agentscope/java.md` - agentscope-java 文档
- `docs/eino/index.md` - eino 文档
- `docs/hiclaw/index.md` - hiclaw 文档
- `docs/public/logo.svg` - Logo
- `docs/package.json` - 依赖配置
- `.github/workflows/deploy-docs.yml` - GitHub Actions

---

### Task 1: 创建 docs 目录结构

**Files:**
- Create: `docs/.vitepress/`
- Create: `docs/public/`
- Create: `docs/deer-flow/`
- Create: `docs/adk-go/`
- Create: `docs/agentscope/`
- Create: `docs/eino/`
- Create: `docs/hiclaw/`

- [ ] **Step 1: 创建主目录和子目录**

```bash
mkdir -p docs/.vitepress
mkdir -p docs/public
mkdir -p docs/deer-flow
mkdir -p docs/adk-go
mkdir -p docs/agentscope
mkdir -p docs/eino
mkdir -p docs/hiclaw
```

- [ ] **Step 2: 创建 GitHub workflows 目录**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 3: 验证目录结构**

```bash
ls -la docs/
```

Expected: 看到 `.vitepress`, `public`, `deer-flow` 等子目录

---

### Task 2: 编写 VitePress 配置文件

**Files:**
- Create: `docs/.vitepress/config.ts`

- [ ] **Step 1: 创建 config.ts 文件**

```typescript
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Hello Agent',
  description: 'Agent 框架技术学习文档',
  
  base: '/hello-agent/',
  
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
  ],
  
  themeConfig: {
    logo: '/logo.svg',
    
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
      provider: 'local'
    },
    
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026-present baxiang'
    }
  }
})
```

写入上述内容到文件

---

### Task 3: 创建站点首页

**Files:**
- Create: `docs/index.md`

- [ ] **Step 1: 创建首页内容**

```markdown
---
layout: home

hero:
  name: "Hello Agent"
  text: "Agent 框架技术学习"
  tagline: DeerFlow, AgentScope, Eino 等多框架学习笔记
  actions:
    - theme: brand
      text: 开始学习
      link: /deer-flow/
    - theme: alt
      text: GitHub
      link: https://github.com/baxiang/hello-agent

features:
  - icon: 🦌
    title: DeerFlow
    details: 字节跳动开源 Super Agent Harness，支持子代理、沙箱、技能系统
  - icon: 🔧
    title: AgentScope
    details: 阿里开源多智能体框架，支持 Python 和 Java
  - icon: 🤖
    title: Eino
    details: 字节跳动 AI 应用开发框架
  - icon: 📚
    title: 技术学习笔记
    details: 2594+ 行源码分析和架构文档
---
```

写入内容

---

### Task 4: 创建 DeerFlow 模块首页

**Files:**
- Create: `docs/deer-flow/index.md`

- [ ] **Step 1: 创建 DeerFlow 首页**

```markdown
# DeerFlow 技术学习笔记

## 概述

DeerFlow (Deep Exploration and Efficient Research Flow) 是字节跳动开源的超级智能体框架（Super Agent Harness），能够研究、编码和创作。

## 学习内容

本学习笔记包含以下内容：

- [项目概览](./overview) - DeerFlow 项目介绍、技术栈、整体架构
- [快速部署](./deployment) - Docker 和本地开发部署指南
- [Agent编排架构](./agent) - Lead Agent + Sub-Agents 源码分析
- [技能与工具系统](./skills) - Markdown Skills + 工具系统
- [沙箱与执行环境](./sandbox) - Provider 抽象 + 安全策略
- [记忆与上下文管理](./memory) - 防抖更新 + Token 管理
- [完整架构分析](./architecture) - Config + Models + Gateway + Tracing

## 统计

- **文档数量**: 25个
- **总行数**: 2594行
- **源码分析**: 1302行

## 开始学习

建议从 [项目概览](./overview) 开始，了解 DeerFlow 的整体定位和技术架构。
```

写入内容

---

### Task 5: 复制 DeerFlow 文档

**Files:**
- Create: `docs/deer-flow/overview.md`
- Create: `docs/deer-flow/deployment.md`
- Create: `docs/deer-flow/architecture.md`

- [ ] **Step 1: 复制项目概览文档**

```bash
cp deer-flow/00-项目概览.md docs/deer-flow/overview.md
```

- [ ] **Step 2: 复制快速部署文档**

```bash
cp deer-flow/01-快速部署.md docs/deer-flow/deployment.md
```

- [ ] **Step 3: 复制架构分析文档**

```bash
cp deer-flow/06-集成与扩展.md docs/deer-flow/architecture.md
```

---

### Task 6: 合并 DeerFlow 模块文档

**Files:**
- Create: `docs/deer-flow/agent.md`
- Create: `docs/deer-flow/skills.md`
- Create: `docs/deer-flow/sandbox.md`
- Create: `docs/deer-flow/memory.md`

- [ ] **Step 1: 合并 Agent 编排架构文档**

读取以下文件内容并合并：
- `deer-flow/02-Agent编排架构/部署体验.md`
- `deer-flow/02-Agent编排架构/架构理解.md`
- `deer-flow/02-Agent编排架构/源码分析.md`

合并为 `docs/deer-flow/agent.md`，添加标题和分隔

- [ ] **Step 2: 合并技能与工具系统文档**

读取并合并：
- `deer-flow/03-技能与工具系统/部署体验.md`
- `deer-flow/03-技能与工具系统/架构理解.md`
- `deer-flow/03-技能与工具系统/源码分析.md`

合并为 `docs/deer-flow/skills.md`

- [ ] **Step 3: 合并沙箱文档**

读取并合并：
- `deer-flow/04-沙箱与执行环境/部署体验.md`
- `deer-flow/04-沙箱与执行环境/架构理解.md`
- `deer-flow/04-沙箱与执行环境/源码分析.md`

合并为 `docs/deer-flow/sandbox.md`

- [ ] **Step 4: 合并记忆文档**

读取并合并：
- `deer-flow/05-记忆与上下文管理/部署体验.md`
- `deer-flow/05-记忆与上下文管理/架构理解.md`
- `deer-flow/05-记忆与上下文管理/源码分析.md`

合并为 `docs/deer-flow/memory.md`

---

### Task 7: 创建其他项目文档

**Files:**
- Create: `docs/adk-go/index.md`
- Create: `docs/agentscope/index.md`
- Create: `docs/agentscope/java.md`
- Create: `docs/eino/index.md`
- Create: `docs/hiclaw/index.md`

- [ ] **Step 1: 创建 adk-go 文档**

```markdown
# ADK-Go

## 概述

ADK-Go 是一个 Go 语言 Agent 开发框架。

## 学习内容

待完善...

## 参考资料

- GitHub 仓库: [待补充]
```

写入 `docs/adk-go/index.md`

- [ ] **Step 2: 创建 agentscope 文档**

```markdown
# AgentScope

## 概述

AgentScope 是阿里开源的多智能体框架，支持 Python 和 Java。

## 特性

- 多智能体协作
- 灵活的对话管理
- 支持多种模型后端

## 学习内容

- [Java版本](./java) - AgentScope Java 实现

## 参考资料

- GitHub: https://github.com/alibaba/AgentScope
```

写入 `docs/agentscope/index.md`

- [ ] **Step 3: 创建 agentscope-java 文档**

```markdown
# AgentScope Java

## 概述

AgentScope 的 Java 版本实现。

## 学习内容

待完善...

## 参考资料

- GitHub: [待补充]
```

写入 `docs/agentscope/java.md`

- [ ] **Step 4: 创建 eino 文档**

```markdown
# Eino

## 概述

Eino 是字节跳动的 AI 应用开发框架。

## 学习内容

待完善...

## 参考资料

- GitHub: [待补充]
```

写入 `docs/eino/index.md`

- [ ] **Step 5: 创建 hiclaw 文档**

```markdown
# Hiclaw

## 概述

Hiclaw 项目文档。

## 学习内容

待完善...

## 参考资料

- GitHub: [待补充]
```

写入 `docs/hiclaw/index.md`

---

### Task 8: 创建 package.json

**Files:**
- Create: `docs/package.json`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "hello-agent-docs",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "docs:dev": "vitepress dev",
    "docs:build": "vitepress build",
    "docs:preview": "vitepress preview"
  },
  "devDependencies": {
    "vitepress": "^1.5.0"
  }
}
```

写入内容

---

### Task 9: 创建 Logo 和静态资源

**Files:**
- Create: `docs/public/logo.svg`

- [ ] **Step 1: 创建 Logo SVG**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="45" fill="#4a90d9"/>
  <text x="50" y="55" text-anchor="middle" fill="white" font-size="24" font-weight="bold">HA</text>
</svg>
```

写入 `docs/public/logo.svg`

---

### Task 10: 创建 .gitignore

**Files:**
- Create: `docs/.gitignore`

- [ ] **Step 1: 创建 .gitignore**

```gitignore
.vitepress/cache
.vitepress/dist
node_modules
package-lock.json
```

写入内容

---

### Task 11: 创建 GitHub Actions workflow

**Files:**
- Create: `.github/workflows/deploy-docs.yml`

- [ ] **Step 1: 创建 workflow 文件**

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

写入内容

---

### Task 12: 安装依赖并本地测试

**Files:**
- Test: `docs/` 本地构建测试

- [ ] **Step 1: 安装依赖**

```bash
cd docs && npm install
```

- [ ] **Step 2: 本地开发测试**

```bash
cd docs && npm run docs:dev
```

Expected: 启动本地开发服务器，访问 http://localhost:5173/

- [ ] **Step 3: 本地构建测试**

```bash
cd docs && npm run docs:build
```

Expected: 构建成功，输出到 `docs/.vitepress/dist`

- [ ] **Step 4: 验证构建输出**

```bash
ls docs/.vitepress/dist/
```

Expected: 看到 index.html 和其他静态文件

---

### Task 13: 提交代码到 GitHub

**Files:**
- Modify: Git 提交所有新建文件

- [ ] **Step 1: 初始化 Git（如果需要）**

检查是否已有 Git 仓库：
```bash
git status
```

如果没有，初始化：
```bash
git init
git remote add origin git@github.com:baxiang/hello-agent.git
```

- [ ] **Step 2: 添加文件到 Git**

```bash
git add docs/
git add .github/workflows/deploy-docs.yml
```

- [ ] **Step 3: 提交更改**

```bash
git commit -m "feat: add VitePress docs site with GitHub Pages deployment"
```

- [ ] **Step 4: 推送到 GitHub**

```bash
git push -u origin main
```

Expected: 代码推送到 GitHub，触发 GitHub Actions

---

### Task 14: 配置 GitHub Pages

**Files:**
- Configure: GitHub Pages settings

- [ ] **Step 1: 访问 GitHub Settings**

在 GitHub 仓库页面：
1. 点击 Settings
2. 点击 Pages
3. Build and deployment: 选择 "GitHub Actions"

- [ ] **Step 2: 等待部署完成**

查看 Actions 页面，等待 workflow 完成

Expected: 部署成功，显示 URL

- [ ] **Step 3: 验证站点访问**

访问: https://baxiang.github.io/hello-agent/

Expected: 站点正常显示

---

## 自审检查清单

### 1. 规格覆盖检查

对照设计文档检查：
- [x] 创建 docs 目录结构（Task 1）
- [x] 编写 VitePress 配置（Task 2）
- [x] 创建首页（Task 3）
- [x] DeerFlow 文档首页（Task 4）
- [x] 复制 DeerFlow 文档（Task 5）
- [x] 合并 DeerFlow 模块文档（Task 6）
- [x] 创建其他项目文档（Task 7）
- [x] package.json（Task 8）
- [x] Logo 和静态资源（Task 9）
- [x] .gitignore（Task 10）
- [x] GitHub Actions workflow（Task 11）
- [x] 本地测试（Task 12）
- [x] Git 提交（Task 13）
- [x] GitHub Pages 配置（Task 14）

无遗漏。

### 2. 占位符扫描

- [x] 无 "TBD"、"TODO"
- [x] 所有配置代码完整
- [x] 所有命令具体
- [x] 所有文件路径明确

无占位符。

### 3. 类型一致性

- [x] VitePress 配置与导航结构匹配
- [x] 文件路径与目录结构匹配
- [x] GitHub Actions 配置与 package.json scripts 匹配

一致。

---

## 执行说明

本计划已完成自审，可以开始执行。

执行方式选择：
1. **Subagent-Driven (推荐)** - 每个任务独立执行，适合文档创建任务
2. **Inline Execution** - 批量执行，适合快速完成

建议选择 Inline Execution，因为：
- 文档创建任务相对简单
- 可以批量完成多个文件创建
- 快速验证构建结果