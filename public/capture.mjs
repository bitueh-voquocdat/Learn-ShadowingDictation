import { delay, abortError } from "./audio.mjs";
export class Capture {
  constructor({
    onText = () => {},
    onState = () => {},
    onAutoStop = () => {},
  } = {}) {
    this.onText = onText;
    this.onState = onState;
    this.onAutoStop = onAutoStop;
    this.stream = null;
    this.recorder = null;
    this.recognition = null;
    this.started = 0;
    this.final = "";
    this.active = false;
    this.meter = null;
    this.stopPromise = null;
    this.epoch = 0;
  }
  static recognitionSupported() {
    return !!(
      globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition
    );
  }
  async acquire(signal) {
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder)
      throw Error(
        "Trình duyệt chưa hỗ trợ ghi âm, hoặc trang chưa dùng HTTPS.",
      );
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (signal?.aborted) {
      stream.getTracks().forEach((t) => t.stop());
      throw abortError();
    }
    this.stream = stream;
  }
  async start(signal) {
    if (this.active) throw Error("Đang ghi âm.");
    if (!this.stream) await this.acquire(signal);
    if (signal?.aborted) throw abortError();
    this.active = true;
    this.final = "";
    this.stopPromise = null;
    const epoch = ++this.epoch;
    try {
      const types = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ];
      const mime = types.find((t) => MediaRecorder.isTypeSupported(t));
      this.recorder = new MediaRecorder(
        this.stream,
        mime ? { mimeType: mime } : undefined,
      );
      const chunks = [];
      this.done = new Promise((resolve, reject) => {
        this.recorder.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data);
        };
        this.recorder.onstop = () =>
          resolve(
            new Blob(chunks, { type: this.recorder.mimeType || "audio/webm" }),
          );
        this.recorder.onerror = () => reject(Error("Ghi âm thất bại."));
      });
      this.recorder.start(250);
      this.started = Date.now();
      this.onState("recording");
      const Recognition =
        globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
      this.recognitionDone = null;
      if (Recognition) {
        try {
          const rec = (this.recognition = new Recognition());
          let recognitionEnded;
          this.recognitionDone = new Promise(
            (resolve) => (recognitionEnded = resolve),
          );
          rec.lang = "en-GB";
          rec.continuous = true;
          rec.interimResults = true;
          rec.maxAlternatives = 1;
          let parts = [];
          rec.onresult = (e) => {
            if (epoch !== this.epoch) return;
            let interim = "";
            for (let i = e.resultIndex; i < e.results.length; i++) {
              const r = e.results[i];
              if (r.isFinal) parts[i] = r[0].transcript;
              else interim += r[0].transcript + " ";
            }
            this.final = parts.filter(Boolean).join(" ");
            this.onText((this.final + " " + interim).trim(), false);
          };
          rec.onerror = (e) => {
            recognitionEnded();
            if (epoch !== this.epoch) return;
            const map = {
              "not-allowed": "Quyền nhận diện giọng nói bị từ chối.",
              "service-not-allowed":
                "Dịch vụ nhận diện không khả dụng trong trình duyệt này.",
              network: "Dịch vụ nhận diện không kết nối được.",
              "no-speech": "Chưa nhận ra lời nói.",
              "audio-capture": "Không nhận được microphone.",
            };
            if (e.error !== "aborted")
              this.onState(
                "asr-error",
                map[e.error] ||
                  "Nhận diện đã dừng. Bạn vẫn có thể nghe bản ghi và tự kiểm tra.",
              );
          };
          rec.onend = () => {
            recognitionEnded();
            if (epoch === this.epoch) this.onText(this.final, true);
          };
          rec.start();
        } catch {
          this.recognitionDone = null;
          this.onState(
            "asr-error",
            "Nhận diện không khởi động được. Bản ghi vẫn được giữ.",
          );
        }
      } else
        this.onState(
          "asr-error",
          "Trình duyệt này chưa hỗ trợ nhận diện. Bạn có thể ghi âm, nghe lại và nhập bản chép để đối chiếu.",
        );
      this.maxTimer = setTimeout(() => this.onAutoStop(), 90000);
      this.monitorSilence();
    } catch (e) {
      this.cleanup();
      this.active = false;
      throw e;
    }
  }
  monitorSilence() {
    try {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.context = new Context();
      this.context.resume().catch(() => {});
      const source = this.context.createMediaStreamSource(this.stream),
        analyser = this.context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      let spoken = false,
        lastSpeech = Date.now();
      this.meter = setInterval(() => {
        if (!this.active) return;
        analyser.getFloatTimeDomainData(data);
        const rms = Math.sqrt(
          data.reduce((n, x) => n + x * x, 0) / data.length,
        );
        if (rms > 0.025) {
          spoken = true;
          lastSpeech = Date.now();
        }
        if (spoken && Date.now() - lastSpeech > 2300) this.onAutoStop();
      }, 100);
    } catch {}
  }
  async stop(waitForRecognition = true) {
    if (this.stopPromise) return this.stopPromise;
    if (!this.active) return null;
    this.active = false;
    clearInterval(this.meter);
    clearTimeout(this.maxTimer);
    const duration = (Date.now() - this.started) / 1000;
    this.stopPromise = (async () => {
      if (this.recorder?.state !== "inactive") this.recorder.stop();
      try {
        this.recognition?.stop();
      } catch {}
      let blob;
      try {
        blob = await this.done;
        if (waitForRecognition && this.recognitionDone)
          await Promise.race([this.recognitionDone, delay(2500)]);
        return { blob, text: this.final, duration };
      } finally {
        this.cleanup();
        this.onState("idle");
      }
    })();
    return this.stopPromise;
  }
  cleanup() {
    clearInterval(this.meter);
    clearTimeout(this.maxTimer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.context) {
      this.context.close().catch(() => {});
      this.context = null;
    }
    try {
      this.recognition?.abort();
    } catch {}
    this.recognition = null;
  }
  async cancel() {
    ++this.epoch;
    const result = await this.stop(false);
    this.cleanup();
    return result;
  }
}
