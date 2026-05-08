import { ref, onUnmounted } from "vue";

export function useAudioCapture() {
  const isCapturing = ref(false);
  const audioContext = ref<AudioContext | null>(null);
  const mediaStream = ref<MediaStream | null>(null);
  const audioBuffer = ref<Float32Array[]>([]);

  let workletNode: AudioWorkletNode | null = null;

  const startCapture = async (sampleRate: number = 16000) => {
    try {
      mediaStream.value = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: sampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      audioContext.value = new AudioContext({ sampleRate });

      await audioContext.value.audioWorklet.addModule(
        "/worklet/recorder-processor.js"
      );

      const source = audioContext.value.createMediaStreamSource(
        mediaStream.value
      );
      workletNode = new AudioWorkletNode(
        audioContext.value,
        "recorder-processor"
      );

      workletNode.port.onmessage = (event) => {
        if (event.data.audioBuffer) {
          audioBuffer.value.push(event.data.audioBuffer);
        }
      };

      source.connect(workletNode);
      workletNode.connect(audioContext.value.destination);

      isCapturing.value = true;
      console.log("[AudioCapture] Started");
    } catch (error) {
      console.error("[AudioCapture] Failed to start:", error);
      throw error;
    }
  };

  const stopCapture = () => {
    if (workletNode) {
      workletNode.disconnect();
      workletNode = null;
    }

    if (mediaStream.value) {
      mediaStream.value.getTracks().forEach((track) => track.stop());
      mediaStream.value = null;
    }

    if (audioContext.value) {
      audioContext.value.close();
      audioContext.value = null;
    }

    isCapturing.value = false;
    audioBuffer.value = [];
    console.log("[AudioCapture] Stopped");
  };

  const getAudioData = (): Float32Array | null => {
    if (audioBuffer.value.length === 0) return null;

    const totalLength = audioBuffer.value.reduce(
      (acc, buf) => acc + buf.length,
      0
    );
    const result = new Float32Array(totalLength);
    let offset = 0;

    for (const buffer of audioBuffer.value) {
      result.set(buffer, offset);
      offset += buffer.length;
    }

    audioBuffer.value = [];
    return result;
  };

  const floatTo16BitPCM = (float32Data: Float32Array): Int16Array => {
    const int16Data = new Int16Array(float32Data.length);
    for (let i = 0; i < float32Data.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32Data[i]));
      int16Data[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return int16Data;
  };

  onUnmounted(() => {
    stopCapture();
  });

  return {
    isCapturing,
    startCapture,
    stopCapture,
    getAudioData,
    floatTo16BitPCM,
  };
}
