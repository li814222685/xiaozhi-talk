<template>
  <div class="talker">
    <header class="header">
      <div class="header-content">
        <div class="header-left">
          <div class="logo">小智</div>
          <div class="status">
            <span
              :class="['status-dot', isConnected ? 'online' : 'offline']"
            ></span>
            <span class="status-text">{{
              isConnected ? "在线" : isReady ? "重新连接中..." : "连接中..."
            }}</span>
          </div>
        </div>

        <div class="header-right">
          <button
            v-if="!isConnected"
            class="btn-icon"
            @click="reconnect"
            title="重新连接"
          >
            <i class="mdi mdi-refresh icon"></i>
          </button>
          <button class="btn-icon" @click="toggleMagic">
            <i class="mdi mdi-auto-fix icon"></i>
          </button>
          <button class="btn-icon" @click="handleToggleDark">
            <i v-if="isDark" class="mdi mdi-white-balance-sunny icon"></i>
            <i v-else class="mdi mdi-weather-night icon"></i>
          </button>
          <button class="btn-icon" @click="toggle">
            <i
              class="mdi icon"
              :class="isFullscreen ? 'mdi-fullscreen-exit' : 'mdi-fullscreen'"
            ></i>
          </button>
          <button class="btn-icon" @click="shareApp">
            <i class="mdi mdi-share icon"></i>
          </button>
        </div>
      </div>
    </header>

    <div class="main-wrapper">
      <aside class="avatar-aside">
        <div class="avatar-container">
          <img
            :src="idleAvatar"
            class="avatar-image"
            :class="{ 'avatar-hidden': isPlaying || isRecording }"
            alt="Idle Avatar"
          />
          <img
            :src="speakingAvatar"
            class="avatar-image"
            :class="{ 'avatar-visible': isPlaying || isRecording }"
            alt="Speaking Avatar"
          />
        </div>
      </aside>

      <main class="main-content">
        <div class="chat-messages">
          <div v-if="messages.length === 0" class="empty-state">
            <div class="empty-title">开始对话</div>
            <div class="empty-subtitle">输入文字或点击麦克风开始语音对话</div>
          </div>

          <div
            v-for="message in messages"
            :key="message.id"
            :class="['message-wrapper', message.role]"
          >
            <div class="message-bubble">
              <p class="message-content">{{ message.content }}</p>
            </div>
          </div>
        </div>

        <div class="input-area">
          <div class="input-container">
            <button
              class="voice-btn"
              :class="{ recording: isRecording, playing: isPlaying }"
              :disabled="!isConnected"
              @click="handleVoiceClick"
            >
              <i v-if="isRecording" class="mdi mdi-stop voice-icon"></i>
              <i v-else-if="isPlaying" class="mdi mdi-stop voice-icon"></i>
              <i v-else class="mdi mdi-microphone voice-icon"></i>
            </button>

            <textarea
              v-model="inputText"
              class="text-input"
              :placeholder="
                isConnected
                  ? '输入您想问的问题...'
                  : '连接已断开，请刷新页面重新连接'
              "
              rows="1"
              @keydown.enter.exact.prevent="handleSendText"
              :disabled="!isConnected || isRecording || isPlaying"
            ></textarea>

            <button
              class="send-btn"
              :disabled="
                !isConnected || !inputText.trim() || isRecording || isPlaying
              "
              @click="handleSendText"
            >
              <i class="mdi mdi-send send-icon"></i>
            </button>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useWebSocket } from "@/composables/useWebSocket";
// import { useAudioCapture } from "@/composables/useAudioCapture";
// import { useAudioPlayback } from "@/composables/useAudioPlayback";
import { useFullscreen } from "@vueuse/core";
import { useDark, useToggle } from "@vueuse/core";
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}
// 暗色模式
const isDark = useDark({
  selector: "html",
  attribute: "data-theme",
  valueDark: "dark",
  valueLight: "light",
  storageKey: "xiaozhi-theme",
});
const toggleDark = useToggle(isDark);

const handleToggleDark = () => {
  toggleDark();
};

const isConnected = ref(false);
const isRecording = ref(false);
const isPlaying = ref(false);
const messages = ref<Message[]>([]);
const inputText = ref("");
let currentAssistantMessage: Message | null = null;

const idleAvatar = "/src/assets/webp/hlw1.webp";
const speakingAvatar = "/src/assets/webp/hlw2.webp";

const isDev = import.meta.env.DEV;
const wsUrl =
  import.meta.env.VITE_WS_URL ||
  (isDev ? "/xiaozhi/v1/" : "ws://192.168.112.254:8989/xiaozhi/v1/");

const {
  connect,
  send,
  sendText,
  startListen,
  stopListen,
  abort,
  onMessage,
  isReady,
  sessionId,
  reconnect,
} = useWebSocket();

const { isFullscreen, toggle } = useFullscreen();

// 发送音频数据
const sendAudio = (audioData: Float32Array) => {
  if (!isConnected.value) {
    console.error("[WebSocket] 未连接，无法发送音频");
    return;
  }

  // 转换为 Int16Array
  const int16Data = new Int16Array(audioData.length);
  for (let i = 0; i < audioData.length; i++) {
    int16Data[i] = Math.max(-32768, Math.min(32767, audioData[i] * 32767));
  }

  send(int16Data.buffer);
};

// 发送开始监听命令
const sendListenStart = () => {
  const msg = {
    session_id: sessionId.value,
    type: "listen",
    state: "start",
    mode: "manual",
  };
  send(JSON.stringify(msg));
};

// 发送停止监听命令
const sendListenStop = () => {
  const msg = {
    session_id: sessionId.value,
    type: "listen",
    state: "stop",
  };
  send(JSON.stringify(msg));
};

// 发送中止命令
const sendAbort = () => {
  const msg = {
    type: "abort",
    reason: "user_request",
  };
  send(JSON.stringify(msg));
};

const init = async () => {
  try {
    console.log("[App] Starting WebSocket connection to:", wsUrl);

    // 初始化音频播放上下文
    await initAudioPlayback();

    onMessage(async (msg) => {
      console.log("[App] 📩 Message received:", msg.type, msg);

      if (msg.type === "audio" && msg.data) {
        console.log("[App] 🔊 Audio data received");
        const buffer = msg.data as ArrayBuffer;
        console.log("[App] 收到音频数据:", buffer.byteLength, "bytes");
        // 播放音频
        queueAudio(buffer);
      } else if (msg.type === "stt") {
        console.log("[App] 📝 STT:", msg.text);
        if (msg.text) {
          addMessage({
            role: "user",
            content: msg.text,
          });
        }
      } else if (msg.type === "llm") {
        console.log("[App] 💬 LLM response");
        if (msg.content) {
          const assistantMsg: Message = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            role: "assistant",
            content: msg.content,
            timestamp: Date.now(),
          };
          messages.value.push(assistantMsg);
          currentAssistantMessage = assistantMsg;
        }
      } else if (msg.type === "tts") {
        console.log("[App] 🔊 TTS:", msg.state, msg.text);
        if (msg.state === "start") {
          isPlaying.value = true;
        } else if (msg.state === "stop") {
          isPlaying.value = false;
          currentAssistantMessage = null;
        } else if (msg.state === "sentence_end" && msg.text) {
          const textToAdd = msg.text;
          if (currentAssistantMessage) {
            const currentContent = currentAssistantMessage.content;
            if (!currentContent.endsWith(textToAdd)) {
              console.log(
                "[App] 🔊 Adding text to assistant message:",
                textToAdd
              );
              currentAssistantMessage.content += textToAdd;
            } else {
              console.log(
                "[App] ⚠️ Duplicate text detected, skipping:",
                textToAdd
              );
            }
          } else {
            console.log(
              "[App] ⚠️ No currentAssistantMessage, creating new one"
            );
            const assistantMsg: Message = {
              id:
                Date.now().toString() + Math.random().toString(36).substr(2, 9),
              role: "assistant",
              content: textToAdd,
              timestamp: Date.now(),
            };
            messages.value.push(assistantMsg);
            currentAssistantMessage = assistantMsg;
          }
        }
      } else if (msg.type === "error") {
        console.error("[App] ❌ Server error:", msg);
        const errorMsg = msg.message || msg.error || "未知错误";
        addMessage({
          role: "assistant",
          content: "[错误] " + errorMsg,
        });
        isPlaying.value = false;
        currentAssistantMessage = null;
      } else {
        console.log("[App] 📋 Other message:", msg.type);
      }
    });

    await connect(wsUrl);
    isConnected.value = true;
    console.log("[App] ✅ WebSocket connected successfully");

    // await setupWorklet();
    // await resume();

    console.log("[App] ✅ Initialized successfully");
  } catch (error) {
    console.error("[App] ❌ Failed to initialize:", error);
  }
};

const handleSendText = () => {
  console.log("[App] handleSendText called");

  if (!inputText.value.trim() || isRecording.value || isPlaying.value) {
    console.log("[App] ❌ Send blocked: conditions not met");
    return;
  }

  const text = inputText.value.trim();

  addMessage({
    role: "user",
    content: text,
  });

  console.log("[App] 📤 Sending text...");
  sendText(text);

  inputText.value = "";
};

const addMessage = (msg: Omit<Message, "id" | "timestamp">) => {
  messages.value.push({
    ...msg,
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    timestamp: Date.now(),
  });
};

// 麦克风相关变量
let audioContext: AudioContext | null = null;
let audioStream: MediaStream | null = null;
let processorNode: AudioWorkletNode | null = null;

// 音频播放相关变量
let audioQueue: Int16Array[] = [];
let isPlayingAudio: boolean = false;
let audioPlayContext: AudioContext | null = null;
let playerNode: AudioWorkletNode | null = null;
let nextPlayTime: number = 0;

// 处理麦克风按钮点击
const handleVoiceClick = () => {
  if (isRecording.value) {
    stopRecording();
  } else if (isPlaying.value) {
    console.log("[App] 停止播放");
    isPlaying.value = false;
  } else {
    startRecording();
  }
};

// 开始录音 - 使用 AudioWorklet 发送原始 PCM 数据
const startRecording = async () => {
  try {
    console.log("[App] 开始录音...");

    // 创建音频上下文
    audioContext = new AudioContext({ sampleRate: 16000 });

    // 获取麦克风权限
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
        channelCount: 1,
      },
    });

    // 加载 AudioWorklet 模块
    await audioContext.audioWorklet.addModule("/audio-processor.js");

    // 创建 AudioWorkletNode
    processorNode = new AudioWorkletNode(audioContext, "audio-processor", {
      processorOptions: {
        bufferSize: 960, // 60ms at 16kHz
      },
    });

    // 创建音频源
    const source = audioContext.createMediaStreamSource(audioStream);

    // 连接节点
    source.connect(processorNode);
    processorNode.connect(audioContext.destination);

    // 处理音频数据
    processorNode.port.onmessage = (e) => {
      if (isRecording.value && isConnected.value && isReady.value) {
        if (e.data instanceof Float32Array) {
          console.log("[App] 发送音频数据:", {
            size: e.data.buffer.byteLength,
            samples: e.data.length,
            duration: (e.data.length / 16000) * 1000 + "ms",
          });
          send(e.data.buffer);
        } else if (e.data.buffer) {
          console.log("[App] 发送音频数据:", {
            size: e.data.buffer.byteLength,
          });
          send(e.data.buffer);
        }
      }
    };

    // 发送开始监听命令
    sendListenStart();

    // 更新状态
    isRecording.value = true;
    console.log("[App] 录音开始，格式: PCM Float32Array (60ms @ 16kHz)");
  } catch (error) {
    console.error("[App] 录音失败:", error);
    alert("无法访问麦克风，请检查权限设置");
  }
};

// 停止录音
const stopRecording = () => {
  console.log("[App] 停止录音...");

  // 发送停止监听命令
  sendListenStop();

  // 停止 AudioWorklet
  if (processorNode) {
    processorNode.port.postMessage({ type: "reset" });
    processorNode.disconnect();
    processorNode = null;
  }

  // 关闭音频流
  if (audioStream) {
    audioStream.getTracks().forEach((track) => track.stop());
    audioStream = null;
  }

  // 关闭音频上下文
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  // 更新状态
  isRecording.value = false;
  console.log("[App] 录音停止");
};

// 初始化音频播放上下文
const initAudioPlayback = async () => {
  try {
    if (!audioPlayContext) {
      console.log("[App] 初始化音频播放上下文...");
      audioPlayContext = new AudioContext({ sampleRate: 16000 });
      console.log("[App] AudioContext 创建成功");

      await audioPlayContext.audioWorklet.addModule(
        "/worklet/player-processor.js"
      );
      console.log("[App] player-processor.js 加载成功");

      playerNode = new AudioWorkletNode(audioPlayContext, "player-processor");
      playerNode.connect(audioPlayContext.destination);
      console.log("[App] playerNode 创建并连接成功");

      console.log("[App] ✅ 音频播放上下文已初始化");
    }
  } catch (error) {
    console.error("[App] ❌ 初始化音频播放失败:", error);
  }
};

// 播放 Int16Array 音频数据
const playAudio = (int16Data: Int16Array) => {
  if (!audioPlayContext || !playerNode) {
    console.warn("[App] ❌ 音频播放上下文未初始化");
    return;
  }

  console.log("[App] 准备播放音频:", int16Data.length, "采样");

  // 转换为 Float32Array
  const float32Data = new Float32Array(int16Data.length);
  for (let i = 0; i < int16Data.length; i++) {
    float32Data[i] = int16Data[i] / 32768;
  }

  console.log("[App] 发送音频到 playerNode...");

  // 发送到 player node
  playerNode.port.postMessage({ audioBuffer: float32Data }, [
    float32Data.buffer,
  ]);

  console.log("[App] ✅ 播放音频:", int16Data.length, "采样");
};

// 处理音频队列
const processAudioQueue = async () => {
  if (audioQueue.length === 0) {
    isPlayingAudio = false;
    isPlaying.value = false;
    return;
  }

  isPlayingAudio = true;
  isPlaying.value = true;

  // 从队列取出音频数据
  const audioData = audioQueue.shift()!;
  playAudio(audioData);

  // 继续处理队列
  setTimeout(processAudioQueue, 50);
};

// 队列音频数据
const queueAudio = (buffer: ArrayBuffer) => {
  try {
    console.log("[App] 收到音频数据，大小:", buffer.byteLength, "字节");

    const int16Data = new Int16Array(buffer);
    console.log("[App] 转换为 Int16Array，采样数:", int16Data.length);

    audioQueue.push(int16Data);
    console.log(
      "[App] ✅ 音频入队:",
      int16Data.length,
      "采样, 队列长度:",
      audioQueue.length
    );

    // 如果没有在播放，开始播放
    if (!isPlayingAudio) {
      console.log("[App] 开始处理音频队列...");
      processAudioQueue();
    }
  } catch (error) {
    console.error("[App] ❌ 处理音频数据失败:", error);
  }
};

const toggleMagic = () => {
  console.log("[App] Magic button clicked");
};

const shareApp = async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    alert("已复制URL");
  } catch (error) {
    console.error("[App] Failed to copy URL:", error);
  }
};

onMounted(async () => {
  const preloadImages = () => {
    const images = [idleAvatar, speakingAvatar];
    images.forEach((src) => {
      const img = new Image();
      img.src = src;
    });
    console.log("[App] Avatar images preloaded");
  };
  preloadImages();

  await init();
});
</script>

<style lang="scss">
@import "@/views/IndexView.scss";
</style>
