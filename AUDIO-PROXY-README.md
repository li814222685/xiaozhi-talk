# 本地音频代理服务

## 功能

这个服务将浏览器发送的 **PCM 音频** 转换为 **Opus 格式**，然后转发给后端服务器。同时将后端返回的 Opus 音频解码为 WAV 格式返回给浏览器。

## 安装

```bash
npm install
```

## 配置

编辑 `audio-proxy.js` 中的配置：

```javascript
const CONFIG = {
  LOCAL_PORT: 8080,              // 本地代理端口
  REMOTE_HOST: '192.168.112.254', // 后端服务器地址
  REMOTE_PORT: 8989,              // 后端服务器端口
  SAMPLE_RATE: 16000,            // 采样率
  CHANNELS: 1,                   // 声道数
  FRAME_SIZE: 960,               // 每帧样本数 (60ms at 16kHz)
};
```

## 启动

```bash
npm start
```

## 前端配置

修改 `IndexView.vue` 中的 WebSocket URL：

```typescript
// 使用本地代理服务
const wsUrl = 'ws://localhost:8080';

// 或者使用本地 IP（用于移动设备测试）
// const wsUrl = 'ws://192.168.x.x:8080';
```

同时，确保在 `hello` 消息中设置正确的音频参数：

```typescript
{
  type: "hello",
  version: 3,
  transport: "websocket",
  audio_params: {
    format: "opus",         // 使用 Opus 格式
    sample_rate: 16000,
    channels: 1,
    frame_duration: 60
  }
}
```

## 工作流程

```
浏览器 (PCM) 
    ↓
本地代理 (PCM → Opus)
    ↓
后端服务器
    ↓
本地代理 (Opus → WAV)
    ↓
浏览器 (WAV)
```

## 特性

- ✅ 实时 PCM 转 Opus
- ✅ 实时 Opus 转 WAV
- ✅ 自动重连
- ✅ 调试日志
- ✅ 心跳检测

## 调试

服务会输出详细的调试信息：

```
🚀 启动音频代理服务...
📡 本地端口: 8080
🔗 后端地址: 192.168.112.254:8989
✅ 浏览器已连接
🔗 正在连接后端: ws://192.168.112.254:8989/xiaozhi/v1/?...
✅ 已连接到后端服务器
📨 浏览器消息: hello
📝 会话ID: abc123...
📨 后端消息: tts
```

## 故障排除

### 1. 连接后端失败

检查：
- 后端服务器是否运行
- `REMOTE_HOST` 和 `REMOTE_PORT` 是否正确
- 网络是否通畅

### 2. 音频质量差

检查：
- 采样率是否匹配 (16000 Hz)
- 声道数是否正确 (1 = 单声道)
- 网络延迟

### 3. Opus 编码/解码错误

如果看到错误：
```
❌ Opus 编码错误: Error: Invalid PCM data
```

说明输入数据格式不对。确保浏览器发送的是 16-bit PCM 数据。

## 示例

### 启动服务

```bash
cd xiaozhi-web
npm install
npm start
```

### 修改前端代码

在 `IndexView.vue` 中：

```typescript
// 修改 WebSocket URL
const wsUrl = 'ws://localhost:8080';
```

### 测试

1. 启动代理服务
2. 启动前端应用
3. 打开浏览器控制台
4. 查看日志输出
