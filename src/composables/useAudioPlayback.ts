import { ref, onUnmounted } from "vue";

export function useAudioPlayback() {
  const isPlaying = ref(false);
  const audioContext = ref<AudioContext | null>(null);

  let workletNode: AudioWorkletNode | null = null;
  let audioQueue: Int16Array[] = [];

  const init = (sampleRate: number = 16000) => {
    if (!audioContext.value) {
      audioContext.value = new AudioContext({ sampleRate });
    }
    return audioContext.value;
  };

  const setupWorklet = async (sampleRate: number = 16000) => {
    const ctx = init(sampleRate);

    if (!ctx.audioWorklet) {
      throw new Error("AudioWorklet not supported");
    }

    await ctx.audioWorklet.addModule("/worklet/player-processor.js");

    workletNode = new AudioWorkletNode(ctx, "player-processor");
    workletNode.connect(ctx.destination);

    console.log("[AudioPlayback] Worklet ready");
  };

  const playInt16Array = async (int16Data: Int16Array) => {
    if (!audioContext.value) {
      await setupWorklet();
    }

    audioQueue.push(int16Data);

    if (!isPlaying.value) {
      processQueue();
    }
  };

  const processQueue = async () => {
    if (audioQueue.length === 0) {
      isPlaying.value = false;
      return;
    }

    isPlaying.value = true;
    const data = audioQueue.shift()!;

    if (workletNode) {
      const float32Data = new Float32Array(data.length);
      for (let i = 0; i < data.length; i++) {
        float32Data[i] = data[i] / 32768;
      }
      workletNode.port.postMessage({ audioBuffer: float32Data }, [
        float32Data.buffer,
      ]);
    }

    setTimeout(processQueue, 50);
  };

  const playArrayBuffer = async (
    buffer: ArrayBuffer,
    sampleRate: number = 16000
  ) => {
    init(sampleRate);
    const int16Data = new Int16Array(new Int8Array(buffer.slice(44)));
    await playInt16Array(int16Data);
  };

  const stop = () => {
    audioQueue = [];
    isPlaying.value = false;
  };

  const resume = async () => {
    if (audioContext.value?.state === "suspended") {
      await audioContext.value.resume();
    }
  };

  onUnmounted(() => {
    stop();
    if (workletNode) {
      workletNode.disconnect();
    }
    if (audioContext.value) {
      audioContext.value.close();
    }
  });

  return {
    isPlaying,
    init,
    setupWorklet,
    playInt16Array,
    playArrayBuffer,
    stop,
    resume,
  };
}
