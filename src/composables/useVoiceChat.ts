import { ref, onUnmounted } from "vue";
// import { useWebSocket } from "./useWebSocket";
import { useAudioCapture } from "./useAudioCapture";
import { useAudioPlayback } from "./useAudioPlayback";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export function useVoiceChat() {
  const isConnected = ref(false);
  const isRecording = ref(false);
  const isPlaying = ref(false);
  const messages = ref<Message[]>([]);
  const currentTranscript = ref("");
  const currentResponse = ref("");

  const wsUrl =
    import.meta.env.VITE_WS_URL || "ws://192.168.112.254:8989/xiaozhi/v1/";

  const { connect, send, onMessage, disconnect } = useWebSocket();

  const { startCapture, stopCapture, getAudioData, floatTo16BitPCM } =
    useAudioCapture();

  const { setupWorklet, playInt16Array, resume } = useAudioPlayback();

  let sendInterval: number | null = null;

  const init = async () => {
    console.log("[VoiceChat] Connecting to:", wsUrl);
    await connect(wsUrl);
    isConnected.value = true;

    await setupWorklet();
    await resume();

    onMessage(async (msg: any) => {
      if (msg.type === "audio" && msg.data) {
        const buffer = msg.data as ArrayBuffer;
        const int16Data = new Int16Array(buffer);
        await playInt16Array(int16Data);
        isPlaying.value = true;
      } else if (msg.type === "text" || msg.type === "llm_text") {
        currentResponse.value += msg.data.text || msg.data.content || "";
      } else if (msg.type === "transcript" || msg.type === "asr_text") {
        currentTranscript.value = msg.data.text || msg.data.content || "";
      } else if (msg.type === "error") {
        console.error("[VoiceChat] Error:", msg.data);
      }
    });

    console.log("[VoiceChat] Initialized");
  };

  const startRecording = async () => {
    if (isRecording.value) return;

    try {
      await startCapture(16000);
      isRecording.value = true;
      currentTranscript.value = "";
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
        content: "🎤 正在录音...",
      });

      console.log("[VoiceChat] Recording started");
    } catch (error) {
      console.error("[VoiceChat] Failed to start recording:", error);
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

    const lastUserMsg = messages.value.filter((m) => m.role === "user").pop();
    if (lastUserMsg && currentTranscript.value) {
      lastUserMsg.content = currentTranscript.value;
    }

    if (currentResponse.value) {
      addMessage({
        role: "assistant",
        content: currentResponse.value,
      });
    }

    console.log("[VoiceChat] Recording stopped");
  };

  const addMessage = (msg: Omit<Message, "id" | "timestamp">) => {
    messages.value.push({
      ...msg,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
    });
  };

  const clearMessages = () => {
    messages.value = [];
  };

  const disconnectAll = () => {
    stopRecording();
    disconnect();
    isConnected.value = false;
  };

  onUnmounted(() => {
    disconnectAll();
  });

  return {
    isConnected,
    isRecording,
    isPlaying,
    messages,
    currentTranscript,
    currentResponse,
    init,
    startRecording,
    stopRecording,
    addMessage,
    clearMessages,
    disconnect: disconnectAll,
  };
}
