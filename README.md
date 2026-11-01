<div align="center">

# 紫微斗数 AI 语音圆屏 · 服务器端

### ESP32-S3 圆屏语音排盘设备的配套 AI 服务器（Next.js）

[![License: MIT](https://img.shields.io/badge/code-MIT-blue.svg)](./LICENSE)
[![Hardware](https://img.shields.io/badge/device-ESP32--S3%20Round%20Screen-blue)](https://github.com/1legend05/ziwei-watch)

</div>

配套固件仓库：[**1legend05/ziwei-watch**](https://github.com/1legend05/ziwei-watch)（ESP32-S3 紫微斗数 AI 语音圆屏）。

设备按住说话 → 本服务器完成**语音识别 → 紫微斗数排盘 → AI 解读 → 语音合成**，解读直接播报在圆屏上。

## 功能特性

- **语音排盘**：接收设备上传的录音（WAV）→ 语音识别（火山方舟 ASR）→ 解析出生信息 → 排盘引擎起盘 → 大模型生成五小节解读（命格/性格/事业/财运/健康）→ TTS 合成语音返回设备播报
- **出生信息乱序 / 多轮补全**：性别、年、月、日、时辰**任意顺序**说都能排盘；一次说不全会自动追问，跨轮自动合并（支持"先性别年、再补月日时"这类跨轮补全）
- **AI 问答**：结合已排命盘与对话历史，回答命理、财运、事业等问题
- **屏幕回传**：设备每 5 分钟自动上传屏幕快照（调试通道，内存环形缓存仅保留最近 50 张，`/api/screen`）
- **Web 演示页**：保留上游排盘引擎的开源 Demo 界面（`/`、`/chart`、`/heming`、`/library`）

## 架构

```
┌──────────────┐   HTTPS/HTTP    ┌───────────────────────┐    API    ┌──────────────┐
│ ESP32-S3 圆屏 │ ─────────────▶ │  ziwei-doushu 服务器    │ ────────▶ │  火山方舟     │
│ 录音/播报/显示 │ ◀───────────── │  Next.js（本仓库）       │ ◀──────── │ 大模型+ASR    │
└──────────────┘    WAV 语音返回  └───────────────────────┘           └──────────────┘
                                        │ 排盘引擎（本地 lib/ziwei）
                                        ▼
                                  紫微斗数命盘（五小节解读）
```

设备只需一个服务器地址（设置页可改）；所有计算在服务器侧完成，圆屏本身只负责采集与展示。

## API 一览

| 接口 | 作用 |
|---|---|
| `POST /api/ai/asr` | 语音识别：WAV → 中文文本 |
| `POST /api/ai/voice-interpret` | 语音排盘：出生文本（+已收集 birth JSON）→ 追问或五小节解读 + TTS |
| `POST /api/ai/chat` | AI 问答 / 文本自动排盘：识别出生信息自动起盘，返回解读 + 命盘摘要 |
| `POST /api/ai/interpret` | 排盘解读（按已收集出生信息） |
| `POST /api/ai/tts` | 语音合成：文本 → 16kHz 16bit mono WAV |
| `POST /api/screen` | 屏幕快照回传（调试） |

## 快速部署

### 方案 A：Vercel 公网部署（推荐，让设备通过公网使用）

1. **导入仓库**：登录 [vercel.com](https://vercel.com) → New Project → Import 本仓库（GitHub 授权）
2. **配置环境变量**（Settings → Environment Variables，Production 环境，见下表）
3. **Deploy**：Vercel 自动构建（约 1 分钟），完成后得到生产域名 `https://<project>.vercel.app`
4. GitHub 推送 main 分支会自动重新部署（无需手动操作）

> 注意：`*.vercel.app` 免费域名在部分中国大陆网络环境直连受限，若目标用户在中国大陆，建议绑定自定义域名（Vercel → Settings → Domains，可配合 Cloudflare 代理）。

### 方案 B：本地 / 自有服务器运行

```bash
git clone https://github.com/1legend05/ziwei-doushu.git
cd ziwei-doushu
cp .env.example .env.local   # 填入火山方舟 API Key 等
npm install
npm run build && npm start   # 生产模式，默认 3000 端口
# 或开发模式：npm run dev
```

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `ARK_API_KEY` | ✅ | 火山方舟 API Key（ark- 开头，46 位）。控制台：https://console.volcengine.com/ark |
| `ARK_BASE_URL` | ✅ | 方舟 API 地址，如 `https://ark.cn-beijing.volces.com/api/v3` |
| `ARK_MODEL` | ✅ | 大模型：排盘解读 / AI 问答（如 `doubao-seed-2-1-pro-260915`） |
| `ARK_ASR_MODEL` | ✅ | 语音识别模型（如 `doubao-seed-2-1-lite-260915`） |
| `NEXT_PUBLIC_SITE_URL` | ✅ | 本站访问地址：本地 `http://localhost:3000`；公网填你的域名 |

本地运行：`cp .env.example .env.local` 后填写。Vercel 部署：在环境变量页添加（密钥类建议选 Secret 类型）。

## 设备联调

固件默认服务器地址是占位符（`http://192.168.1.100:3000`），个人用户需改为**自己的服务器地址**：

1. **烧录后**：圆屏"设置"页 → "服务器地址"输入框 → 填入你的服务器地址（如 `https://your-app.vercel.app` 或 `http://192.168.1.x:3000`）→ 保存（写入 NVS，重启保留）
2. **烧录前**：直接改固件 `src/app_config.h` 的 `DEFAULT_SERVER_URL` 再编译

设备状态行"在线"只代表 WiFi 已连接；服务器不可达时排盘会提示"服务异常，请稍后再试"。

## 排盘引擎与数据集（来自上游）

本仓库的排盘引擎（`lib/ziwei/`）、古籍原文（`lib/classics/`）、演示界面与解读数据集，继承自开源项目 [Renhuai123/ziwei-doushu](https://github.com/Renhuai123/ziwei-doushu)（倪海厦《天纪》体系，67.5 万命盘 × 13 维解读数据集）。本仓库在其基础上新增了 AI 服务端（ASR / 排盘解读 / 问答 / TTS），供圆屏设备调用。

- 代码：MIT License
- 解读数据集：CC BY 4.0（商用需注明来源，见 `DATASET-LICENSE`）
- 倪师原话目录（`docs/tianji-ziwei/`）：CC BY-NC-SA 4.0，不可商用

## 本地验证

```bash
npm run typecheck   # TypeScript 全量类型检查
npm test            # 排盘引擎回归测试
```

## License

[MIT](LICENSE)（引擎与数据集的细分协议见上节与 `DATASET-LICENSE`）。
