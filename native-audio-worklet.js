class GrokNativePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.queueOffset = 0;
    this.availableFrames = 0;
    this.started = false;
    this.stopped = false;
    this.fadeInFrames = 0;
    this.fadeOutFrames = 0;
    this.lastOutput = 0;
    this.prebufferFrames = Math.max(2048, Math.round(sampleRate * .09));
    this.maxBufferFrames = Math.round(sampleRate * .75);
    this.packetFrames = Math.max(1, Math.round(sampleRate * .01));
    this.declickFrames = Math.max(32, Math.round(sampleRate * .001));
    this.receivedFrames = 0;
    this.hasPreviousInput = false;
    this.previousInput = 0;
    this.previousProcessed = 0;
    this.derivativeEnvelope = 0;
    this.declickRemaining = 0;
    this.declickAnchor = 0;

    this.port.onmessage = ({ data }) => {
      if (data?.type === 'stop') {
        this.stopped = true;
        this.queue = [];
        this.availableFrames = 0;
        return;
      }
      if (data?.type !== 'pcm' || !data.samples) return;
      const samples = data.samples instanceof Float32Array
        ? data.samples
        : new Float32Array(data.samples);
      if (!samples.length) return;
      this.suppressPacketClicks(samples);
      this.queue.push(samples);
      this.availableFrames += samples.length;

      // Évite qu'un téléphone momentanément ralenti accumule une seconde de
      // retard entre les lèvres et la voix. Cette protection ne s'active que
      // si le tampon dépasse largement sa taille normale.
      if (this.availableFrames > this.maxBufferFrames) {
        this.dropOldest(this.availableFrames - Math.round(sampleRate * .18));
        this.started = false;
        this.fadeOutFrames = 64;
      }
    };
  }

  suppressPacketClicks(samples) {
    for (let index = 0; index < samples.length; index += 1) {
      const raw = samples[index];
      const derivative = this.hasPreviousInput ? Math.abs(raw - this.previousInput) : 0;
      const atPacketBoundary = this.receivedFrames > 0
        && this.receivedFrames % this.packetFrames === 0;

      if (atPacketBoundary && this.hasPreviousInput && this.declickRemaining === 0) {
        const jump = Math.abs(raw - this.previousProcessed);
        const threshold = Math.max(.05, Math.min(.08, this.derivativeEnvelope * 5));
        if (jump > threshold) {
          this.declickRemaining = this.declickFrames;
          this.declickAnchor = this.previousProcessed;
        }
      }

      if (this.declickRemaining > 0) {
        const progress = (this.declickFrames - this.declickRemaining + 1) / this.declickFrames;
        samples[index] = this.declickAnchor + (raw - this.declickAnchor) * progress;
        this.declickRemaining -= 1;
      }

      this.derivativeEnvelope = this.derivativeEnvelope * .995 + derivative * .005;
      this.previousInput = raw;
      this.previousProcessed = samples[index];
      this.hasPreviousInput = true;
      this.receivedFrames += 1;
    }
  }

  dropOldest(frameCount) {
    let remaining = frameCount;
    while (remaining > 0 && this.queue.length) {
      const chunk = this.queue[0];
      const available = chunk.length - this.queueOffset;
      const amount = Math.min(remaining, available);
      this.queueOffset += amount;
      this.availableFrames -= amount;
      remaining -= amount;
      if (this.queueOffset >= chunk.length) {
        this.queue.shift();
        this.queueOffset = 0;
      }
    }
  }

  readSample() {
    const chunk = this.queue[0];
    if (!chunk) return 0;
    const value = chunk[this.queueOffset];
    this.queueOffset += 1;
    this.availableFrames -= 1;
    if (this.queueOffset >= chunk.length) {
      this.queue.shift();
      this.queueOffset = 0;
    }
    return value;
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    if (!channels?.length) return !this.stopped;
    const frameCount = channels[0].length;
    channels.forEach((channel) => channel.fill(0));

    for (let frame = 0; frame < frameCount; frame += 1) {
      if (!this.started && this.availableFrames >= this.prebufferFrames) {
        this.started = true;
        this.fadeInFrames = 128;
        this.fadeOutFrames = 0;
      }

      let value = 0;
      if (this.started && this.availableFrames > 0) {
        value = this.readSample();
        if (this.fadeInFrames > 0) {
          value *= (129 - this.fadeInFrames) / 128;
          this.fadeInFrames -= 1;
        }
        this.lastOutput = value;
        if (this.availableFrames === 0) {
          this.started = false;
          this.fadeOutFrames = 64;
        }
      } else if (this.fadeOutFrames > 0) {
        value = this.lastOutput * this.fadeOutFrames / 64;
        this.fadeOutFrames -= 1;
      }

      for (const channel of channels) channel[frame] = value;
    }
    return !this.stopped;
  }
}

registerProcessor('grok-native-pcm', GrokNativePcmProcessor);
