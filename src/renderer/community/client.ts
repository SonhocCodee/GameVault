import type { CommunityAdapter } from "../../shared/community.ts";
export function qualifyCommunityUrl(base: string, url: string): string {
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
export function minutesLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours.toLocaleString("vi-VN")} giờ` : `${minutes} phút`;
}
