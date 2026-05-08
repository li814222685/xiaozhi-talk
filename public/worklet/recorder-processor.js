class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      const buffer = new Float32Array(channelData);
      this.port.postMessage({ audioBuffer: buffer }, [buffer.buffer]);
    }
    return true;
  }
}

registerProcessor("recorder-processor", RecorderProcessor);
