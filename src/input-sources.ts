export type InputSourceType = 'camera' | 'screen' | 'video' | 'none';

export class InputManager {
  private videoEl: HTMLVideoElement;
  private currentType: InputSourceType = 'none';
  private stream: MediaStream | null = null;
  private _hasNewFrame = false;
  private _rvfcSupported: boolean;

  constructor() {
    this.videoEl = document.createElement('video');
    this.videoEl.playsInline = true;
    this.videoEl.muted = true;
    this.videoEl.autoplay = true;
    this._rvfcSupported = 'requestVideoFrameCallback' in this.videoEl;
  }

  get video(): HTMLVideoElement {
    return this.videoEl;
  }

  get type(): InputSourceType {
    return this.currentType;
  }

  get ready(): boolean {
    return this.videoEl.videoWidth > 0 && this.videoEl.videoHeight > 0 && !this.videoEl.paused;
  }

  /** True when a genuinely new decoded frame is available (avoids re-uploading same frame) */
  get hasNewFrame(): boolean {
    if (!this.ready) return false;
    // If requestVideoFrameCallback is supported, we use frame-accurate sync
    if (this._rvfcSupported) return this._hasNewFrame;
    // Fallback: always upload (may duplicate but won't block)
    return true;
  }

  private startFrameCallback() {
    if (!this._rvfcSupported) return;
    const onFrame = () => {
      this._hasNewFrame = true;
      if (this.currentType !== 'none') {
        (this.videoEl as any).requestVideoFrameCallback(onFrame);
      }
    };
    (this.videoEl as any).requestVideoFrameCallback(onFrame);
  }

  async startCamera(deviceId?: string) {
    this.stop();
    const constraints: MediaStreamConstraints = {
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.videoEl.srcObject = this.stream;
    await this.videoEl.play();
    this.currentType = 'camera';
    this.startFrameCallback();
  }

  async startScreenCapture() {
    this.stop();
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    this.videoEl.srcObject = this.stream;
    await this.videoEl.play();
    this.currentType = 'screen';
    this.startFrameCallback();

    this.stream.getVideoTracks()[0].addEventListener('ended', () => {
      this.currentType = 'none';
    });
  }

  async startVideoURL(url: string) {
    this.stop();
    this.videoEl.srcObject = null;
    this.videoEl.crossOrigin = 'anonymous';
    this.videoEl.src = url;
    this.videoEl.loop = true;
    await this.videoEl.play();
    this.currentType = 'video';
    this.startFrameCallback();
  }

  stop() {
    this.currentType = 'none';
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.videoEl.srcObject = null;
    this.videoEl.src = '';
    this._hasNewFrame = false;
  }

  /** Upload current video frame to a GL texture. Only uploads if new frame available. */
  uploadToTexture(gl: WebGL2RenderingContext, tex: WebGLTexture) {
    if (!this.hasNewFrame) return;
    this._hasNewFrame = false;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.videoEl);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  }

  static async listCameras(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'videoinput');
  }
}
