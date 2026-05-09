# 修复 WebSocket 状态同步问题

## 问题描述

错误信息：

```
[WebSocket] ❌ Cannot send: WebSocket not open (readyState: 3, isConnected: true, isReady: true)
```

**问题分析：**

- `readyState: 3` 表示 WebSocket 已关闭（CLOSED）
- 但 `isConnected: true` 和 `isReady: true` 显示状态为已连接
- **状态不同步！**

---

## WebSocket 状态码

| 状态码 | 常量       | 说明      |
| ------ | ---------- | --------- |
| 0      | CONNECTING | 连接中    |
| 1      | OPEN       | 已连接 ✅ |
| 2      | CLOSING    | 正在关闭  |
| 3      | CLOSED     | 已关闭 ❌ |

---

## 根本原因

### 1. 状态更新延迟

在 `useWebSocket.ts` 中，状态监听器可能存在延迟：

```typescript
// 问题：状态监听器可能有延迟
watch(status, (newStatus) => {
  if (statusStr === "CLOSED") {
    isConnected.value = false; // 更新可能有延迟
  }
});
```

### 2. onclose 处理器未更新状态

原代码中 `onclose` 事件处理器只记录日志，没有更新状态：

```typescript
// 原代码 - 问题！
vueUseWs.ws.value.onclose = (event) => {
  console.log("[WebSocket] 🔌 WebSocket closed:", event.code);
  // ❌ 没有更新 isConnected 和 isReady
};
```

### 3. 发送时只检查单个状态

原代码只检查 `isConnected`，没有检查 WebSocket 的实际状态：

```typescript
// 原代码 - 问题！
if (isConnected.value) {
  send(data); // ❌ WebSocket 可能已经关闭
}
```

---

## 已完成的修复

### 1. ✅ 在 onclose/onerror 中同步更新状态

修改 `useWebSocket.ts`：

```typescript
vueUseWs.ws.value.onerror = (error) => {
  console.error("[WebSocket] ❌ WebSocket error:", error);
  isConnected.value = false; // ✅ 立即更新状态
  isReady.value = false;
};

vueUseWs.ws.value.onclose = (event) => {
  console.log("[WebSocket] 🔌 WebSocket closed:", event.code, event.reason);
  isConnected.value = false; // ✅ 立即更新状态
  isReady.value = false;
};
```

### 2. ✅ 在 send 函数中添加完整的状态检查

修改 `send` 函数：

```typescript
const send = (data: ArrayBuffer | string) => {
  // 首先检查 WebSocket 实例
  if (!vueUseWs?.ws.value) {
    console.error("[WebSocket] ❌ WebSocket instance not found");
    isConnected.value = false;
    isReady.value = false;
    return;
  }

  const ws = vueUseWs.ws.value;
  const wsState = ws.readyState;

  // 同步状态
  if (wsState !== WebSocket.OPEN) {
    console.warn(
      `[WebSocket] ⚠️ WebSocket state: ${wsState} (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)`
    );

    if (wsState === WebSocket.CLOSED || wsState === WebSocket.CLOSING) {
      isConnected.value = false;
      isReady.value = false;
    }

    console.error("[WebSocket] ❌ Cannot send: WebSocket is not open");
    return;
  }

  // WebSocket 已连接，发送数据
  ws.send(data);
};
```

### 3. ✅ 在 IndexView.vue 中添加完整的状态检查

```typescript
mediaRecorder.ondataavailable = (event) => {
  if (
    event.data &&
    event.data.size > 0 &&
    isRecording.value &&
    isConnected.value && // ✅ WebSocket 已连接
    isReady.value // ✅ WebSocket 已就绪
  ) {
    event.data.arrayBuffer().then((buffer) => {
      send(buffer);
    });
  } else {
    // 调试信息
    console.log("[App] ⚠️ 音频数据未发送:", {
      hasData: !!event.data,
      dataSize: event.data?.size,
      isRecording: isRecording.value,
      isConnected: isConnected.value,
      isReady: isReady.value,
    });
  }
};
```

---

## 测试步骤

### 1. 重启应用

```bash
npm run dev
```

### 2. 观察控制台

#### 正常连接时应该看到：

```javascript
[WebSocket] Connecting to: ws://...
[WebSocket] Status changed: OPEN
[WebSocket] ✅ Received server hello
[WebSocket] ✅ Got session_id: xxx
[App] WebSocket connected successfully
```

#### 开始录音时应该看到：

```javascript
[App] 开始录音...
[App] 录音开始，格式: Opus
[App] 发送 Opus 数据: { size: 450 }
[App] 发送 Opus 数据: { size: 380 }
[App] 发送 Opus 数据: { size: 520 }
```

#### 如果 WebSocket 断开时应该看到：

```javascript
[WebSocket] 🔌 WebSocket closed: 1000 normal_closure
[WebSocket] ⚠️ WebSocket state: 3 (CLOSED)
[App] ⚠️ 音频数据未发送: { isConnected: false, isReady: false }
```

---

## 常见场景分析

### 场景 1: WebSocket 意外断开

**原因：**

- 网络波动
- 服务器主动断开
- 服务器重启

**症状：**

```
[WebSocket] 🔌 WebSocket closed: 1006 abnormal_closure
[WebSocket] ⚠️ WebSocket state: 3 (CLOSED)
```

**解决方案：**

- ✅ 状态已自动同步
- ✅ 音频数据不会发送
- ✅ 可以尝试重新连接

### 场景 2: 录音开始但未发送

**原因：**

- WebSocket 还未完全连接
- `isReady` 还未设置为 true

**症状：**

```
[App] ⚠️ 音频数据未发送: { isConnected: true, isReady: false }
```

**解决方案：**

- ✅ 添加了 `isReady` 检查
- ✅ 会显示详细的调试信息

### 场景 3: 状态不一致

**原因：**

- 监听器延迟
- 事件处理顺序问题

**症状：**

```
[WebSocket] ❌ Cannot send: WebSocket not open (readyState: 3, isConnected: true)
```

**解决方案：**

- ✅ 在 `onclose` 中立即更新状态
- ✅ 在 `send` 中检查实际状态
- ✅ 同步不一致的状态

---

## 调试技巧

### 1. 查看 WebSocket 详细状态

在控制台中输入：

```javascript
// 查看 WebSocket 实际状态
const ws = document.querySelector("iframe")?.contentWindow?.WebSocket;

// 或者查看 vueUseWs
console.log(vueUseWs.ws.value.readyState);
console.log(vueUseWs.ws.value.readyState === WebSocket.OPEN);
```

### 2. 添加断点

在 `useWebSocket.ts` 中添加断点：

```typescript
const send = (data: ArrayBuffer | string) => {
  // 在这里添加断点
  const ws = vueUseWs.ws.value;
  const wsState = ws?.readyState;

  console.log("Send check:", {
    wsExists: !!ws,
    wsState: wsState,
    isConnected: isConnected.value,
    isReady: isReady.value,
  });

  // ... 其余代码
};
```

### 3. 监听所有事件

```typescript
vueUseWs.ws.value.onopen = () => console.log("OPEN");
vueUseWs.ws.value.onclose = (e) => console.log("CLOSE:", e.code);
vueUseWs.ws.value.onerror = (e) => console.log("ERROR:", e);
vueUseWs.ws.value.onmessage = (e) => console.log("MESSAGE:", e.data);
```

---

## 预期行为

### 正确连接 → 录音 → 发送

```javascript
✅ [WebSocket] Status changed: OPEN
✅ [WebSocket] ✅ Got session_id
✅ [App] WebSocket connected successfully
✅ [App] 开始录音...
✅ [App] 发送 Opus 数据: { size: 450 }
✅ [App] 发送 Opus 数据: { size: 380 }
✅ [App] 录音停止
```

### WebSocket 断开时

```javascript
✅ [WebSocket] 🔌 WebSocket closed: 1000
✅ [WebSocket] ⚠️ WebSocket state: 3
✅ isConnected = false, isReady = false
✅ [App] ⚠️ 音频数据未发送
✅ 不再尝试发送
```

---

## 相关文件

修改的文件：

- `src/composables/useWebSocket.ts` - WebSocket 状态管理
- `src/views/IndexView.vue` - 录音和发送逻辑

---

## 检查清单

- [x] 在 `onclose` 中更新 `isConnected` 和 `isReady`
- [x] 在 `onerror` 中更新状态
- [x] 在 `send` 函数中检查实际 WebSocket 状态
- [x] 在 `send` 函数中同步不一致的状态
- [x] 在 `IndexView.vue` 中添加 `isReady` 检查
- [x] 添加详细的调试信息

---

## 总结

通过以下改进解决了状态同步问题：

1. **立即更新状态** - 在 `onclose/onerror` 中立即更新
2. **完整检查** - 在发送前检查实际 WebSocket 状态
3. **同步状态** - 发现不一致时自动同步
4. **详细日志** - 提供清晰的调试信息

现在 WebSocket 状态应该保持同步，音频数据只会在真正连接时发送！
