import { ref, onUnmounted } from "vue";

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
  const ws = ref<WebSocket | null>(null);
  const isConnected = ref(false);
  const reconnectAttempts = ref(0);
  const maxReconnectAttempts = 5;
  const isReady = ref(false);
  const sessionId = ref<string>("");

  let messageHandlers: ((msg: WebSocketMessage) => void)[] = [];
  let url: string = "";

  const connect = (serverUrl: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      url = serverUrl;
      const deviceId = getOrCreateDeviceId();
      const clientId = getOrCreateClientId();

      const fullUrl = url.includes("?")
        ? `${url}&device-id=${deviceId}&client-id=${clientId}`
        : `${url}?device-id=${deviceId}&client-id=${clientId}`;

      console.log("[WebSocket] Connecting to:", fullUrl);

      const wsInstance = new WebSocket(fullUrl);
      wsInstance.binaryType = "arraybuffer";

      wsInstance.onopen = () => {
        console.log("[WebSocket] ✅ Connection opened!");
        isConnected.value = true;

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

        ws.value = wsInstance;
      };

      wsInstance.onmessage = (event) => {
        console.log("[WebSocket] 📥 Received raw data:", event.data);

        if (event.data instanceof ArrayBuffer) {
          console.log(
            "[WebSocket] 🔊 Binary audio data received, length:",
            event.data.byteLength
          );
          messageHandlers.forEach((handler) =>
            handler({
              type: "audio",
              data: event.data,
            })
          );
        } else {
          try {
            const msg = JSON.parse(event.data);
            console.log(
              "[WebSocket] 📥 Parsed JSON message:",
              JSON.stringify(msg, null, 2)
            );

            if (msg.type === "hello") {
              console.log("[WebSocket] ✅ Received server hello");

              if (msg.session_id) {
                sessionId.value = msg.session_id;
                console.log("[WebSocket] ✅ Got session_id:", sessionId.value);
              } else {
                console.warn("[WebSocket] ⚠️ No session_id in hello message");
              }

              isReady.value = true;

              if (msg.audio_params) {
                console.log(
                  "[WebSocket] Server audio params:",
                  msg.audio_params
                );
              }

              messageHandlers.forEach((handler) => handler(msg));
            } else if (msg.type === "stt") {
              console.log("[WebSocket] 📝 STT message:", msg);
              messageHandlers.forEach((handler) => handler(msg));
            } else if (msg.type === "llm") {
              console.log("[WebSocket] 💬 LLM message:", msg);
              messageHandlers.forEach((handler) => handler(msg));
            } else if (msg.type === "tts") {
              console.log("[WebSocket] 🔊 TTS message:", msg.state, msg.text);
              messageHandlers.forEach((handler) => handler(msg));
            } else if (msg.type === "error") {
              console.error("[WebSocket] ❌ Error message:", msg);
              messageHandlers.forEach((handler) => handler(msg));
            } else {
              console.log("[WebSocket] 📋 Other message type:", msg.type);
              messageHandlers.forEach((handler) => handler(msg));
            }
          } catch (error) {
            console.error("[WebSocket] ❌ Failed to parse JSON:", error);
            messageHandlers.forEach((handler) =>
              handler({
                type: "error",
                data: event.data,
              })
            );
          }
        }
      };

      wsInstance.onerror = (error) => {
        console.error("[WebSocket] ❌ Error event:", error);
        reject(error);
      };

      wsInstance.onclose = (event) => {
        console.log("[WebSocket] 🔌 Connection closed");
        console.log(
          "[WebSocket] Close code:",
          event.code,
          "reason:",
          event.reason
        );
        isConnected.value = false;
        isReady.value = false;

        if (reconnectAttempts.value < maxReconnectAttempts) {
          handleReconnect();
        }
      };
    });
  };

  const handleReconnect = () => {
    if (reconnectAttempts.value < maxReconnectAttempts) {
      reconnectAttempts.value++;
      const delay = Math.min(
        1000 * Math.pow(2, reconnectAttempts.value),
        30000
      );
      console.log(
        `[WebSocket] Reconnecting in ${delay}ms... (attempt ${reconnectAttempts.value}/${maxReconnectAttempts})`
      );
      setTimeout(() => connect(url), delay);
    } else {
      console.error("[WebSocket] ❌ Max reconnect attempts reached!");
    }
  };

  const send = (data: ArrayBuffer | string) => {
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      if (typeof data === "string") {
        console.log("[WebSocket] 📤 Sending text:", data);
      } else {
        console.log(
          "[WebSocket] 📤 Sending binary audio, length:",
          data.byteLength
        );
      }
      ws.value.send(data);
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
    if (!isReady.value) {
      console.error("[WebSocket] ❌ WebSocket not ready!");
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
    if (ws.value) {
      console.log("[WebSocket] 🔌 Manually disconnecting...");
      ws.value.close();
      ws.value = null;
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
    ws,
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
