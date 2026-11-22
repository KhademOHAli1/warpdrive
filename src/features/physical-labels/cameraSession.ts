import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { ScanInput } from "./contracts";

function captureFrames(
  video: HTMLVideoElement,
  decode: (frame: ImageData) => ScanInput | null,
  signal: AbortSignal,
  onScan: (input: ScanInput) => void,
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null)
    throw new AppError(ERROR_IDS.LABEL_CAMERA_UNAVAILABLE, "Camera frame capture is unavailable.");

  const interval = window.setInterval(() => {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) return;
    const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.floor(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.floor(video.videoHeight * scale));
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const scan = decode(context.getImageData(0, 0, canvas.width, canvas.height));
    if (scan !== null) onScan(scan);
  }, 180);
  signal.addEventListener("abort", () => window.clearInterval(interval), { once: true });
}

export async function runCamera(
  video: HTMLVideoElement,
  signal: AbortSignal,
  onScan: (input: ScanInput) => void,
) {
  const { createCameraDecoder } = await import("./cameraDecoder");
  signal.throwIfAborted();

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  function releaseCamera() {
    for (const track of stream.getTracks()) track.stop();
    if (video.srcObject === stream) video.srcObject = null;
  }
  if (signal.aborted) {
    releaseCamera();
    return;
  }
  signal.addEventListener("abort", releaseCamera, { once: true });
  video.srcObject = stream;
  await video.play();
  signal.throwIfAborted();
  captureFrames(video, createCameraDecoder(), signal, onScan);
}
