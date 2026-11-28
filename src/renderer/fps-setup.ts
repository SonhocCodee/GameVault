export interface FpsCaptureSetupResult {
  ok: boolean;
  taskCreated: boolean;
  error?: string;
}

export async function setupFpsCapture(): Promise<FpsCaptureSetupResult> {
  const api = typeof window === "undefined" ? undefined : window.electronAPI;
  if (!api?.getFpsStatus || !api.setupFpsElevation) {
    return { ok: false, taskCreated: false, error: "FPS monitoring is unavailable" };
  }

  const status = await api.getFpsStatus();
  if (!status.platformSupported) {
    return { ok: false, taskCreated: false, error: "FPS measurement is only supported on Windows" };
  }
  if (status.ready) return { ok: true, taskCreated: true };

  if (!status.presentMonFound) {
    const path = await api.downloadPresentMon?.();
    if (!path) {
      return {
        ok: false,
        taskCreated: false,
        error: "Không tải được PresentMon. Hãy kiểm tra mạng hoặc thử lại trong Cài đặt.",
      };
    }
  }

  return api.setupFpsElevation();
}
