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
          <button class="btn-icon" @click="toggleTheme">
            <svg
              v-if="theme === 'dark'"
              class="icon"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
              />
            </svg>
            <svg
              v-else
              class="icon"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
              />
            </svg>
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
              :disabled="!isConnected || isPlaying || isRecording"
              @click="startRecording"
            >
              <svg
                v-if="isRecording"
                class="voice-icon"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              <svg
                v-else
                class="voice-icon"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"
                />
                <path
                  d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"
                />
              </svg>
            </button>

            <textarea
              v-model="inputText"
              class="text-input"
              placeholder="输入文字消息..."
              rows="1"
              @keydown.enter.exact.prevent="handleSendText"
              :disabled="isRecording || isPlaying"
            ></textarea>

            <button
              class="send-btn"
              :disabled="!inputText.trim() || isRecording || isPlaying"
              @click="handleSendText"
            >
              <svg
                class="send-icon"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
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
const messages = ref<Message[]>([]);
const currentResponse = ref("");
const inputText = ref("");

const idleAvatar = "/src/assets/webp/hlw1.webp";
const speakingAvatar = "/src/assets/webp/hlw2.webp";

const wsUrl = import.meta.env.VITE_WS_URL || "ws://192.168.112.254:8989";

const { connect, send, onMessage } = useWebSocket();

const { startCapture, stopCapture, getAudioData, floatTo16BitPCM } =
  useAudioCapture();

const { setupWorklet, playInt16Array, resume } = useAudioPlayback();

let sendInterval: number | null = null;

const init = async () => {
  try {
    await connect(wsUrl);
    isConnected.value = true;

    await setupWorklet();
    await resume();

    onMessage(async (msg) => {
      if (msg.type === "audio" && msg.data) {
        const buffer = msg.data as ArrayBuffer;
        const int16Data = new Int16Array(buffer);
        await playInt16Array(int16Data);
        isPlaying.value = true;
      } else if (msg.type === "text" || msg.type === "llm_text") {
        currentResponse.value += msg.data.text || msg.data.content || "";
      } else if (msg.type === "error") {
        console.error("[Error]", msg.data);
      }
    });

    console.log("[App] Initialized");
  } catch (error) {
    console.error("[App] Failed to initialize:", error);
  }
};

const startRecording = async () => {
  if (isRecording.value) {
    stopRecording();
    return;
  }

  try {
    await startCapture(16000);
    isRecording.value = true;
    currentResponse.value = "";

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
      content: "正在录音...",
    });

    console.log("[App] Recording started");
  } catch (error) {
    console.error("[App] Failed to start recording:", error);
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

  console.log("[App] Recording stopped");
};

const handleSendText = () => {
  if (!inputText.value.trim() || isRecording.value || isPlaying.value) return;

  addMessage({
    role: "user",
    content: inputText.value.trim(),
  });

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

watch(currentResponse, (newValue) => {
  if (newValue && !isRecording.value) {
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
  if (!isPlayingNow) {
    if (currentResponse.value) {
      const lastAssistantMsg = messages.value
        .filter((m) => m.role === "assistant")
        .pop();
      if (lastAssistantMsg) {
        lastAssistantMsg.content = currentResponse.value;
      }
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
@import "@/assets/styles/variables.scss";

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
  border-radius: 8px;
  background-color: transparent;
  color: var(--color-text-secondary, #6c757d);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;

  &:hover {
    background-color: var(--color-secondary, #f8f9fa);
    color: var(--color-text-primary, #212529);
  }
}

.icon {
  width: 18px;
  height: 18px;
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
  //   padding: 32px;
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
  border-top: 1px solid var(--color-border, #dee2e6);
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

  &:hover:not(:disabled) {
    background-color: var(--color-tertiary, #e9ecef);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.voice-icon {
  width: 18px;
  height: 18px;
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
    border-color: var(--color-text-primary, #212529);
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
  width: 18px;
  height: 18px;
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
