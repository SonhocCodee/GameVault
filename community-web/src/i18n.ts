export type Lang = "vi" | "en";

export const translations = {
  vi: {
    brandSubtitle: "Permanent Playtime & Media",
    navFeatures: "Tính năng",
    navScreenshots: "Giao diện",
    navCommunity: "Cộng đồng",
    downloadExe: "Tải về (.exe)",
    downloadFull: "Tải bản cài đặt Windows (.exe)",
    exploreCommunity: "Khám phá cộng đồng",
    heroBadge: "GameVault Desktop cho Windows",
    heroTitle1: "Lưu giữ trọn vẹn",
    heroTitle2: "hành trình chơi game của bạn",
    heroDesc:
      "Tự động đếm giờ chơi chính xác, quản lý thư viện đa nền tảng, vẽ dòng thời gian phá đảo và kết nối cùng cộng đồng game thủ Việt.",
    statAutoTrack: "Tự động ghi nhận giờ chơi",
    statTimeline: "Dòng thời gian phá đảo",
    statCloudSync: "Đồng bộ & sao lưu đám mây",
    featuresTitle: "Mọi thứ bạn cần trong một ứng dụng",
    featuresSubtitle:
      "Thiết kế tối ưu cho game thủ PC: nhẹ, đẹp, không quảng cáo và đồng bộ tức thì.",
    features: [
      {
        title: "Theo dõi giờ chơi tự động",
        desc: "Tự động nhận diện game đang chạy trên Windows và ghi nhận từng phút chơi thực tế.",
        badge: "Tracker",
      },
      {
        title: "Dòng thời gian phá đảo",
        desc: "Nhìn lại những tựa game đã chinh phục theo từng tháng, từng năm kèm điểm đánh giá.",
        badge: "Timeline",
      },
      {
        title: "Thư viện & Đánh giá cá nhân",
        desc: "Phân loại Đang chơi, Đã phá đảo, Chờ chơi, Tạm dừng hay Bỏ dở cực kỳ trực quan.",
        badge: "Library",
      },
      {
        title: "Cộng đồng & Bảng xếp hạng",
        desc: "Chia sẻ khoảnh khắc, viết cảm nhận và so tài giờ chơi thực tế với mọi người.",
        badge: "Community",
      },
    ],
    screenshotsTitle: "Trải nghiệm thực tế trên GameVault",
    screenshotsSubtitle:
      "Nhấn vào từng ảnh để xem chi tiết giao diện ứng dụng Desktop.",
    screenshots: [
      {
        id: "library",
        title: "Thư viện & Game chơi gần đây",
        desc: "Quản lý toàn bộ game với trạng thái, điểm đánh giá và tổng thời gian chơi.",
      },
      {
        id: "timeline",
        title: "Dòng thời gian phá đảo",
        desc: "Lưu dấu cột mốc phá đảo theo từng tháng/năm cùng tổng thời lượng.",
      },
      {
        id: "community",
        title: "Bảng tin Cộng đồng",
        desc: "Đăng ảnh game, chia sẻ cảm nhận, hỏi đáp và khoe thành tích vừa phá đảo.",
      },
      {
        id: "leaderboard",
        title: "Top người chơi GameVault",
        desc: "Xếp hạng minh bạch dựa trên số game phá đảo và giờ chơi app ghi nhận.",
      },
    ],
    communitySectionTitle: "Cộng đồng GameVault",
    communitySectionDesc:
      "Xem bài viết mới nhất, top game và bảng xếp hạng người chơi ngay trên web.",
    signInPrompt: "Đăng nhập Google để đăng bài và tương tác.",
    loadingGoogle: "Đang nạp Google…",
    cancelSignIn: "Hủy đăng nhập",
    signOut: "Đăng xuất",
    googleLoadError:
      "Không tải được đăng nhập Google. Hãy thử lại hoặc đăng nhập trong ứng dụng.",
    signInFailed: "Đăng nhập không thành công. Hãy thử lại.",
    oauthMissing:
      "Đăng nhập web chưa được cấu hình. Bạn vẫn có thể đọc nội dung và tương tác từ ứng dụng GameVault.",
    closePreview: "Đóng",
    footerText: "GameVault — Lưu giữ kỷ niệm & thời gian chơi game bền vững.",
  },
  en: {
    brandSubtitle: "Permanent Playtime & Media",
    navFeatures: "Features",
    navScreenshots: "Screenshots",
    navCommunity: "Community",
    downloadExe: "Download (.exe)",
    downloadFull: "Download for Windows (.exe)",
    exploreCommunity: "Explore Community",
    heroBadge: "GameVault Desktop for Windows",
    heroTitle1: "Preserve every moment",
    heroTitle2: "of your gaming journey",
    heroDesc:
      "Automatically track real playtime, organize your multi-platform library, visualize your completion timeline, and connect with fellow gamers.",
    statAutoTrack: "Auto playtime tracking",
    statTimeline: "Completion timeline",
    statCloudSync: "Cloud sync & backup",
    featuresTitle: "Everything you need in one place",
    featuresSubtitle:
      "Built for PC gamers: fast, clean, ad-free, and seamlessly synced.",
    features: [
      {
        title: "Auto Playtime Tracker",
        desc: "Detects running games on Windows and records every minute of real gameplay.",
        badge: "Tracker",
      },
      {
        title: "Completion Timeline",
        desc: "Relive every game you finished by month and year with your personal ratings.",
        badge: "Timeline",
      },
      {
        title: "Smart Game Library",
        desc: "Organize games by Playing, Completed, Backlog, On Hold, or Dropped effortlessly.",
        badge: "Library",
      },
      {
        title: "Community & Leaderboard",
        desc: "Share screenshots, write reviews, and compare verified playtime with others.",
        badge: "Community",
      },
    ],
    screenshotsTitle: "Inside GameVault Desktop",
    screenshotsSubtitle:
      "Click any screenshot to inspect the full desktop interface.",
    screenshots: [
      {
        id: "library",
        title: "Library & Recent Games",
        desc: "Manage your entire collection with status badges, ratings, and playtime.",
      },
      {
        id: "timeline",
        title: "Completion Timeline",
        desc: "Track your finished games month by month with total hours played.",
      },
      {
        id: "community",
        title: "Community Feed",
        desc: "Post screenshots, share reviews, ask questions, and celebrate completions.",
      },
      {
        id: "leaderboard",
        title: "Top Players Leaderboard",
        desc: "Fair rankings based on completed games and verified app playtime.",
      },
    ],
    communitySectionTitle: "GameVault Community",
    communitySectionDesc:
      "Browse the latest posts, top games, and player rankings directly on the web.",
    signInPrompt: "Sign in with Google to post and interact.",
    loadingGoogle: "Loading Google…",
    cancelSignIn: "Cancel",
    signOut: "Sign out",
    googleLoadError:
      "Could not load Google Sign-In. Please try again or sign in via the desktop app.",
    signInFailed: "Sign-in failed. Please try again.",
    oauthMissing:
      "Web sign-in is not configured yet. You can still browse or interact from the GameVault app.",
    closePreview: "Close",
    footerText: "GameVault — Permanent Playtime & Gaming Memories.",
  },
} as const;
