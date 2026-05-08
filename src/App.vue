<template>
  <div class="app">
    <header class="header">
      <div class="header-content">
        <div class="header-left">
          <div class="logo">小智</div>
          <div class="status">
            <span
              :class="['status-dot', isConnected ? 'online' : 'offline']"
            ></span>
            <span class="status-text">{{
              isConnected ? "在线" : "连接中"
            }}</span>
          </div>
        </div>

        <div class="header-right">
          <button class="btn-icon" @click="toggleMagic">
            <i class="mdi mdi-auto-fix icon"></i>
          </button>
          <button class="btn-icon" @click="toggleTheme">
            <i
              v-if="theme === 'dark'"
              class="mdi mdi-white-balance-sunny icon"
            ></i>
            <i v-else class="mdi mdi-weather-night icon"></i>
          </button>
          <button class="btn-icon" @click="toggleFullscreen">
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
        <div
          class="avatar-container"
          :style="{
            backgroundImage: `url(${
              isPlaying || isRecording ? speakingAvatar : idleAvatar
            })`,
          }"
        ></div>
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

          <div v-if="currentResponse" class="message-wrapper assistant">
            <div class="message-bubble">
              <p class="message-content">{{ currentResponse }}</p>
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
              placeholder="输入您想问的问题..."
              rows="1"
              @keydown.enter.exact.prevent="handleSendText"
              :disabled="isRecording || isPlaying"
            ></textarea>

            <button
              class="send-btn"
              :disabled="!inputText.trim() || isRecording || isPlaying"
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
import { ref, onMounted, watch } from "vue";
import { useWebSocket } from "@/composables/useWebSocket";
import { useAudioCapture } from "@/composables/useAudioCapture";
import { useAudioPlayback } from "@/composables/useAudioPlayback";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

const theme = ref<"light" | "dark">("light");
const isConnected = ref(false);
const isRecording = ref(false);
const isPlaying = ref(false);
const isFullscreen = ref(false);
const messages = ref<Message[]>([]);
const currentResponse = ref("");
const inputText = ref("");

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
} = useWebSocket();

const { startCapture, stopCapture, getAudioData, floatTo16BitPCM } =
  useAudioCapture();

const { setupWorklet, playInt16Array, resume } = useAudioPlayback();

let sendInterval: number | null = null;

const init = async () => {
  try {
    console.log("[App] Starting WebSocket connection to:", wsUrl);
    await connect(wsUrl);
    isConnected.value = true;
    console.log("[App] ✅ WebSocket connected successfully");

    await setupWorklet();
    await resume();

    onMessage(async (msg) => {
      console.log("[App] 📩 Message received:", msg.type, msg);

      if (msg.type === "audio" && msg.data) {
        console.log("[App] � Audio data received");
        const buffer = msg.data as ArrayBuffer;
        const int16Data = new Int16Array(buffer);
        await playInt16Array(int16Data);
        isPlaying.value = true;
      } else if (msg.type === "stt") {
        console.log("[App] 📝 STT:", msg.text);
        if (msg.text) {
          currentResponse.value += msg.text;
        }
      } else if (msg.type === "llm") {
        console.log("[App] 💬 LLM response");
        if (msg.content) {
          currentResponse.value += msg.content;
        }
      } else if (msg.type === "tts") {
        console.log("[App] 🔊 TTS:", msg.state, msg.text);
        if (msg.state === "start") {
          isPlaying.value = true;
        } else if (msg.state === "stop") {
          isPlaying.value = false;
        } else if (
          (msg.state === "sentence_start" || msg.state === "sentence_end") &&
          msg.text
        ) {
          currentResponse.value += msg.text;
        }
      } else if (msg.type === "error") {
        console.error("[App] ❌ Server error:", msg);
        currentResponse.value +=
          "\n[错误] " + (msg.message || msg.error || "未知错误");
        isPlaying.value = false;
      } else {
        console.log("[App] 📋 Other message:", msg.type);
      }
    });

    console.log("[App] ✅ Initialized successfully");
  } catch (error) {
    console.error("[App] ❌ Failed to initialize:", error);
  }
};

const handleVoiceClick = () => {
  console.log("[App] handleVoiceClick called");
  console.log(
    "[App] isRecording:",
    isRecording.value,
    "isPlaying:",
    isPlaying.value
  );

  if (isRecording.value) {
    console.log("[App] Stopping recording...");
    stopRecording();
  } else if (isPlaying.value) {
    console.log("[App] Stopping playback...");
    stopPlayback();
  } else {
    console.log("[App] Starting recording...");
    startRecording();
  }
};

const startRecording = async () => {
  try {
    console.log("[App] 🎤 Starting recording...");
    console.log("[App] Current sessionId:", sessionId.value);
    console.log("[App] Current isReady:", isReady.value);

    await startCapture(16000);
    isRecording.value = true;
    currentResponse.value = "";
    isPlaying.value = false;

    console.log("[App] 📤 Sending start listen (manual mode)...");
    startListen("manual");

    sendInterval = window.setInterval(() => {
      const audioData = getAudioData();
      if (audioData && audioData.length > 0) {
        const int16Data = floatTo16BitPCM(audioData);
        const buffer = int16Data.buffer.slice(0) as ArrayBuffer;
        send(buffer);
      }
    }, 100);

    addMessage({
      role: "user",
      content: "🎤 正在录音...",
    });

    console.log("[App] ✅ Recording started");
  } catch (error) {
    console.error("[App] ❌ Failed to start recording:", error);
    isRecording.value = false;
    throw error;
  }
};

const stopRecording = () => {
  if (!isRecording.value) return;

  if (sendInterval !== null) {
    clearInterval(sendInterval);
    sendInterval = null;
  }

  stopCapture();
  isRecording.value = false;

  console.log("[App] 📤 Sending stop listen...");
  stopListen();

  console.log("[App] ⏹️ Recording stopped");
};

const stopPlayback = () => {
  console.log("[App] 📤 Sending abort to stop TTS playback...");
  abort("user_request");

  isPlaying.value = false;
  currentResponse.value = "";

  console.log("[App] ⏹️ Playback stopped");
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

const toggleTheme = () => {
  theme.value = theme.value === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", theme.value);
  localStorage.setItem("xiaozhi-theme", theme.value);
};

const toggleMagic = () => {
  console.log("[App] Magic button clicked");
};

const toggleFullscreen = () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
    isFullscreen.value = true;
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
      isFullscreen.value = false;
    }
  }
};

const shareApp = async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    alert("已复制URL");
  } catch (error) {
    console.error("[App] Failed to copy URL:", error);
  }
};

watch(currentResponse, (newValue) => {
  if (newValue) {
    const lastAssistantMsg = messages.value
      .filter((m) => m.role === "assistant")
      .pop();
    if (lastAssistantMsg) {
      lastAssistantMsg.content = newValue;
    } else {
      addMessage({
        role: "assistant",
        content: newValue,
      });
    }
  }
});

watch(isPlaying, (isPlayingNow) => {
  if (!isPlayingNow && currentResponse.value) {
    const lastAssistantMsg = messages.value
      .filter((m) => m.role === "assistant")
      .pop();
    if (lastAssistantMsg) {
      lastAssistantMsg.content = currentResponse.value;
    }
  }
});

onMounted(async () => {
  const savedTheme = localStorage.getItem("xiaozhi-theme") as
    | "light"
    | "dark"
    | null;
  if (savedTheme) {
    theme.value = savedTheme;
  }
  document.documentElement.setAttribute("data-theme", theme.value);

  await init();
});
</script>

<style lang="scss">
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body {
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
  background-color: var(--color-primary, #ffffff);
  color: var(--color-text-primary, #212529);
  transition: background-color 0.2s ease, color 0.2s ease;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#app {
  height: 100%;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--color-primary, #ffffff);
}

.header {
  background-color: var(--color-card, #ffffff);
  border-bottom: 1px solid var(--color-border, #dee2e6);
  padding: 12px 24px;
  flex-shrink: 0;
}

.header-content {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.logo {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary, #212529);
}

.status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;

  &.online {
    background-color: #28a745;
  }

  &.offline {
    background-color: #ffc107;
  }
}

.status-text {
  font-size: 12px;
  color: var(--color-text-secondary, #6c757d);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-icon {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 18px;
  background-color: transparent;
  color: var(--color-text-secondary, #6c757d);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;

  &:hover {
    color: #212529;
    border-radius: 18px;
    background-color: #eee;
  }
}

.icon {
  font-size: 24px;
  line-height: 1;
}

.main-wrapper {
  display: flex;
  flex: 1;
  overflow: hidden;
  padding: 0 150px;
}

.avatar-aside {
  width: 400px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-container {
  width: 100%;
  height: 100%;
  border-radius: 20px;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  background-position-y: 120px;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 32px;
}

.empty-state {
  text-align: center;
  margin-top: 100px;
}

.empty-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text-primary, #212529);
  margin-bottom: 8px;
}

.empty-subtitle {
  font-size: 14px;
  color: var(--color-text-secondary, #6c757d);
}

.message-wrapper {
  display: flex;
  margin-bottom: 16px;

  &.user {
    justify-content: flex-end;

    .message-bubble {
      background-color: var(--color-text-primary, #212529);
      color: var(--color-primary, #ffffff);
      border-radius: 16px 16px 4px 16px;
    }
  }

  &.assistant {
    justify-content: flex-start;

    .message-bubble {
      background-color: var(--color-secondary, #f8f9fa);
      color: var(--color-text-primary, #212529);
      border-radius: 16px 16px 16px 4px;
    }
  }
}

.message-bubble {
  max-width: 70%;
  padding: 12px 16px;
}

.message-content {
  font-size: 14px;
  line-height: 1.6;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.input-area {
  padding: 16px 32px 24px;
  background-color: var(--color-primary, #ffffff);
  flex-shrink: 0;
}

.input-container {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 800px;
  margin: 0 auto;
}

.voice-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background-color: var(--color-secondary, #f8f9fa);
  color: var(--color-text-primary, #212529);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;

  &.recording {
    background-color: #dc3545;
    color: white;
    animation: pulse 1s infinite;
  }

  &.playing {
    background-color: #ffc107;
    color: #212529;
  }

  &:hover:not(:disabled) {
    background-color: var(--color-tertiary, #e9ecef);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

@keyframes pulse {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.1);
  }
  100% {
    transform: scale(1);
  }
}

.voice-icon {
  font-size: 18px;
  line-height: 1;
}

.text-input {
  flex: 1;
  padding: 10px 16px;
  border: 1px solid var(--color-border, #dee2e6);
  border-radius: 24px;
  font-size: 14px;
  background-color: var(--color-secondary, #f8f9fa);
  color: var(--color-text-primary, #212529);
  outline: none;
  transition: all 0.2s ease;
  resize: none;
  min-height: 44px;
  max-height: 120px;
  overflow-y: auto;
  font-family: inherit;
  line-height: 1.5;

  &:focus {
    --glow-color: rgba(99, 102, 241, 1);
    --glow-color-rgb: 99, 102, 241;
    @include glow-breathe(2s);
  }

  &::placeholder {
    color: var(--color-text-muted, #adb5bd);
  }

  &:disabled {
    opacity: 0.6;
  }
}

.send-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background-color: var(--color-text-primary, #212529);
  color: var(--color-primary, #ffffff);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;

  &:hover:not(:disabled) {
    transform: scale(1.05);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.send-icon {
  font-size: 18px;
  line-height: 1;
}

::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--color-border, #dee2e6);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-muted, #adb5bd);
}
</style>
