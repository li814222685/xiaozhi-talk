import { WebSocketServer } from "ws";
import WebSocket from "ws";
import OpusScript from "opusscript";

// 配置
const CONFIG = {
  LOCAL_PORT: 8080, // 本地代理端口
  REMOTE_HOST: "192.168.112.254", // 后端服务器地址
  REMOTE_PORT: 8989, // 后端服务器端口
  SAMPLE_RATE: 16000, // 采样率
  CHANNELS: 1, // 声道数
  FRAME_SIZE: 960, // 每帧样本数 (60ms at 16kHz)
};

console.log("🚀 启动音频代理服务...");
console.log(`📡 本地端口: ${CONFIG.LOCAL_PORT}`);
console.log(`🔗 后端地址: ${CONFIG.REMOTE_HOST}:${CONFIG.REMOTE_PORT}`);

// 创建 Opus 编码器
function createOpusEncoder() {
  return new OpusScript(
    CONFIG.SAMPLE_RATE,
    CONFIG.CHANNELS,
    OpusScript.Application.AUDIO
  );
}

// WebSocket 服务器 - 处理浏览器连接
const wss = new WebSocketServer({ port: CONFIG.LOCAL_PORT });

wss.on("connection", (browserWs) => {
  console.log("✅ 浏览器已连接");

  let remoteWs = null;
  let sessionId = null;
  let opusEncoder = null;
  let lastMessageTime = Date.now();

  // 连接后端服务器
  const connectToBackend = () => {
    return new Promise((resolve, reject) => {
      const backendUrl = `ws://${CONFIG.REMOTE_HOST}:${
        CONFIG.REMOTE_PORT
      }/xiaozhi/v1/?device-id=proxy-client&client-id=${Date.now()}`;
      console.log(`🔗 正在连接后端: ${backendUrl}`);

      remoteWs = new WebSocket(backendUrl);

      remoteWs.on("open", () => {
        console.log("✅ 已连接到后端服务器");
        resolve();
      });

      remoteWs.on("error", (error) => {
        console.error("❌ 后端连接错误:", error);
        reject(error);
      });

      // 处理后端消息
      remoteWs.on("message", (data, isBinary) => {
        lastMessageTime = Date.now();

        if (isBinary) {
          // 后端返回的是音频数据
          console.log("🔊 后端音频数据:", data.length, "bytes");

          // 直接发送给浏览器（假设是 WAV 或 PCM）
          if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.send(data);
          }
        } else {
          // 处理 JSON 消息
          try {
            const message = JSON.parse(data.toString());
            console.log("📨 后端消息:", message.type);

            if (message.type === "hello") {
              sessionId = message.session_id;
              console.log("📝 会话ID:", sessionId);
            }

            // 转发给浏览器
            if (browserWs.readyState === WebSocket.OPEN) {
              browserWs.send(data);
            }
          } catch (error) {
            console.error("❌ JSON 解析错误:", error);
          }
        }
      });

      remoteWs.on("close", () => {
        console.log("⚠️ 后端连接已断开");
        browserWs.close();
      });
    });
  };

  // 处理浏览器消息
  browserWs.on("message", async (data, isBinary) => {
    lastMessageTime = Date.now();

    try {
      if (!remoteWs || remoteWs.readyState !== WebSocket.OPEN) {
        // 首次连接，连接到后端
        opusEncoder = createOpusEncoder();
        await connectToBackend();
      }

      if (isBinary) {
        // 浏览器发送的是音频数据
        try {
          // 将 ArrayBuffer 转换为 Int16Array
          const pcmArray = new Int16Array(data);

          // 编码为 Opus
          const opusData = opusEncoder.encode(pcmArray, CONFIG.FRAME_SIZE);

          console.log(
            "🎤 PCM:",
            data.byteLength,
            "bytes → Opus:",
            opusData.length,
            "bytes"
          );

          // 发送到后端
          if (remoteWs && remoteWs.readyState === WebSocket.OPEN) {
            remoteWs.send(Buffer.from(opusData));
          }
        } catch (error) {
          console.error("❌ Opus 编码错误:", error);
          // 如果编码失败，尝试直接发送原始 PCM
          if (remoteWs && remoteWs.readyState === WebSocket.OPEN) {
            remoteWs.send(data);
          }
        }
      } else {
        // 浏览器发送 JSON 消息
        try {
          const message = JSON.parse(data.toString());
          console.log("📨 浏览器消息:", message.type);

          // 如果是 hello 消息，不需要额外处理
          if (message.type === "hello") {
            // 转发给后端
            remoteWs.send(data);
            return;
          }

          // 添加 session_id
          if (sessionId && !message.session_id) {
            message.session_id = sessionId;
          }

          // 发送回后端
          if (remoteWs && remoteWs.readyState === WebSocket.OPEN) {
            remoteWs.send(JSON.stringify(message));
          }
        } catch (error) {
          console.error("❌ JSON 解析错误:", error);
        }
      }
    } catch (error) {
      console.error("❌ 处理浏览器消息错误:", error);
    }
  });

  browserWs.on("close", () => {
    console.log("⚠️ 浏览器连接已断开");

    if (opusEncoder) {
      opusEncoder.delete();
      opusEncoder = null;
    }

    if (remoteWs) {
      remoteWs.close();
      remoteWs = null;
    }
  });

  browserWs.on("error", (error) => {
    console.error("❌ 浏览器连接错误:", error);
  });
});

console.log("✅ 音频代理服务已启动!");
console.log(`🌐 等待浏览器连接: ws://localhost:${CONFIG.LOCAL_PORT}`);
console.log("");
console.log("使用说明:");
console.log("1. 修改 CONFIG 中的 REMOTE_HOST 为您的后端服务器地址");
console.log("2. 修改 IndexView.vue 中的 wsUrl 为 ws://localhost:8080");
console.log("3. 确保浏览器发送的是 PCM 格式（Float32Array）");
console.log("4. 启动此服务: npm start");
console.log("5. 启动前端应用");
console.log("");
