import { ref, onUnmounted } from "vue";

interface WebSocketMessage {
  type: string;
  data?: any;
}

export function useWebSocket() {
  const ws = ref<WebSocket | null>(null);
  const isConnected = ref(false);
  const lastMessage = ref<WebSocketMessage | null>(null);
  const reconnectAttempts = ref(0);
  const maxReconnectAttempts = 5;

  let messageHandlers: ((msg: WebSocketMessage) => void)[] = [];
  let url: string = "";

  const connect = (serverUrl: string): Promise<void> => {
    return new Promise((resolve) => {
      url = serverUrl;
      ws.value = new WebSocket(url);

      ws.value.binaryType = "arraybuffer";

      ws.value.onopen = () => {
        console.log("[WebSocket] Connected");
        isConnected.value = true;
        reconnectAttempts.value = 0;

        ws.value?.send(
          JSON.stringify({
            type: "hello",
            version: 1,
            audio_params: {
              format: "opus",
              sample_rate: 16000,
              channels: 1,
            },
          })
        );

        resolve();
      };

      ws.value.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          lastMessage.value = { type: "audio", data: event.data };
        } else {
          try {
            const msg = JSON.parse(event.data);
            lastMessage.value = { type: msg.type, data: msg };
          } catch {
            lastMessage.value = { type: "text", data: event.data };
          }
        }

        messageHandlers.forEach((handler) => handler(lastMessage.value!));
      };

      ws.value.onerror = (error) => {
        console.error("[WebSocket] Error:", error);
      };

      ws.value.onclose = () => {
        console.log("[WebSocket] Disconnected");
        isConnected.value = false;
        handleReconnect();
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
      console.log(`[WebSocket] Reconnecting in ${delay}ms...`);
      setTimeout(() => connect(url), delay);
    }
  };

  const send = (data: ArrayBuffer | string) => {
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      ws.value.send(data);
    }
  };

  const sendJson = (obj: object) => {
    send(JSON.stringify(obj));
  };

  const onMessage = (handler: (msg: WebSocketMessage) => void) => {
    messageHandlers.push(handler);
  };

  const disconnect = () => {
    if (ws.value) {
      ws.value.close();
      ws.value = null;
    }
  };

  onUnmounted(() => {
    disconnect();
  });

  return {
    isConnected,
    lastMessage,
    connect,
    send,
    sendJson,
    onMessage,
    disconnect,
  };
}
