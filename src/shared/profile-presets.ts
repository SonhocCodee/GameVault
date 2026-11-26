export const AVATAR_PRESETS = [
  { id: "gamepad", name: "Tay cầm", icon: "Gamepad2" },
  { id: "swords", name: "Kiếm sĩ", icon: "Swords" },
  { id: "ghost", name: "Bóng ma", icon: "Ghost" },
  { id: "bot", name: "Robot", icon: "Bot" },
  { id: "cat", name: "Mèo", icon: "Cat" },
  { id: "rocket", name: "Phi hành gia", icon: "Rocket" },
  { id: "skull", name: "Đầu lâu", icon: "Skull" },
  { id: "crown", name: "Vương miện", icon: "Crown" },
  { id: "shield", name: "Hộ vệ", icon: "Shield" },
  { id: "flame", name: "Ngọn lửa", icon: "Flame" },
  { id: "falcon", name: "Chim ưng", icon: "Bird" },
  { id: "gem", name: "Ngọc quý", icon: "Gem" },
  { id: "zap", name: "Sấm sét", icon: "Zap" },
  { id: "moon", name: "Trăng khuyết", icon: "Moon" },
  { id: "sun", name: "Mặt trời", icon: "Sun" },
  { id: "headphones", name: "Tai nghe", icon: "Headphones" },
  { id: "crosshair", name: "Thiện xạ", icon: "Crosshair" },
  { id: "trophy", name: "Nhà vô địch", icon: "Trophy" },
  { id: "cherry", name: "Anh đào", icon: "Cherry" },
  { id: "dice", name: "Xúc xắc", icon: "Dices" },
] as const;

export const BANNER_PRESETS = [
  { id: "aurora", name: "Cực quang" },
  { id: "eclipse", name: "Nhật thực" },
  { id: "ember", name: "Than hồng" },
  { id: "abyss", name: "Biển sâu" },
  { id: "frost", name: "Băng giá" },
  { id: "jade", name: "Ngọc bích" },
  { id: "amethyst", name: "Thạch anh" },
  { id: "circuit", name: "Mạch điện" },
  { id: "dusk", name: "Chạng vạng" },
  { id: "dawn", name: "Bình minh" },
  { id: "nebula", name: "Tinh vân" },
  { id: "orbit", name: "Quỹ đạo" },
  { id: "prism", name: "Lăng kính" },
  { id: "waves", name: "Sóng biếc" },
  { id: "dunes", name: "Cồn cát" },
  { id: "peaks", name: "Đỉnh núi" },
  { id: "horizon", name: "Chân trời" },
  { id: "arcade", name: "Arcade" },
  { id: "pulse", name: "Nhịp sáng" },
  { id: "velocity", name: "Tốc độ" },
] as const;

export type ProfilePresetKind = "avatars" | "banners";

export function isProfilePreset(kind: ProfilePresetKind, id: unknown): id is string {
  const presets = kind === "avatars" ? AVATAR_PRESETS : BANNER_PRESETS;
  return typeof id === "string" && presets.some((preset) => preset.id === id);
}

export function profilePresetPath(kind: ProfilePresetKind, id: unknown): string | null {
  return isProfilePreset(kind, id) ? `/community/profile-presets/${kind}/${id}.svg` : null;
}
