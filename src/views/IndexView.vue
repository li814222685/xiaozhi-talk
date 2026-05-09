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

const init = async () => {
  try {
    console.log("[App] Starting WebSocket connection to:", wsUrl);

    onMessage(async (msg) => {
      console.log("[App] 📩 Message received:", msg.type, msg);

      if (msg.type === "audio" && msg.data) {
        console.log("[App] 🔊 Audio data received");
        const buffer = msg.data as ArrayBuffer;
        const byteLength = buffer.byteLength;
        const alignedLength = byteLength - (byteLength % 2);
        const alignedBuffer = buffer.slice(0, alignedLength);
        const int16Data = new Int16Array(alignedBuffer);
        await playInt16Array(int16Data);
        isPlaying.value = true;
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

    await setupWorklet();
    await resume();

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
