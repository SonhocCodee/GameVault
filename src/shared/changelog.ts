export interface ChangelogEntry {
  version: string;
  date: string;
  summary: string;
  fixes: string[];
  features?: string[];
  improvements?: string[];
}

/**
 * Bundled release notes shown in the "Cập nhật & Đã fix gì" tab
 * and in the post-update "What's New" modal right after updating.
 * Keep newest version at index 0.
 */
export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    version: '1.0.11',
    date: '2026-11-28',
    summary: 'Tự động quét game có sẵn trên máy (kèm giờ chơi cá nhân), thêm nút Gợi ý game khi thư viện trống và sửa đè badge giờ chơi ở Dòng thời gian.',
    features: [
      'Tự động quét sẵn game trên máy (Steam, Epic Games, GOG Galaxy, Riot Games, Xbox & Windows/AMD) ngay khi hoàn tất thiết lập lần đầu và qua nút "Quét game trên máy" ở màn hình trống hoặc menu Công cụ.',
      'Tự đọc giờ chơi cá nhân trên máy (Steam localconfig.vdf, GOG GameTimes, AMD RGStats/gmdb) và giữ nguyên quy tắc giờ xếp hạng Cộng đồng chỉ tính khi app theo dõi.',
      'Thêm nút "Gợi ý game (Top game)" ở màn hình thư viện trống để mở thẳng tab Top game trong Cộng đồng.',
    ],
    fixes: [
      'Sửa lỗi badge trạng thái và badge giờ chơi dài (4 chữ số) đè lên nhau trên thẻ game ở chế độ Dòng thời gian (TimelineView).',
    ],
  },
  {
    version: '1.0.10',
    date: '2026-11-28',
    summary: 'Đồng bộ đầy đủ chi tiết cấu hình đồ họa khi chia sẻ FPS lên Cộng đồng và cải thiện giao diện Community Hub.',
    features: [
      'Hiển thị đầy đủ các thiết lập đồ họa chi tiết (graphics.details) trong tab Cấu hình & Hiệu năng trên Community Game Hub.',
    ],
    fixes: [
      'Tự động đồng bộ lại báo cáo FPS kèm chi tiết cấu hình đồ họa lên Worker mới.',
    ],
  },
  {
    version: '1.0.8',
    date: '2026-11-27',
    summary: 'Khắc phục lỗi thiếu file latest.yml khi phát hành bản cập nhật tự động.',
    fixes: [
      'Sửa workflow phát hành (.github/workflows/release.yml) để luôn upload latest.yml trước khi công bố release, khắc phục lỗi 404 Cannot find latest.yml khi auto-update.',
    ],
  },
  {
    version: '1.0.7',
    date: '2026-11-27',
    summary: 'Thêm mục Báo lỗi (Bug Report) trực tiếp trong app và Nhật ký cập nhật (Changelog) thông báo chi tiết bản mới đã sửa gì.',
    features: [
      'Thêm mục Báo lỗi (Bug Report) cho phép gửi mô tả lỗi kèm log hệ thống và theo dõi trạng thái xử lý (Mới / Đang sửa / Đã fix).',
      'Thêm mục Cập nhật & Đã fix gì hiển thị nhật ký thay đổi từng phiên bản và tự động thông báo các lỗi đã sửa ngay sau khi cập nhật lên bản mới.',
      'Thêm tab quản lý Bug Reports trong Admin Portal để kiểm tra log và đánh dấu phiên bản đã fix.',
    ],
    fixes: [
      'Hoàn thiện kết nối IPC cho gửi log chẩn đoán (gamevault.log) và mở thư mục log.',
    ],
  },
  {
    version: '1.0.6',
    date: '2026-11-27',
    summary: 'Cải thiện tốc độ khởi động và đồng bộ.',
    improvements: [
      'Tối ưu hóa delta sync và index cơ sở dữ liệu cloud.',
    ],
    fixes: [
      'Sửa các lỗi ổn định chung trong quá trình đồng bộ.',
    ],
  },
  {
    version: '1.0.5',
    date: '2026-11-27',
    summary: 'Chống trùng lặp game (x2) và tăng tốc tìm kiếm Steam.',
    fixes: [
      'Khắc phục tình trạng trùng lặp (x2) game trong thư viện giữa thêm thủ công, Wishlist và Auto-detect.',
      'Tự động gộp metadata còn thiếu thay vì tạo bản ghi thứ hai khi nhận diện cùng một game.',
    ],
    features: [
      'Cho phép chọn trực tiếp 1 trong 5 trạng thái ban đầu ngay trong modal Thêm game mới.',
    ],
    improvements: [
      'Thêm bộ nhớ đệm RAM (appCatalogMemoryCache) giúp tìm kiếm game Steam phản hồi gần như tức thì (~0–5ms).',
    ],
  },
  {
    version: '1.0.2',
    date: '2026-11-27',
    summary: 'Nâng cấp modal thêm game và sửa lỗi kẹt bấm trên Windows.',
    fixes: [
      'Sửa lỗi treo/kẹt bấm sau khi xóa game trên Windows / GPU NVIDIA bằng ConfirmModal riêng thay cho window.confirm().',
      'Khắc phục lỗi race condition khi thêm game từ Steam và xóa nhanh.',
    ],
    features: [
      'Thêm nút "Chọn file .exe" để tự động nhận diện tên game, Steam AppID và exe.',
    ],
  },
];

export function getChangelogForVersion(version: string): ChangelogEntry | undefined {
  const normalized = version.replace(/^v/i, '').trim();
  return CHANGELOG_ENTRIES.find((entry) => entry.version === normalized);
}
