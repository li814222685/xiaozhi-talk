import { ref, onUnmounted, watch } from "vue";
import { useWebSocket as useVueUseWebSocket } from "@vueuse/core";

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

const DEVICE_ID_KEY = "xiaozhi_device_id";
const CLIENT_ID_KEY = "xiaozhi_client_id";

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getOrCreateDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);

  if (!deviceId) {
    deviceId = generateUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
    console.log("[Device] Generated new device-id:", deviceId);
  } else {
    console.log("[Device] Using existing device-id:", deviceId);
  }

  return deviceId;
}

function getOrCreateClientId(): string {
  let clientId = localStorage.getItem(CLIENT_ID_KEY);

  if (!clientId) {
    clientId = generateUUID();
    localStorage.setItem(CLIENT_ID_KEY, clientId);
    console.log("[Device] Generated new client-id:", clientId);
  } else {
    console.log("[Device] Using existing client-id:", clientId);
  }

  return clientId;
}

export function useWebSocket() {
  const isConnected = ref(false);
  const isReady = ref(false);
  const sessionId = ref<string>("");
  const maxReconnectAttempts = 5;

  let messageHandlers: ((msg: WebSocketMessage) => void)[] = [];
  let url: string = "";
  let vueUseWs: ReturnType<typeof useVueUseWebSocket> | null = null;

  const handleMessage = (data: ArrayBuffer | string | null) => {
    if (!data) return;

    console.log("[WebSocket] 📥 Received raw data:", data);
    console.log(
      "[WebSocket] Data type:",
      typeof data,
      ArrayBuffer.isView(data),
      data instanceof ArrayBuffer
    );

    if (data instanceof ArrayBuffer) {
      console.log(
        "[WebSocket] 🔊 Binary audio data received, length:",
        data.byteLength
      );
      messageHandlers.forEach((handler) =>
        handler({
          type: "audio",
          data: data,
        })
      );
    } else {
      try {
        const msg =
          typeof data === "string"
            ? JSON.parse(data)
            : JSON.parse(new TextDecoder().decode(data as ArrayBuffer));

        console.log(
          "[WebSocket] 📥 Parsed JSON message:",
          JSON.stringify(msg, null, 2)
        );

        console.log("[WebSocket] Message type:", msg.type);

        if (msg.type === "hello") {
          console.log("[WebSocket] ✅ Received server hello");
          console.log("[WebSocket] Before setting isReady:", isReady.value);

          if (msg.session_id) {
            sessionId.value = msg.session_id;
            console.log("[WebSocket] ✅ Got session_id:", sessionId.value);
          } else {
            console.warn("[WebSocket] ⚠️ No session_id in hello message");
          }

          isReady.value = true;
          console.log("[WebSocket] After setting isReady:", isReady.value);

          if (msg.audio_params) {
            console.log("[WebSocket] Server audio params:", msg.audio_params);
          }

          console.log(
            "[WebSocket] Calling",
            messageHandlers.length,
            "handlers for hello"
          );
          messageHandlers.forEach((handler) => handler(msg));
        } else if (msg.type === "stt") {
          console.log("[WebSocket] 📝 STT message:", msg);
          console.log(
            "[WebSocket] Calling",
            messageHandlers.length,
            "handlers for stt"
          );
          messageHandlers.forEach((handler) => handler(msg));
        } else if (msg.type === "llm") {
          console.log("[WebSocket] 💬 LLM message:", msg);
          console.log(
            "[WebSocket] Calling",
            messageHandlers.length,
            "handlers for llm"
          );
          messageHandlers.forEach((handler) => handler(msg));
        } else if (msg.type === "tts") {
          console.log("[WebSocket] 🔊 TTS message:", msg.state, msg.text);
          console.log(
            "[WebSocket] Calling",
            messageHandlers.length,
            "handlers for tts"
          );
          messageHandlers.forEach((handler) => handler(msg));
        } else if (msg.type === "error") {
          console.error("[WebSocket] ❌ Error message:", msg);
          console.log(
            "[WebSocket] Calling",
            messageHandlers.length,
            "handlers for error"
          );
          messageHandlers.forEach((handler) => handler(msg));
        } else {
          console.log("[WebSocket] 📋 Other message type:", msg.type);
          console.log(
            "[WebSocket] Calling",
            messageHandlers.length,
            "handlers"
          );
          messageHandlers.forEach((handler) => handler(msg));
        }
      } catch (error) {
        console.error("[WebSocket] ❌ Failed to parse JSON:", error);
        messageHandlers.forEach((handler) =>
          handler({
            type: "error",
            data: data,
          })
        );
      }
    }
  };

  const sendHelloMessage = (wsInstance: WebSocket) => {
    const helloMessage = {
      type: "hello",
      version: 1,
      transport: "websocket",
      features: {
        mcp: false,
      },
      audio_params: {
        format: "opus",
        sample_rate: 16000,
        channels: 1,
        frame_duration: 60,
      },
    };

    console.log("[WebSocket] 📤 Sending hello:", helloMessage);
    wsInstance.send(JSON.stringify(helloMessage));
  };

  const connect = async (serverUrl: string): Promise<void> => {
    url = serverUrl;
    const deviceId = getOrCreateDeviceId();
    const clientId = getOrCreateClientId();

    const fullUrl = url.includes("?")
      ? `${url}&device-id=${deviceId}&client-id=${clientId}`
      : `${url}?device-id=${deviceId}&client-id=${clientId}`;

    console.log("[WebSocket] Connecting to:", fullUrl);

    vueUseWs = useVueUseWebSocket(fullUrl, {
      autoReconnect: {
        retries: maxReconnectAttempts,
        delay: 1000,
        onFailed() {
          console.error("[WebSocket] ❌ Max reconnect attempts reached!");
        },
      },
      immediate: false,
    });

    const { status, open } = vueUseWs;

    watch(status, (newStatus) => {
      const statusStr = String(newStatus);
      console.log("[WebSocket] Status changed:", statusStr);

      if (statusStr === "OPEN") {
        if (!isConnected.value) {
          isConnected.value = true;
          if (vueUseWs?.ws.value) {
            vueUseWs.ws.value.binaryType = "arraybuffer";
            console.log("[WebSocket] Setting up direct onmessage handler");
            vueUseWs.ws.value.onmessage = (event) => {
              console.log(
                "[WebSocket] 📥 Received from onmessage:",
                event.data
              );
              handleMessage(event.data);
            };
            vueUseWs.ws.value.onerror = (error) => {
              console.error("[WebSocket] ❌ WebSocket error:", error);
            };
            vueUseWs.ws.value.onclose = (event) => {
              console.log(
                "[WebSocket] 🔌 WebSocket closed:",
                event.code,
                event.reason
              );
            };
            sendHelloMessage(vueUseWs.ws.value);
          }
        }
      } else if (statusStr === "CLOSED" || statusStr === "CLOSING") {
        if (isConnected.value) {
          isConnected.value = false;
          isReady.value = false;
        }
      }
    });

    try {
      await open();
    } catch (error) {
      console.error("[WebSocket] ❌ Failed to connect:", error);
      throw error;
    }
  };

  const send = (data: ArrayBuffer | string) => {
    if (vueUseWs?.ws.value && vueUseWs.ws.value.readyState === WebSocket.OPEN) {
      if (typeof data === "string") {
        console.log("[WebSocket] 📤 Sending text:", data);
      } else {
        console.log(
          "[WebSocket] 📤 Sending binary audio, length:",
          data.byteLength
        );
      }
      vueUseWs.ws.value.send(data);
    } else {
      console.error("[WebSocket] ❌ Cannot send: WebSocket not open");
    }
  };

  const startListen = (mode: "auto" | "manual" | "realtime" = "manual") => {
    const message = {
      session_id: sessionId.value,
      type: "listen",
      state: "start",
      mode: mode,
    };

    console.log(
      "[WebSocket] 📤 Sending start listen:",
      JSON.stringify(message, null, 2)
    );
    send(JSON.stringify(message));
  };

  const stopListen = () => {
    const message = {
      session_id: sessionId.value,
      type: "listen",
      state: "stop",
    };

    console.log(
      "[WebSocket] 📤 Sending stop listen:",
      JSON.stringify(message, null, 2)
    );
    send(JSON.stringify(message));
  };

  const abort = (reason: string = "user_request") => {
    const message = {
      session_id: sessionId.value,
      type: "abort",
      reason: reason,
    };

    console.log(
      "[WebSocket] 📤 Sending abort:",
      JSON.stringify(message, null, 2)
    );
    send(JSON.stringify(message));
  };

  const sendText = (text: string) => {
    console.log(
      "[WebSocket] sendText called, isReady:",
      isReady.value,
      "sessionId:",
      sessionId.value
    );

    if (!isReady.value) {
      console.error(
        "[WebSocket] ❌ WebSocket not ready! Please wait for connection to establish."
      );
      return;
    }

    if (!sessionId.value) {
      console.error("[WebSocket] ❌ No session_id available!");
      return;
    }

    const message = {
      session_id: sessionId.value,
      type: "listen",
      state: "detect",
      mode: "manual",
      text: text,
    };

    console.log(
      "[WebSocket] 📤 Sending text message:",
      JSON.stringify(message, null, 2)
    );
    send(JSON.stringify(message));
  };

  const onMessage = (handler: (msg: WebSocketMessage) => void) => {
    console.log("[WebSocket] ✅ Message handler registered");
    messageHandlers.push(handler);
  };

  const disconnect = () => {
    if (vueUseWs) {
      console.log("[WebSocket] 🔌 Manually disconnecting...");
      vueUseWs.close();
      vueUseWs = null;
    }
  };

  const resetDeviceId = () => {
    localStorage.removeItem(DEVICE_ID_KEY);
    localStorage.removeItem(CLIENT_ID_KEY);
    console.log("[Device] Device IDs reset");
  };

  onUnmounted(() => {
    disconnect();
  });

  return {
    isConnected,
    sessionId,
    isReady,
    connect,
    send,
    startListen,
    stopListen,
    abort,
    sendText,
    onMessage,
    disconnect,
    resetDeviceId,
  };
}
