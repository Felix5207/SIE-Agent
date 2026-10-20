# SIE-Agent

本地运行的科研文献信息提取工作台。使用 Pi Agent SDK 调用用户配置的模型，通过 MinerU 或本地文档适配器处理资料，将提取结果、来源引用、人工复核和修订记录保存在本地。

A local scientific information extraction workspace with configurable model APIs, document parsing, source-linked answers, and review history.

## 功能

- **选择资料 → 定义提取列 → 提取与复核**：上传论文、附件和表格，默认每篇论文一行。
- 支持文字、数值、单选、多选等提取列；新增列和资料后继续处理。
- 点击答案查看支持引文、来源页和图片；支持人工确认、修订及对话复核。
- 高级工作台支持从表头校准提取规范，或从虚构/自备教学案例学习规则。
- 项目规范和 Skills 保留版本；数据、任务状态与修订历史存储在 SQLite 中。
- 导出 CSV 或包含来源与复核记录的 Excel。
- 支持 OpenAI Chat Completions 兼容接口、OpenAI Responses、Anthropic Messages；PDF 可使用 MinerU 云 API 或自建服务。

模型输出和来源关联仍需人工核对。系统保留提交的答案及来源，不保证模型引用或科学数值正确。图片坐标估算必须明确允许，结果应作为估计值复核。

## 安装

需要 **Node.js >= 22.19**、**Python >= 3.10**。Windows 可使用 WSL。

```bash
git clone https://github.com/Felix5207/SIE-Agent.git
cd SIE-Agent
npm ci
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm run build
SIE_PYTHON="$PWD/.venv/bin/python" npm start
```

打开 <http://127.0.0.1:3210>。开发模式使用 `npm run dev`，同样需要设置 `SIE_PYTHON`。

## 配置 API

1. 在侧栏的 **API 配置** 中添加模型连接，填写服务商的 Base URL、API Key 和模型 ID。
2. 根据服务选择接口协议。Base URL 不要附加 `/chat/completions`、`/responses` 或 `/messages`。
3. 选择支持工具调用的模型。需要读取原图时，还应启用并确认图片输入能力。
4. 添加 MinerU 官方云 API Token 或自建解析服务地址。TXT、MD、CSV、XLSX 和 DOCX 使用本地适配器。
5. 点击 **保存并测试**，然后选择 **使用此连接**。

连接测试会调用所选服务并消耗少量额度。MinerU 测试使用程序生成的 PDF。切换连接影响后续提交的任务，已经排队的任务保留提交时的配置。

首次启动不导入其他项目或机器上的凭据。密钥保存在 `SIE_DATA_DIR/connections.json`，文件权限为 `0600`，服务端不会在配置响应中回显密钥；该文件并未加密。

## 数据与访问

默认监听 `127.0.0.1:3210`，用于本机或 SSH 转发访问。当前为单用户、单工作空间应用，没有多用户登录和租户隔离，请勿直接暴露到公网。

使用外部模型或 MinerU 云服务时，相应文献内容会发送给所选服务。模型生成、解析及来源判断的质量依赖这些服务。

`data/` 保存数据库、连接配置、原始文献、解析产物、会话和导出结果。`data/`、`.env*`、日志、运行输出及备份均已加入忽略规则，不属于开源发布内容。提交代码前运行 `npm run check:publication`，不要强制添加被忽略的文件。

环境变量模板见 [.env.example](.env.example)；应用不会自动读取 `.env`，请在启动时导出需要的变量。

| 变量 | 默认值 / 用途 |
| --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `3210` |
| `SIE_DATA_DIR` | 项目内 `data/` |
| `SIE_PYTHON` | `python3`，推荐指向虚拟环境 |
| `PI_SDK_PATH` | 可选的 Pi SDK 入口，默认使用 npm 安装的依赖 |
| `PI_MODELS_PATH` | 显式导入已有配置中的 `qwen-local` provider |
| `QWEN_BASE_URL` / `QWEN_MODEL` / `QWEN_API_KEY` | 可选的初始本地模型连接 |
| `MINERU_URL` / `MINERU_MODEL_URL` / `MINERU_API_KEY` | 可选的初始自建 MinerU 连接 |

网页中保存的连接配置优先于初始环境配置。命令型密钥不会被执行。

## 示例与测试

公开示例完全由程序生成，不包含真实论文、真实实验结果或预配置凭据。示例中的数值只用于演示软件流程。PDF 示例仍需配置 MinerU 才能解析。

```bash
# 使用安装步骤中创建的 Python 虚拟环境
export SIE_PYTHON="$PWD/.venv/bin/python"
npm test
npm run build
npm run check:publication

# 重新生成虚构示例 PDF 和空白 Excel 表头
"$SIE_PYTHON" scripts/generate-examples.py
```

测试使用临时目录与模拟 API，不要求真实服务密钥。健康检查：`GET /api/health`。

## 目录

| 目录 | 内容 |
| --- | --- |
| `web/` | React 工作台和证据阅读界面 |
| `server/` | 本地 HTTP API、Pi 调用、连接管理、任务及文档处理 |
| `shared/` | 前后端共享的证据与提取状态逻辑 |
| `scripts/` | 文档适配器、示例生成与发布检查 |
| `skills/` | 基础提取方法 |
| `tests/` | 单元测试、模拟服务测试及虚构资料 |
| `resources/` | 带许可声明的 GeoNames 地名参考数据 |
| `examples/` | 生成的虚构 PDF 与空白表头 |

## 许可证与第三方资源

项目原创代码采用 [MIT License](LICENSE)。GeoNames 地名数据使用独立的 CC BY 4.0 许可，归属与转换说明见 [resources/NOTICE.md](resources/NOTICE.md)。依赖项保留各自许可证。

界面流程参考 Elicit；本项目与 Elicit 无隶属关系，不提供其文献数据库。Pi SDK、MinerU 及模型服务的使用条件由各项目和服务商规定。
