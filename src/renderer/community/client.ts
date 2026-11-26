import type { CommunityAdapter } from "../../shared/community.ts";

export function qualifyCommunityUrl(base: string, url: string): string {
  if (!url) return "";
  if (url.startsWith("/")) return `${base.replace(/\/$/, "")}${url}`;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export function shareUrl(
  base: string,
  kind: "game" | "post" | "profile",
  id: string,
  title?: string,
): string {
  const params = new URLSearchParams({
    [kind]: id,
  });
  if (title) params.set("title", title);
  return `${base.replace(/\/$/, "")}/community/?${params}`;
}

export function communityError(error: unknown): string {
  const message = String((error as Error)?.message || error);
  console.error("[community]", error);
  if (/top-right account menu/.test(message))
    return "Hãy đăng nhập ở góc trên bên phải của ứng dụng.";
  if (/Route not found/.test(message))
    return "Máy chủ cộng đồng chưa sẵn sàng. Hãy thử kết nối lại sau.";
  if (/Sign in|401|Chưa đăng nhập/.test(message))
    return "Bạn cần đăng nhập để thực hiện thao tác này.";
  if (/restricted|403/.test(message))
    return "Tài khoản không có quyền thực hiện thao tác này.";
  if (/Too many|429/.test(message))
    return "Bạn thao tác hơi nhanh. Hãy đợi một chút rồi thử lại.";
  if (/not found|404/.test(message)) return "Nội dung không còn khả dụng.";
  if (/Steam/.test(message))
    return "Chưa tải được dữ liệu Steam. Bạn có thể thử lại.";
  if (/snapshot|graphics context/.test(message))
    return "Phiên này chưa có đủ cấu hình và độ phân giải. Hãy đo phiên mới hoặc dùng kết quả tự khai báo.";
  if (/completed/.test(message))
    return "Hãy đánh dấu game đã hoàn thành trước khi chia sẻ kết quả.";
  if (/size|large|413/.test(message))
    return "Nội dung hoặc ảnh vượt giới hạn. Hãy chọn nội dung nhỏ hơn.";
  if (/configur|configuration/.test(message))
    return "Chưa nhận diện được file cấu hình phù hợp. Bạn có thể chọn file thủ công.";
  return "Không thực hiện được yêu cầu. Hãy kiểm tra kết nối rồi thử lại.";
}

export async function compressCommunityImage(file: File): Promise<File> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error("Invalid image size");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cannot prepare image");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let blob: Blob | null = null;
    for (const quality of [0.85, 0.65, 0.4]) {
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (blob && blob.size <= 1024 * 1024) break;
    }
    if (!blob || blob.size > 1024 * 1024) throw new Error("Image is too large");
    return new File([blob], "screenshot.jpg", {
      type: "image/jpeg",
    });
  } finally {
    bitmap.close();
  }
}

export async function uploadPostImages(
  api: CommunityAdapter,
  files: File[],
): Promise<string[]> {
  if (files.length > 3) throw new Error("Select at most three images");
  const keys: string[] = [];
  try {
    for (const f of files)
      keys.push((await api.upload(await compressCommunityImage(f))).key);
    return keys;
  } catch (error) {
    await Promise.allSettled(
      keys.map((k) =>
        api.request(`/uploads/${encodeURIComponent(k)}`, "DELETE"),
      ),
    );
    throw error;
  }
}

export function minutesLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes || 0));
  const hours = Math.floor(m / 60);
  if (hours >= 1) return `${hours.toLocaleString("vi-VN")} giờ`;
  return `${m} phút`;
}

export function parseCommunityDate(raw?: string | null): Date | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const iso = trimmed.includes("T")
    ? trimmed
    : `${trimmed.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function formatCommunityDate(raw?: string | null): string {
  const d = parseCommunityDate(raw);
  if (!d) return "";
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelativeTime(raw?: string | null): string {
  const d = parseCommunityDate(raw);
  if (!d) return "";
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return "Vừa xong";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return d.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export interface SpecRow {
  label: string;
  value: string;
}

const SPEC_LABELS: Array<[RegExp, string]> = [
  [/^(OS|Hệ điều hành)$/i, "Hệ điều hành"],
  [/^(Processor|CPU|Vi xử lý)$/i, "CPU"],
  [/^(Memory|RAM|Bộ nhớ)$/i, "RAM"],
  [/^(Graphics|Video Card|GPU|Đồ họa)$/i, "GPU"],
  [/^DirectX$/i, "DirectX"],
  [/^(Storage|Hard Drive|Disk Space|Dung lượng)$/i, "Dung lượng"],
  [/^(Network|Internet)$/i, "Mạng"],
  [/^(Sound Card|Audio)$/i, "Âm thanh"],
  [/^(Additional Notes|Notes)$/i, "Ghi chú"],
];

export function parseSteamRequirements(raw?: string | null): SpecRow[] {
  if (!raw || !raw.trim()) return [];
  const cleaned = raw
    .replace(/^(Minimum|Recommended)\s*:?\s*/i, "")
    .replace(
      /\s+(OS|Processor|Memory|Graphics|Video Card|DirectX|Storage|Hard Drive|Network|Sound Card|Additional Notes)\s*:/gi,
      "\n$1:",
    );
  const lines = cleaned
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(Minimum|Recommended):?$/i.test(l));

  const rows: SpecRow[] = [];
  for (const line of lines) {
    const match = line.match(/^([A-Za-zÀ-ỹ0-9 ]{2,28}):\s*(.+)$/);
    if (match) {
      const rawKey = match[1].trim();
      const mapped =
        SPEC_LABELS.find(([re]) => re.test(rawKey))?.[1] || rawKey;
      rows.push({ label: mapped, value: match[2].trim() });
    } else if (rows.length > 0) {
      rows[rows.length - 1].value += ` ${line}`;
    } else {
      rows.push({ label: "Thông tin", value: line });
    }
  }
  return rows;
}
