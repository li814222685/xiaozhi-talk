# 小智 - 沉浸式语音对话 Web 前端

基于 Vue 3 + TypeScript + Tailwind CSS 构建的沉浸式语音对话界面，连接 xiaozhi-esp32-server-golang 后端服务。

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置后端地址

编辑 `.env` 文件，确保后端地址正确：

```env
VITE_API_URL=http://192.168.112.254:8080
VITE_WS_URL=ws://192.168.112.254:8989
```

### 3. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:5173

## 📁 项目结构

```
xiaozhi-web/
├── public/
│   └── worklet/              # AudioWorklet 音频处理器
│       ├── recorder-processor.js
│       └── player-processor.js
│
├── src/
│   ├── assets/
│   │   └── styles/
│   │       └── main.css      # Tailwind 入口样式
│   │
│   ├── components/           # UI 组件
│   │   ├── AgentHeader.vue       # 头部组件
│   │   ├── AudioVisualizer.vue   # 音频可视化
│   │   ├── ChatContainer.vue     # 对话容器
│   │   ├── ChatMessage.vue       # 消息气泡
│   │   └── VoiceInput.vue        # 语音输入按钮
│   │
│   ├── composables/          # 核心逻辑
│   │   ├── useAudioCapture.ts    # 麦克风采集
│   │   ├── useAudioPlayback.ts   # 音频播放
│   │   ├── useVoiceChat.ts       # 语音对话（核心）
│   │   └── useWebSocket.ts      # WebSocket 连接
│   │
│   ├── views/
│   │   └── ChatView.vue         # 对话页面
│   │
│   ├── App.vue
│   ├── main.ts
│   └── env.d.ts
│
├── .env                      # 环境变量
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```

## 🎯 核心功能

- **语音采集** - 使用 AudioWorklet 采集麦克风音频
- **实时传输** - 通过 WebSocket 发送音频流到后端
- **音频播放** - 接收并播放 AI 合成的语音
- **对话展示** - 实时显示语音转文字和 AI 回复
- **自动重连** - WebSocket 断线自动重连

## 🔧 技术栈

- Vue 3.4 + Composition API
- TypeScript
- Vite 5
- Tailwind CSS 3.4
- 原生 Web Audio API
- 原生 WebSocket

## ⚠️ 注意事项

1. **需要 HTTPS** - 浏览器麦克风 API 需要安全上下文，建议使用 HTTPS 或 localhost
2. **Node 版本** - 推荐 Node.js 18+
3. **后端服务** - 确保 xiaozhi-esp32-server-golang 服务已启动并运行在 `192.168.112.254:8989`

## 📝 开发命令

```bash
# 开发模式
npm run dev

# 构建生产版本
npm run build

# 预览构建结果
npm run preview
```

## 🔗 相关链接

- [xiaozhi-esp32-server-golang](https://github.com/hackers365/xiaozhi-esp32-server-golang)
- [Vue 3](https://vuejs.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Vite](https://vitejs.dev/)
