const HOME_HTML = "<!DOCTYPE html>\n<html lang=\"vi\" class=\"scroll-smooth\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>GameVault - Thư viện Game & Theo dõi Giờ chơi</title>\n  <meta name=\"description\" content=\"GameVault giúp bạn tự động đếm giờ chơi, quản lý thư viện game, vẽ dòng thời gian phá đảo và kết nối cộng đồng game thủ.\">\n  <script src=\"https://cdn.tailwindcss.com\"></script>\n  <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n  <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n  <link href=\"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap\" rel=\"stylesheet\">\n  <style>\n    :root {\n      --gv-bg: #0c0e13;\n      --gv-surface: #13161f;\n      --gv-surface-2: #191d28;\n      --gv-accent: #ff2a44;\n      --gv-accent-hover: #e11d48;\n    }\n    body {\n      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;\n      background-color: var(--gv-bg);\n      color: #f1f3f7;\n    }\n    .gv-glow {\n      background: radial-gradient(ellipse 75% 45% at 50% 0%, rgba(255, 42, 68, 0.16) 0%, rgba(14, 165, 233, 0.06) 45%, rgba(12, 14, 19, 0) 75%);\n    }\n    .gv-card {\n      background-color: var(--gv-surface);\n      border: 1px solid rgba(255, 255, 255, 0.08);\n    }\n    .gv-card:hover {\n      border-color: rgba(255, 42, 68, 0.4);\n    }\n  </style>\n</head>\n<body class=\"min-h-screen flex flex-col antialiased selection:bg-[#ff2a44]/40 selection:text-white\">\n\n  <!-- Header -->\n  <header class=\"border-b border-white/[0.08] bg-[#0c0e13]/85 backdrop-blur-md sticky top-0 z-50\">\n    <div class=\"max-w-6xl mx-auto px-5 h-16 flex items-center justify-between gap-4\">\n      <a href=\"/\" class=\"flex items-center gap-3 group shrink-0\">\n        <div class=\"w-9 h-9 rounded-xl bg-gradient-to-br from-[#ff2a44] to-[#be123c] flex items-center justify-center font-black text-sm text-white shadow-lg shadow-[#ff2a44]/30\">\n          GV\n        </div>\n        <div>\n          <div class=\"flex items-center gap-1.5\">\n            <span class=\"font-extrabold text-base tracking-wide text-white\">GAMEVAULT</span>\n            <span class=\"text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#ff2a44]/15 text-[#ff5c70] border border-[#ff2a44]/35\">PRO</span>\n          </div>\n          <div class=\"text-[11px] text-slate-400 hidden sm:block\">Permanent Playtime &amp; Media</div>\n        </div>\n      </a>\n\n      <nav class=\"hidden md:flex items-center gap-6 text-sm font-semibold text-slate-400\">\n        <a href=\"#features\" class=\"hover:text-white transition-colors\" data-i18n=\"navFeatures\">Tính năng</a>\n        <a href=\"#screenshots\" class=\"hover:text-white transition-colors\" data-i18n=\"navScreenshots\">Giao diện</a>\n        <a href=\"/privacy\" class=\"hover:text-white transition-colors\" data-i18n=\"navPrivacy\">Bảo mật</a>\n        <a href=\"/terms\" class=\"hover:text-white transition-colors\" data-i18n=\"navTerms\">Điều khoản</a>\n      </nav>\n\n      <div class=\"flex items-center gap-2.5\">\n        <div class=\"inline-flex bg-[#13161f] border border-white/[0.08] rounded-lg p-0.5\" role=\"group\" aria-label=\"Language\">\n          <button type=\"button\" id=\"btn-lang-vi\" onclick=\"setLang('vi')\" class=\"px-2.5 py-1 rounded-md text-xs font-bold transition-all bg-[#191d28] text-white shadow-sm\">\n            VI\n          </button>\n          <button type=\"button\" id=\"btn-lang-en\" onclick=\"setLang('en')\" class=\"px-2.5 py-1 rounded-md text-xs font-bold transition-all text-slate-400 hover:text-white\">\n            EN\n          </button>\n        </div>\n\n        <a href=\"/dashboard?tab=profile\" class=\"hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-white/10 bg-[#191d28] hover:bg-[#222736] text-slate-200 text-xs font-semibold transition-all\">\n          <span data-i18n=\"navLogin\">Đăng nhập / Hồ sơ</span>\n        </a>\n\n        <a href=\"#download\" class=\"inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#ff2a44] hover:bg-[#e11d48] text-white font-bold text-xs sm:text-sm transition-all shadow-lg shadow-[#ff2a44]/30\">\n          <svg class=\"w-4 h-4 shrink-0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" viewBox=\"0 0 24 24\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"></path><polyline points=\"7 10 12 15 17 10\"></polyline><line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"></line></svg>\n          <span data-i18n=\"navDownload\">Tải về</span>\n        </a>\n      </div>\n    </div>\n  </header>\n\n  <main class=\"flex-1 gv-glow\">\n    <!-- Hero Section -->\n    <section class=\"max-w-6xl mx-auto px-5 pt-14 pb-12 lg:pt-20 lg:pb-16\">\n      <div class=\"grid grid-cols-1 lg:grid-cols-12 gap-10 items-center\">\n        <div class=\"lg:col-span-6\">\n          <div class=\"inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#ff2a44]/30 bg-[#ff2a44]/10 text-[#ff6b7d] text-xs font-bold mb-5\">\n            <span class=\"w-2 h-2 rounded-full bg-emerald-400 animate-pulse\"></span>\n            <span data-i18n=\"heroBadge\">GameVault Desktop cho Windows</span>\n          </div>\n\n          <h1 class=\"text-3xl sm:text-5xl font-extrabold tracking-tight text-white mb-5 leading-[1.15]\">\n            <span data-i18n=\"heroTitle1\">Lưu giữ trọn vẹn</span><br>\n            <span class=\"bg-gradient-to-r from-[#ff2a44] via-[#fb7185] to-[#fda4af] bg-clip-text text-transparent\" data-i18n=\"heroTitle2\">\n              hành trình chơi game của bạn\n            </span>\n          </h1>\n\n          <p class=\"text-slate-400 text-base leading-relaxed mb-7 max-w-xl\" data-i18n=\"heroDesc\">\n            Tự động đếm giờ chơi chính xác, quản lý thư viện đa nền tảng, vẽ dòng thời gian phá đảo và kết nối cùng cộng đồng game thủ.\n          </p>\n\n          <div class=\"flex flex-wrap items-center gap-3 mb-7\">\n            <a href=\"#download\" class=\"px-6 py-3 rounded-xl bg-[#ff2a44] hover:bg-[#e11d48] text-white font-bold text-sm transition-all shadow-lg shadow-[#ff2a44]/30 flex items-center gap-2\">\n              <svg class=\"w-4 h-4 shrink-0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" viewBox=\"0 0 24 24\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"></path><polyline points=\"7 10 12 15 17 10\"></polyline><line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"></line></svg>\n              <span data-i18n=\"heroDownload\">Tải GameVault cho Windows</span>\n            </a>\n            <a href=\"#screenshots\" class=\"px-5 py-3 rounded-xl bg-[#191d28] hover:bg-[#222736] border border-white/10 text-slate-200 font-semibold text-sm transition-all\" data-i18n=\"heroPreviewBtn\">\n              Xem giao diện App\n            </a>\n          </div>\n\n          <div class=\"flex flex-wrap items-center gap-5 text-xs text-slate-400\">\n            <div class=\"flex items-center gap-2\">\n              <span class=\"w-1.5 h-1.5 rounded-full bg-[#ff2a44]\"></span>\n              <span data-i18n=\"stat1\">Tự động đếm giờ chơi</span>\n            </div>\n            <div class=\"flex items-center gap-2\">\n              <span class=\"w-1.5 h-1.5 rounded-full bg-emerald-400\"></span>\n              <span data-i18n=\"stat2\">Dòng thời gian phá đảo</span>\n            </div>\n            <div class=\"flex items-center gap-2\">\n              <span class=\"w-1.5 h-1.5 rounded-full bg-sky-400\"></span>\n              <span data-i18n=\"stat3\">Đồng bộ đám mây</span>\n            </div>\n          </div>\n        </div>\n\n        <div class=\"lg:col-span-6\">\n          <button type=\"button\" onclick=\"openLightbox('https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/library.jpg', currentLang === 'vi' ? 'Thư viện & Game chơi gần đây' : 'Library & Recent Games')\" class=\"block w-full text-left rounded-2xl overflow-hidden border border-white/15 bg-[#13161f] shadow-2xl shadow-black/60 hover:border-[#ff2a44]/50 transition-all group\">\n            <img src=\"https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/library.jpg\" alt=\"GameVault Desktop Library\" class=\"w-full h-auto block group-hover:scale-[1.01] transition-transform duration-300\">\n          </button>\n        </div>\n      </div>\n    </section>\n\n    <!-- Features Grid -->\n    <section id=\"features\" class=\"max-w-6xl mx-auto px-5 py-12 border-t border-white/[0.06] scroll-mt-16\">\n      <div class=\"mb-10\">\n        <h2 class=\"text-2xl sm:text-3xl font-extrabold text-white mb-2\" data-i18n=\"featuresTitle\">Mọi thứ bạn cần trong một ứng dụng</h2>\n        <p class=\"text-slate-400 text-sm\" data-i18n=\"featuresSub\">Thiết kế tối ưu cho game thủ PC: nhẹ, đẹp, không quảng cáo và đồng bộ tức thì.</p>\n      </div>\n\n      <div class=\"grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4\">\n        <div class=\"p-5 rounded-2xl gv-card transition-all\">\n          <span class=\"inline-block text-[11px] font-bold px-2.5 py-1 rounded-md bg-[#ff2a44]/15 text-[#ff6b7d] mb-3\">Tracker</span>\n          <h3 class=\"text-base font-bold text-white mb-1.5\" data-i18n=\"f1Title\">Theo dõi giờ chơi tự động</h3>\n          <p class=\"text-slate-400 text-xs sm:text-sm leading-relaxed\" data-i18n=\"f1Desc\">\n            Tự động nhận diện game đang chạy trên Windows và ghi nhận từng phút chơi thực tế.\n          </p>\n        </div>\n\n        <div class=\"p-5 rounded-2xl gv-card transition-all\">\n          <span class=\"inline-block text-[11px] font-bold px-2.5 py-1 rounded-md bg-amber-500/15 text-amber-400 mb-3\">Timeline</span>\n          <h3 class=\"text-base font-bold text-white mb-1.5\" data-i18n=\"f2Title\">Dòng thời gian phá đảo</h3>\n          <p class=\"text-slate-400 text-xs sm:text-sm leading-relaxed\" data-i18n=\"f2Desc\">\n            Nhìn lại những tựa game đã chinh phục theo từng tháng, từng năm kèm điểm đánh giá.\n          </p>\n        </div>\n\n        <div class=\"p-5 rounded-2xl gv-card transition-all\">\n          <span class=\"inline-block text-[11px] font-bold px-2.5 py-1 rounded-md bg-emerald-500/15 text-emerald-400 mb-3\">Library</span>\n          <h3 class=\"text-base font-bold text-white mb-1.5\" data-i18n=\"f3Title\">Thư viện &amp; Trạng thái</h3>\n          <p class=\"text-slate-400 text-xs sm:text-sm leading-relaxed\" data-i18n=\"f3Desc\">\n            Phân loại Đang chơi, Đã phá đảo, Chờ chơi, Tạm dừng hay Bỏ dở cực kỳ trực quan.\n          </p>\n        </div>\n\n        <div class=\"p-5 rounded-2xl gv-card transition-all\">\n          <span class=\"inline-block text-[11px] font-bold px-2.5 py-1 rounded-md bg-sky-500/15 text-sky-400 mb-3\">Community</span>\n          <h3 class=\"text-base font-bold text-white mb-1.5\" data-i18n=\"f4Title\">Cộng đồng &amp; Bảng xếp hạng</h3>\n          <p class=\"text-slate-400 text-xs sm:text-sm leading-relaxed\" data-i18n=\"f4Desc\">\n            Chia sẻ khoảnh khắc, viết cảm nhận và so tài giờ chơi thực tế với mọi người.\n          </p>\n        </div>\n      </div>\n    </section>\n\n    <!-- App Screenshots Showcase -->\n    <section id=\"screenshots\" class=\"max-w-6xl mx-auto px-5 py-12 border-t border-white/[0.06] scroll-mt-16\">\n      <div class=\"mb-10\">\n        <h2 class=\"text-2xl sm:text-3xl font-extrabold text-white mb-2\" data-i18n=\"shotsTitle\">Trải nghiệm thực tế trên GameVault</h2>\n        <p class=\"text-slate-400 text-sm\" data-i18n=\"shotsSub\">Nhấn vào từng ảnh để phóng to và xem chi tiết giao diện ứng dụng Desktop.</p>\n      </div>\n\n      <div class=\"grid grid-cols-1 md:grid-cols-2 gap-5\">\n        <button type=\"button\" onclick=\"openLightbox('https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/library.jpg', currentLang === 'vi' ? 'Thư viện & Game chơi gần đây' : 'Library & Recent Games')\" class=\"text-left rounded-2xl gv-card overflow-hidden transition-all group\">\n          <div class=\"aspect-video overflow-hidden bg-[#090b10] border-b border-white/[0.08]\">\n            <img src=\"https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/library.jpg\" alt=\"Library\" loading=\"lazy\" class=\"w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300\">\n          </div>\n          <div class=\"p-4\">\n            <h3 class=\"text-sm sm:text-base font-bold text-white mb-1\" data-i18n=\"s1Title\">Thư viện &amp; Game chơi gần đây</h3>\n            <p class=\"text-xs sm:text-sm text-slate-400\" data-i18n=\"s1Desc\">Quản lý toàn bộ game với trạng thái, điểm đánh giá sao và tổng thời gian chơi.</p>\n          </div>\n        </button>\n\n        <button type=\"button\" onclick=\"openLightbox('https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/timeline.jpg', currentLang === 'vi' ? 'Dòng thời gian phá đảo' : 'Completion Timeline')\" class=\"text-left rounded-2xl gv-card overflow-hidden transition-all group\">\n          <div class=\"aspect-video overflow-hidden bg-[#090b10] border-b border-white/[0.08]\">\n            <img src=\"https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/timeline.jpg\" alt=\"Timeline\" loading=\"lazy\" class=\"w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300\">\n          </div>\n          <div class=\"p-4\">\n            <h3 class=\"text-sm sm:text-base font-bold text-white mb-1\" data-i18n=\"s2Title\">Dòng thời gian phá đảo</h3>\n            <p class=\"text-xs sm:text-sm text-slate-400\" data-i18n=\"s2Desc\">Lưu dấu cột mốc phá đảo theo từng tháng/năm cùng tổng thời lượng.</p>\n          </div>\n        </button>\n\n        <button type=\"button\" onclick=\"openLightbox('https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/community.jpg', currentLang === 'vi' ? 'Bảng tin Cộng đồng' : 'Community Feed')\" class=\"text-left rounded-2xl gv-card overflow-hidden transition-all group\">\n          <div class=\"aspect-video overflow-hidden bg-[#090b10] border-b border-white/[0.08]\">\n            <img src=\"https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/community.jpg\" alt=\"Community\" loading=\"lazy\" class=\"w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300\">\n          </div>\n          <div class=\"p-4\">\n            <h3 class=\"text-sm sm:text-base font-bold text-white mb-1\" data-i18n=\"s3Title\">Bảng tin Cộng đồng</h3>\n            <p class=\"text-xs sm:text-sm text-slate-400\" data-i18n=\"s3Desc\">Đăng ảnh game, chia sẻ cảm nhận, hỏi đáp và khoe thành tích vừa phá đảo.</p>\n          </div>\n        </button>\n\n        <button type=\"button\" onclick=\"openLightbox('https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/leaderboard.jpg', currentLang === 'vi' ? 'Top người chơi GameVault' : 'Top Players Leaderboard')\" class=\"text-left rounded-2xl gv-card overflow-hidden transition-all group\">\n          <div class=\"aspect-video overflow-hidden bg-[#090b10] border-b border-white/[0.08]\">\n            <img src=\"https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/leaderboard.jpg\" alt=\"Leaderboard\" loading=\"lazy\" class=\"w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300\">\n          </div>\n          <div class=\"p-4\">\n            <h3 class=\"text-sm sm:text-base font-bold text-white mb-1\" data-i18n=\"s4Title\">Top người chơi GameVault</h3>\n            <p class=\"text-xs sm:text-sm text-slate-400\" data-i18n=\"s4Desc\">Xếp hạng minh bạch dựa trên số game phá đảo và giờ chơi app ghi nhận.</p>\n          </div>\n        </button>\n      </div>\n    </section>\n\n    <!-- Download Section -->\n    <section id=\"download\" class=\"max-w-4xl mx-auto px-5 py-14 scroll-mt-16\">\n      <div class=\"p-8 sm:p-12 rounded-3xl bg-gradient-to-b from-[#161923] to-[#13161f] border border-[#ff2a44]/30 text-center relative overflow-hidden shadow-2xl\">\n        <div class=\"inline-block px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-bold mb-4\" data-i18n=\"dlBadge\">\n          Phiên bản mới nhất v1.0.0\n        </div>\n        <h2 class=\"text-2xl sm:text-3xl font-extrabold text-white mb-3\" data-i18n=\"dlTitle\">Tải xuống GameVault Desktop</h2>\n        <p class=\"text-slate-400 text-sm sm:text-base max-w-xl mx-auto mb-8\" data-i18n=\"dlDesc\">\n          Hỗ trợ Windows 10 &amp; 11 (64-bit). Miễn phí, gọn nhẹ, không quảng cáo.\n        </p>\n\n        <div class=\"flex flex-col sm:flex-row items-center justify-center gap-3\">\n          <a href=\"/downloads/GameVault-Web-Setup-1.0.0.exe\" download=\"GameVault-Web-Setup-1.0.0.exe\" class=\"w-full sm:w-auto px-8 py-3.5 rounded-xl bg-[#ff2a44] hover:bg-[#e11d48] text-white font-bold text-sm transition-all shadow-lg shadow-[#ff2a44]/30 flex items-center justify-center gap-2\">\n            <svg class=\"w-5 h-5 shrink-0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" viewBox=\"0 0 24 24\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"></path><polyline points=\"7 10 12 15 17 10\"></polyline><line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"></line></svg>\n            <span data-i18n=\"dlBtn\">Tải bản cài đặt (.exe)</span>\n          </a>\n          <a href=\"/dashboard?tab=profile\" class=\"w-full sm:w-auto px-6 py-3.5 rounded-xl bg-[#191d28] hover:bg-[#222736] border border-white/10 text-slate-200 font-semibold text-sm transition-all\" data-i18n=\"dlProfile\">\n            Đăng nhập / Hồ sơ\n          </a>\n        </div>\n      </div>\n    </section>\n\n    <!-- Support / Contact Section -->\n    <section class=\"max-w-4xl mx-auto px-5 pb-16\">\n      <div class=\"p-6 sm:p-8 rounded-2xl gv-card flex flex-col sm:flex-row items-center justify-between gap-5\">\n        <div>\n          <h3 class=\"text-base sm:text-lg font-bold text-white mb-1\" data-i18n=\"supportTitle\">Cần hỗ trợ hoặc yêu cầu xóa dữ liệu?</h3>\n          <p class=\"text-slate-400 text-xs sm:text-sm\" data-i18n=\"supportDesc\">Gửi email cho chúng tôi để được hỗ trợ nhanh nhất trong vòng 24 giờ.</p>\n        </div>\n        <a href=\"mailto:son62320@gmail.com\" class=\"shrink-0 px-5 py-2.5 rounded-xl bg-[#191d28] hover:bg-[#222736] border border-white/10 text-[#ff6b7d] font-semibold text-sm transition-all\">\n          son62320@gmail.com\n        </a>\n      </div>\n    </section>\n  </main>\n\n  <!-- Lightbox Modal -->\n  <div id=\"lightbox\" class=\"fixed inset-0 z-[100] hidden bg-black/85 backdrop-blur-sm items-center justify-center p-4\" onclick=\"closeLightbox()\">\n    <div class=\"max-w-5xl w-full rounded-2xl bg-[#13161f] border border-white/15 overflow-hidden shadow-2xl\" onclick=\"event.stopPropagation()\">\n      <div class=\"flex items-center justify-between px-4 py-3 border-b border-white/10\">\n        <strong id=\"lightbox-title\" class=\"text-sm sm:text-base text-white\"></strong>\n        <button type=\"button\" onclick=\"closeLightbox()\" class=\"px-3 py-1.5 rounded-lg bg-[#191d28] hover:bg-[#222736] border border-white/10 text-xs font-semibold text-slate-200\" data-i18n=\"closeBtn\">Đóng</button>\n      </div>\n      <img id=\"lightbox-img\" src=\"\" alt=\"\" class=\"w-full max-h-[78vh] object-contain bg-[#080a0e]\">\n    </div>\n  </div>\n\n  <!-- Footer -->\n  <footer class=\"border-t border-white/[0.06] bg-[#0c0e13] py-8 text-slate-500 text-xs sm:text-sm\">\n    <div class=\"max-w-6xl mx-auto px-5 flex flex-col sm:flex-row items-center justify-between gap-4\">\n      <div data-i18n=\"footerCopy\">© 2026 GameVault. Lưu giữ kỷ niệm &amp; thời gian chơi game bền vững.</div>\n      <div class=\"flex flex-wrap items-center gap-5\">\n        <a href=\"#features\" class=\"hover:text-slate-300 transition-colors\" data-i18n=\"navFeatures\">Tính năng</a>\n        <a href=\"#screenshots\" class=\"hover:text-slate-300 transition-colors\" data-i18n=\"navScreenshots\">Giao diện</a>\n        <a href=\"/privacy\" class=\"hover:text-slate-300 transition-colors\" data-i18n=\"navPrivacy\">Bảo mật</a>\n        <a href=\"/terms\" class=\"hover:text-slate-300 transition-colors\" data-i18n=\"navTerms\">Điều khoản</a>\n        <a href=\"mailto:son62320@gmail.com\" class=\"hover:text-slate-300 transition-colors\" data-i18n=\"footerContact\">Liên hệ</a>\n      </div>\n    </div>\n  </footer>\n\n  <script>\n    const i18n = {\n      vi: {\n        navFeatures: 'Tính năng',\n        navScreenshots: 'Giao diện',\n        navPrivacy: 'Bảo mật',\n        navTerms: 'Điều khoản',\n        navLogin: 'Đăng nhập / Hồ sơ',\n        navDownload: 'Tải về',\n        heroBadge: 'GameVault Desktop cho Windows',\n        heroTitle1: 'Lưu giữ trọn vẹn',\n        heroTitle2: 'hành trình chơi game của bạn',\n        heroDesc: 'Tự động đếm giờ chơi chính xác, quản lý thư viện đa nền tảng, vẽ dòng thời gian phá đảo và kết nối cùng cộng đồng game thủ.',\n        heroDownload: 'Tải GameVault cho Windows',\n        heroPreviewBtn: 'Xem giao diện App',\n        stat1: 'Tự động đếm giờ chơi',\n        stat2: 'Dòng thời gian phá đảo',\n        stat3: 'Đồng bộ đám mây',\n        featuresTitle: 'Mọi thứ bạn cần trong một ứng dụng',\n        featuresSub: 'Thiết kế tối ưu cho game thủ PC: nhẹ, đẹp, không quảng cáo và đồng bộ tức thì.',\n        f1Title: 'Theo dõi giờ chơi tự động',\n        f1Desc: 'Tự động nhận diện game đang chạy trên Windows và ghi nhận từng phút chơi thực tế.',\n        f2Title: 'Dòng thời gian phá đảo',\n        f2Desc: 'Nhìn lại những tựa game đã chinh phục theo từng tháng, từng năm kèm điểm đánh giá.',\n        f3Title: 'Thư viện & Trạng thái',\n        f3Desc: 'Phân loại Đang chơi, Đã phá đảo, Chờ chơi, Tạm dừng hay Bỏ dở cực kỳ trực quan.',\n        f4Title: 'Cộng đồng & Bảng xếp hạng',\n        f4Desc: 'Chia sẻ khoảnh khắc, viết cảm nhận và so tài giờ chơi thực tế với mọi người.',\n        shotsTitle: 'Trải nghiệm thực tế trên GameVault',\n        shotsSub: 'Nhấn vào từng ảnh để phóng to và xem chi tiết giao diện ứng dụng Desktop.',\n        s1Title: 'Thư viện & Game chơi gần đây',\n        s1Desc: 'Quản lý toàn bộ game với trạng thái, điểm đánh giá sao và tổng thời gian chơi.',\n        s2Title: 'Dòng thời gian phá đảo',\n        s2Desc: 'Lưu dấu cột mốc phá đảo theo từng tháng/năm cùng tổng thời lượng.',\n        s3Title: 'Bảng tin Cộng đồng',\n        s3Desc: 'Đăng ảnh game, chia sẻ cảm nhận, hỏi đáp và khoe thành tích vừa phá đảo.',\n        s4Title: 'Top người chơi GameVault',\n        s4Desc: 'Xếp hạng minh bạch dựa trên số game phá đảo và giờ chơi app ghi nhận.',\n        dlBadge: 'Phiên bản mới nhất v1.0.0',\n        dlTitle: 'Tải xuống GameVault Desktop',\n        dlDesc: 'Hỗ trợ Windows 10 & 11 (64-bit). Miễn phí, gọn nhẹ, không quảng cáo.',\n        dlBtn: 'Tải bản cài đặt (.exe)',\n        dlProfile: 'Đăng nhập / Hồ sơ',\n        supportTitle: 'Cần hỗ trợ hoặc yêu cầu xóa dữ liệu?',\n        supportDesc: 'Gửi email cho chúng tôi để được hỗ trợ nhanh nhất trong vòng 24 giờ.',\n        closeBtn: 'Đóng',\n        footerCopy: '© 2026 GameVault. Lưu giữ kỷ niệm & thời gian chơi game bền vững.',\n        footerContact: 'Liên hệ'\n      },\n      en: {\n        navFeatures: 'Features',\n        navScreenshots: 'Screenshots',\n        navPrivacy: 'Privacy Policy',\n        navTerms: 'Terms of Service',\n        navLogin: 'Sign in / Profile',\n        navDownload: 'Download',\n        heroBadge: 'GameVault Desktop for Windows',\n        heroTitle1: 'Preserve every moment',\n        heroTitle2: 'of your gaming journey',\n        heroDesc: 'Automatically track real playtime, organize your multi-platform library, visualize your completion timeline, and connect with fellow gamers.',\n        heroDownload: 'Download GameVault for Windows',\n        heroPreviewBtn: 'View App Screenshots',\n        stat1: 'Auto playtime tracking',\n        stat2: 'Completion timeline',\n        stat3: 'Cloud sync & backup',\n        featuresTitle: 'Everything you need in one place',\n        featuresSub: 'Built for PC gamers: fast, clean, ad-free, and seamlessly synced.',\n        f1Title: 'Auto Playtime Tracker',\n        f1Desc: 'Detects running games on Windows and records every minute of real gameplay.',\n        f2Title: 'Completion Timeline',\n        f2Desc: 'Relive every game you finished by month and year with your personal ratings.',\n        f3Title: 'Smart Game Library',\n        f3Desc: 'Organize games by Playing, Completed, Backlog, On Hold, or Dropped effortlessly.',\n        f4Title: 'Community & Leaderboard',\n        f4Desc: 'Share screenshots, write reviews, and compare verified playtime with others.',\n        shotsTitle: 'Inside GameVault Desktop',\n        shotsSub: 'Click any screenshot to inspect the full desktop interface.',\n        s1Title: 'Library & Recent Games',\n        s1Desc: 'Manage your entire collection with status badges, star ratings, and playtime.',\n        s2Title: 'Completion Timeline',\n        s2Desc: 'Track your finished games month by month with total hours played.',\n        s3Title: 'Community Feed',\n        s3Desc: 'Post screenshots, share reviews, ask questions, and celebrate completions.',\n        s4Title: 'Top Players Leaderboard',\n        s4Desc: 'Fair rankings based on completed games and verified app playtime.',\n        dlBadge: 'Latest Release v1.0.0',\n        dlTitle: 'Download GameVault Desktop',\n        dlDesc: 'Compatible with Windows 10 & 11 (64-bit). Free, lightweight, and ad-free.',\n        dlBtn: 'Download Installer (.exe)',\n        dlProfile: 'Sign in / Profile',\n        supportTitle: 'Need help or want to request data deletion?',\n        supportDesc: 'Send us an email and our team will assist you within 24 hours.',\n        closeBtn: 'Close',\n        footerCopy: '© 2026 GameVault. Permanent Playtime & Gaming Memories.',\n        footerContact: 'Contact'\n      }\n    };\n\n    let currentLang = localStorage.getItem('gamevault.web.lang') === 'en' ? 'en' : 'vi';\n\n    function setLang(lang) {\n      currentLang = lang;\n      localStorage.setItem('gamevault.web.lang', lang);\n      document.documentElement.lang = lang;\n      const dict = i18n[lang];\n      document.querySelectorAll('[data-i18n]').forEach((el) => {\n        const key = el.getAttribute('data-i18n');\n        if (dict[key]) el.textContent = dict[key];\n      });\n      const viBtn = document.getElementById('btn-lang-vi');\n      const enBtn = document.getElementById('btn-lang-en');\n      if (lang === 'vi') {\n        viBtn.className = 'px-2.5 py-1 rounded-md text-xs font-bold transition-all bg-[#191d28] text-white shadow-sm';\n        enBtn.className = 'px-2.5 py-1 rounded-md text-xs font-bold transition-all text-slate-400 hover:text-white';\n      } else {\n        enBtn.className = 'px-2.5 py-1 rounded-md text-xs font-bold transition-all bg-[#191d28] text-white shadow-sm';\n        viBtn.className = 'px-2.5 py-1 rounded-md text-xs font-bold transition-all text-slate-400 hover:text-white';\n      }\n    }\n\n    function openLightbox(src, title) {\n      const box = document.getElementById('lightbox');\n      document.getElementById('lightbox-img').src = src;\n      document.getElementById('lightbox-title').textContent = title;\n      box.classList.remove('hidden');\n      box.classList.add('flex');\n    }\n\n    function closeLightbox() {\n      const box = document.getElementById('lightbox');\n      box.classList.add('hidden');\n      box.classList.remove('flex');\n    }\n\n    setLang(currentLang);\n  </script>\n</body>\n</html>\n";
const PRIVACY_HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>Privacy Policy - GameVault</title>\n  <meta name=\"description\" content=\"Privacy Policy for GameVault application and 9router.click services.\">\n  <script src=\"https://cdn.tailwindcss.com\"></script>\n  <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n  <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n  <link href=\"https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap\" rel=\"stylesheet\">\n  <style>\n    body { font-family: 'Plus Jakarta Sans', sans-serif; }\n  </style>\n</head>\n<body class=\"bg-slate-950 text-slate-100 min-h-screen flex flex-col antialiased\">\n\n  <!-- Header -->\n  <header class=\"border-b border-slate-800/80 bg-slate-950/80 backdrop-blur sticky top-0 z-50\">\n    <div class=\"max-w-5xl mx-auto px-6 h-16 flex items-center justify-between\">\n      <a href=\"/\" class=\"flex items-center gap-3\">\n        <div class=\"w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-sm\">G</div>\n        <span class=\"font-extrabold text-lg text-white\">GameVault</span>\n      </a>\n      <nav class=\"flex items-center gap-4 text-sm font-medium text-slate-300\">\n        <a href=\"/\" onclick=\"if (window.history.length > 1) { window.history.back(); return false; }\" class=\"flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors\">\n          <svg class=\"w-3.5 h-3.5 inline-block\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" viewBox=\"0 0 24 24\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M10 19l-7-7m0 0l7-7m-7 7h18\"/></svg>\n          <span>Quay lại</span>\n        </a>\n        <a href=\"/\" class=\"hover:text-white transition-colors\">Trang chủ</a>\n        <a href=\"/terms\" class=\"hover:text-white transition-colors\">Terms of Service</a>\n        <a href=\"/dashboard?tab=profile\" class=\"hover:text-white transition-colors text-indigo-400\">Đăng nhập</a>\n        <a href=\"/#download\" class=\"px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-all shadow-md shadow-indigo-600/30 flex items-center gap-1.5\">\n          <svg class=\"w-4 h-4 shrink-0 inline-block\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" viewBox=\"0 0 24 24\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"></path><polyline points=\"7 10 12 15 17 10\"></polyline><line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"></line></svg>\n          <span>Download</span>\n        </a>\n      </nav>\n    </div>\n  </header>\n\n  <main class=\"flex-1 max-w-4xl mx-auto px-6 py-12\">\n    <div class=\"mb-6\">\n      <a href=\"/\" onclick=\"if (window.history.length > 1) { window.history.back(); return false; }\" class=\"inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-indigo-400 hover:text-indigo-300 text-sm font-medium border border-slate-800 transition-colors\">\n        <svg class=\"w-4 h-4 inline-block\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" viewBox=\"0 0 24 24\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M10 19l-7-7m0 0l7-7m-7 7h18\"/></svg>\n        <span>Quay lại trang trước</span>\n      </a>\n    </div>\n    <div class=\"mb-10 pb-6 border-b border-slate-800\">\n      <div class=\"inline-block px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold mb-3\">\n        Legal Document\n      </div>\n      <h1 class=\"text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-2\">Privacy Policy</h1>\n      <p class=\"text-sm text-slate-400\">Effective Date: November 23, 2026 | Last Updated: November 23, 2026</p>\n    </div>\n\n    <div class=\"space-y-8 text-slate-300 leading-relaxed text-sm sm:text-base\">\n      \n      <!-- Section 1 -->\n      <section>\n        <h2 class=\"text-xl font-bold text-white mb-3\">1. Introduction</h2>\n        <p>\n          Welcome to <strong>GameVault</strong> (\"we\", \"our\", or \"us\"), accessible via <a href=\"https://9router.click\" class=\"text-indigo-400 underline\">https://9router.click</a> and our desktop application. GameVault respects your privacy and is committed to protecting the personal information you share with us.\n        </p>\n        <p class=\"mt-2\">\n          This Privacy Policy outlines how we collect, use, disclose, and safeguard your information when you use our application and associated web services.\n        </p>\n      </section>\n\n      <!-- Section 2 -->\n      <section>\n        <h2 class=\"text-xl font-bold text-white mb-3\">2. Information We Collect</h2>\n        <p>We only collect information necessary to provide and enhance your gaming experience:</p>\n        <ul class=\"list-disc pl-6 mt-2 space-y-2 text-slate-300\">\n          <li>\n            <strong>Google Account Information (OAuth):</strong> When you choose to sign in with Google, we collect your Google email address, basic profile name, unique Google user ID, and avatar profile picture. We do <em>not</em> access your Google Drive, contacts, emails, or password.\n          </li>\n          <li>\n            <strong>Game Library & Playtime Data:</strong> Game titles, total playtime hours, launch timestamps, completion statuses, personal tags, and ratings you track within the application.\n          </li>\n          <li>\n            <strong>Community Content:</strong> Public reviews, community pick votes, and leaderboard scores that you voluntarily submit.\n          </li>\n          <li>\n            <strong>Hardware Specifications (Optional):</strong> Optional system specifications (CPU, GPU, RAM) you choose to save in your profile to check game compatibility.\n          </li>\n        </ul>\n      </section>\n\n      <!-- Section 3: Google Limited Use -->\n      <section class=\"p-5 rounded-2xl bg-indigo-950/40 border border-indigo-800/50\">\n        <h2 class=\"text-xl font-bold text-indigo-200 mb-2\">3. Google API Services User Data Policy Compliance</h2>\n        <p class=\"text-slate-200\">\n          GameVault's use and transfer of information received from Google APIs to any other app will adhere to the \n          <a href=\"https://developers.google.com/terms/api-services-user-data-policy\" target=\"_blank\" rel=\"noopener noreferrer\" class=\"text-indigo-400 underline font-medium\">\n            Google API Services User Data Policy\n          </a>, including the Limited Use requirements.\n        </p>\n        <p class=\"text-slate-300 mt-2 text-sm\">\n          We strictly do not use Google user data to train generalized AI/ML models, sell data to third parties, or use your data for advertising purposes.\n        </p>\n      </section>\n\n      <!-- Section 4 -->\n      <section>\n        <h2 class=\"text-xl font-bold text-white mb-3\">4. How We Use Your Information</h2>\n        <p>We use the collected information solely for:</p>\n        <ul class=\"list-disc pl-6 mt-2 space-y-1.5\">\n          <li>Authenticating your account and maintaining your session.</li>\n          <li>Synchronizing your game library, statistics, and playtime across multiple devices.</li>\n          <li>Displaying community leaderboards, reviews, and community pick statistics.</li>\n          <li>Ensuring service security, preventing fraud, and diagnosing technical issues.</li>\n        </ul>\n      </section>\n\n      <!-- Section 5 -->\n      <section>\n        <h2 class=\"text-xl font-bold text-white mb-3\">5. Data Sharing & Third Parties</h2>\n        <p>\n          We do <strong>not</strong> sell, rent, or monetize your personal information under any circumstances. We only share information with trusted infrastructure providers required to operate the service:\n        </p>\n        <ul class=\"list-disc pl-6 mt-2 space-y-1.5\">\n          <li><strong>Cloudflare:</strong> Secure serverless hosting, encrypted database (D1), and content delivery network.</li>\n          <li><strong>Google Identity Services:</strong> To verify authentication credentials when logging in.</li>\n        </ul>\n      </section>\n\n      <!-- Section 6: Data Deletion -->\n      <section id=\"deletion\" class=\"p-6 rounded-2xl bg-slate-900 border border-slate-800\">\n        <h2 class=\"text-xl font-bold text-white mb-2\">6. User Rights & Data Deletion Instructions</h2>\n        <p class=\"mb-3\">\n          You have the right to view, modify, or permanently delete your account and all associated data at any time.\n        </p>\n        <div class=\"space-y-2\">\n          <p class=\"font-semibold text-indigo-300\">How to request data deletion:</p>\n          <ul class=\"list-decimal pl-6 space-y-1.5 text-slate-300\">\n            <li>\n              Send an email to our support team at <a href=\"mailto:son62320@gmail.com\" class=\"text-indigo-400 font-medium underline\">son62320@gmail.com</a> with the subject line <strong>\"Data Deletion Request\"</strong>.\n            </li>\n            <li>Include the Google email address registered with your GameVault account.</li>\n            <li>Upon receiving your request, all your library data, profile, and authentication records will be permanently purged from our servers within <strong>30 days</strong>.</li>\n          </ul>\n        </div>\n      </section>\n\n      <!-- Section 7 -->\n      <section>\n        <h2 class=\"text-xl font-bold text-white mb-3\">7. Data Security</h2>\n        <p>\n          All communications between your client application and our servers are encrypted in transit using industry-standard TLS/HTTPS protocols. Data stored in our database is secured with modern access control measures.\n        </p>\n      </section>\n\n      <!-- Section 8 -->\n      <section>\n        <h2 class=\"text-xl font-bold text-white mb-3\">8. Contact Us</h2>\n        <p>If you have any questions, feedback, or concerns regarding this Privacy Policy, please contact:</p>\n        <div class=\"mt-3 p-4 rounded-xl bg-slate-900/80 border border-slate-800 text-sm\">\n          <p class=\"text-white font-medium\">GameVault Development Team</p>\n          <p class=\"text-slate-400 mt-1\">Lead Developer Email: <a href=\"mailto:son62320@gmail.com\" class=\"text-indigo-400 underline\">son62320@gmail.com</a></p>\n          <p class=\"text-slate-400\">Website: <a href=\"https://9router.click\" class=\"text-indigo-400 underline\">https://9router.click</a></p>\n        </div>\n      </section>\n\n    </div>\n    <div class=\"mt-12 pt-6 border-t border-slate-800/80 flex items-center justify-between\">\n      <a href=\"/\" onclick=\"if (window.history.length > 1) { window.history.back(); return false; }\" class=\"inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition-colors\">\n        ← Quay lại\n      </a>\n      <a href=\"/\" class=\"text-sm text-indigo-400 hover:text-indigo-300 font-medium transition-colors\">\n        Về Trang chủ GameVault →\n      </a>\n    </div>\n  </main>\n\n  <!-- Footer -->\n  <footer class=\"border-t border-slate-900 bg-slate-950 py-8 text-slate-500 text-sm\">\n    <div class=\"max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4\">\n      <div>© 2026 GameVault. All rights reserved.</div>\n      <div class=\"flex items-center gap-6\">\n        <a href=\"/\" class=\"hover:text-slate-300\">Home</a>\n        <a href=\"/#download\" class=\"hover:text-slate-300\">Download</a>\n        <a href=\"/terms\" class=\"hover:text-slate-300\">Terms of Service</a>\n        <a href=\"mailto:son62320@gmail.com\" class=\"hover:text-slate-300\">Contact</a>\n      </div>\n    </div>\n  </footer>\n\n</body>\n</html>";
const TERMS_HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>Terms of Service - GameVault</title>\n  <meta name=\"description\" content=\"Terms of Service for GameVault application and 9router.click.\">\n  <script src=\"https://cdn.tailwindcss.com\"></script>\n  <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n  <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n  <link href=\"https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap\" rel=\"stylesheet\">\n  <style>\n    body { font-family: 'Plus Jakarta Sans', sans-serif; }\n  </style>\n</head>\n<body class=\"bg-slate-950 text-slate-100 min-h-screen flex flex-col antialiased\">\n\n  <!-- Header -->\n  <header class=\"border-b border-slate-800/80 bg-slate-950/80 backdrop-blur sticky top-0 z-50\">\n    <div class=\"max-w-5xl mx-auto px-6 h-16 flex items-center justify-between\">\n      <a href=\"/\" class=\"flex items-center gap-3\">\n        <div class=\"w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-sm\">G</div>\n        <span class=\"font-extrabold text-lg text-white\">GameVault</span>\n      </a>\n      <nav class=\"flex items-center gap-4 text-sm font-medium text-slate-300\">\n        <a href=\"/\" onclick=\"if (window.history.length > 1) { window.history.back(); return false; }\" class=\"flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors\">\n          <svg class=\"w-3.5 h-3.5 inline-block\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" viewBox=\"0 0 24 24\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M10 19l-7-7m0 0l7-7m-7 7h18\"/></svg>\n          <span>Quay lại</span>\n        </a>\n        <a href=\"/\" class=\"hover:text-white transition-colors\">Trang chủ</a>\n        <a href=\"/privacy\" class=\"hover:text-white transition-colors\">Privacy Policy</a>\n        <a href=\"/dashboard?tab=profile\" class=\"hover:text-white transition-colors text-indigo-400\">Đăng nhập</a>\n        <a href=\"/#download\" class=\"px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-all shadow-md shadow-indigo-600/30 flex items-center gap-1.5\">\n          <svg class=\"w-4 h-4 shrink-0 inline-block\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" viewBox=\"0 0 24 24\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"></path><polyline points=\"7 10 12 15 17 10\"></polyline><line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"></line></svg>\n          <span>Download</span>\n        </a>\n      </nav>\n    </div>\n  </header>\n\n  <main class=\"flex-1 max-w-4xl mx-auto px-6 py-12\">\n    <div class=\"mb-6\">\n      <a href=\"/\" onclick=\"if (window.history.length > 1) { window.history.back(); return false; }\" class=\"inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-indigo-400 hover:text-indigo-300 text-sm font-medium border border-slate-800 transition-colors\">\n        <svg class=\"w-4 h-4 inline-block\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" viewBox=\"0 0 24 24\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M10 19l-7-7m0 0l7-7m-7 7h18\"/></svg>\n        <span>Quay lại trang trước</span>\n      </a>\n    </div>\n    <div class=\"mb-10 pb-6 border-b border-slate-800\">\n      <div class=\"inline-block px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold mb-3\">\n        Legal Document\n      </div>\n      <h1 class=\"text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-2\">Terms of Service</h1>\n      <p class=\"text-sm text-slate-400\">Effective Date: November 23, 2026 | Last Updated: November 23, 2026</p>\n    </div>\n\n    <div class=\"space-y-8 text-slate-300 leading-relaxed text-sm sm:text-base\">\n      \n      <!-- Section 1 -->\n      <section>\n        <h2 class=\"text-xl font-bold text-white mb-3\">1. Agreement to Terms</h2>\n        <p>\n          These Terms of Service constitute a legally binding agreement made between you (\"User\", \"you\") and <strong>GameVault</strong> (\"we\", \"us\", or \"our\"), concerning your access to and use of the GameVault application, website (<a href=\"https://9router.click\" class=\"text-indigo-400 underline\">https://9router.click</a>), and related sync services.\n        </p>\n        <p class=\"mt-2\">\n          By downloading, installing, accessing, or using GameVault, you confirm that you have read, understood, and agreed to be bound by all of these Terms of Service. If you do not agree, you are expressly prohibited from using the service.\n        </p>\n      </section>\n\n      <!-- Section 2 -->\n      <section>\n        <h2 class=\"text-xl font-bold text-white mb-3\">2. User Accounts & Google Authentication</h2>\n        <p>\n          To utilize multi-device cloud synchronization and community features, you may authenticate via your Google Account. You agree to:\n        </p>\n        <ul class=\"list-disc pl-6 mt-2 space-y-1.5\">\n          <li>Maintain the security of your account credentials.</li>\n          <li>Promptly notify us if you discover or suspect any unauthorized access to your account.</li>\n          <li>Accept responsibility for all activities that occur under your authenticated account.</li>\n        </ul>\n      </section>\n\n      <!-- Section 3 -->\n      <section>\n        <h2 class=\"text-xl font-bold text-white mb-3\">3. Acceptable Use Policy</h2>\n        <p>You agree not to engage in any of the following prohibited activities:</p>\n        <ul class=\"list-disc pl-6 mt-2 space-y-1.5\">\n          <li>Attempting to bypass, disable, or interfere with security-related features of GameVault.</li>\n          <li>Using automated scripts, bots, or scrapers to extract data or spam reviews/votes.</li>\n          <li>Submitting harassing, abusive, defamatory, or obscene content in game reviews or community discussions.</li>\n          <li>Manipulating playtime statistics or leaderboard standings fraudulently.</li>\n        </ul>\n      </section>\n\n      <!-- Section 4 -->\n      <section>\n        <h2 class=\"text-xl font-bold text-white mb-3\">4. Intellectual Property Rights</h2>\n        <p>\n          The GameVault software, branding, UI designs, and backend architecture are owned by the GameVault developers.\n        </p>\n        <p class=\"mt-2 text-slate-400 text-sm\">\n          Third-party game names, logos, cover art, and trademarks referenced within GameVault are the property of their respective owners, publishers, and developers. GameVault is an independent organization and is not officially affiliated with Steam, Epic Games, GOG, or any respective game publisher.\n        </p>\n      </section>\n\n      <!-- Section 5 -->\n      <section>\n        <h2 class=\"text-xl font-bold text-white mb-3\">5. Termination</h2>\n        <p>\n          We reserve the right to suspend or terminate your access to GameVault cloud services at our sole discretion, without notice, for conduct that violates these Terms of Service or is harmful to other users or the service.\n        </p>\n      </section>\n\n      <!-- Section 6 -->\n      <section>\n        <h2 class=\"text-xl font-bold text-white mb-3\">6. Disclaimer of Warranties</h2>\n        <p>\n          GameVault is provided on an \"AS-IS\" and \"AS-AVAILABLE\" basis. To the fullest extent permitted by law, we disclaim all warranties, express or implied, in connection with the software and your use thereof, including fitness for a particular purpose or non-infringement.\n        </p>\n      </section>\n\n      <!-- Section 7 -->\n      <section>\n        <h2 class=\"text-xl font-bold text-white mb-3\">7. Limitation of Liability</h2>\n        <p>\n          In no event will GameVault or its developers be liable to you or any third party for any direct, indirect, consequential, exemplary, incidental, or special damages arising from your use of the application.\n        </p>\n      </section>\n\n      <!-- Section 8 -->\n      <section>\n        <h2 class=\"text-xl font-bold text-white mb-3\">8. Changes to Terms</h2>\n        <p>\n          We reserve the right to modify these Terms of Service at any time. We will indicate the \"Effective Date\" at the top of this document. Continued use of GameVault following any changes indicates your acceptance of the revised terms.\n        </p>\n      </section>\n\n      <!-- Section 9 -->\n      <section>\n        <h2 class=\"text-xl font-bold text-white mb-3\">9. Contact Information</h2>\n        <p>For questions or notices concerning these Terms of Service, please reach out to:</p>\n        <div class=\"mt-3 p-4 rounded-xl bg-slate-900/80 border border-slate-800 text-sm\">\n          <p class=\"text-white font-medium\">GameVault Development Team</p>\n          <p class=\"text-slate-400 mt-1\">Email: <a href=\"mailto:son62320@gmail.com\" class=\"text-indigo-400 underline\">son62320@gmail.com</a></p>\n          <p class=\"text-slate-400\">Website: <a href=\"https://9router.click\" class=\"text-indigo-400 underline\">https://9router.click</a></p>\n        </div>\n      </section>\n\n    </div>\n    <div class=\"mt-12 pt-6 border-t border-slate-800/80 flex items-center justify-between\">\n      <a href=\"/\" onclick=\"if (window.history.length > 1) { window.history.back(); return false; }\" class=\"inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition-colors\">\n        ← Quay lại\n      </a>\n      <a href=\"/\" class=\"text-sm text-indigo-400 hover:text-indigo-300 font-medium transition-colors\">\n        Về Trang chủ GameVault →\n      </a>\n    </div>\n  </main>\n\n  <!-- Footer -->\n  <footer class=\"border-t border-slate-900 bg-slate-950 py-8 text-slate-500 text-sm\">\n    <div class=\"max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4\">\n      <div>© 2026 GameVault. All rights reserved.</div>\n      <div class=\"flex items-center gap-6\">\n        <a href=\"/\" class=\"hover:text-slate-300\">Home</a>\n        <a href=\"/#download\" class=\"hover:text-slate-300\">Download</a>\n        <a href=\"/privacy\" class=\"hover:text-slate-300\">Privacy Policy</a>\n        <a href=\"mailto:son62320@gmail.com\" class=\"hover:text-slate-300\">Contact</a>\n      </div>\n    </div>\n  </footer>\n\n</body>\n</html>";

const DEFAULT_API_URL = 'https://game-vault-worker.gamevault-son.workers.dev';
const DEFAULT_CF_ACCOUNT_ID = '56aee61715618184fb5702ec502aa333';
const DEFAULT_CF_D1_ID = '2f252069-15b0-4957-a6d2-c31be05f7344';
const DEFAULT_CF_WORKER_NAME = 'game-vault-worker';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function fetchJsonWithTiming(url, init = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, init);
    const latencyMs = Date.now() - started;
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, latencyMs, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      error: err?.message || 'Network error',
      data: null,
    };
  }
}

async function verifyAdminSession(apiUrl, authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Chưa đăng nhập' };
  }
  const res = await fetchJsonWithTiming(`${apiUrl}/api/admin/me`, {
    headers: { Authorization: authHeader },
  });
  if (!res.ok || !res.data?.isAdmin) {
    return {
      ok: false,
      status: res.status === 401 ? 401 : 403,
      error: 'Chỉ tài khoản Admin mới được xem trang quản trị server',
    };
  }
  return { ok: true, admin: res.data };
}

async function fetchCloudflareMetrics(cfToken, accountId, d1Id, workerName) {
  if (!cfToken) return { configured: false };

  const headers = {
    Authorization: `Bearer ${cfToken}`,
    'Content-Type': 'application/json',
  };

  const d1Promise = fetchJsonWithTiming(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${d1Id}`,
    { headers }
  );

  const now = new Date();
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const until = now.toISOString();
  const gqlQuery = {
    query: `query($accountTag: string!, $since: Time!, $until: Time!, $scriptName: string!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(
            limit: 100,
            filter: { datetime_geq: $since, datetime_leq: $until, scriptName: $scriptName }
          ) {
            sum { requests errors subrequests }
            quantiles { cpuTimeP50 }
          }
        }
      }
    }`,
    variables: {
      accountTag: accountId,
      since,
      until,
      scriptName: workerName,
    },
  };

  const gqlPromise = fetchJsonWithTiming('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify(gqlQuery),
  });

  const [d1Res, gqlRes] = await Promise.all([d1Promise, gqlPromise]);

  const d1 = d1Res.ok && d1Res.data?.success ? d1Res.data.result : null;
  const d1Error = !d1 ? (d1Res.data?.errors?.[0]?.message || d1Res.error || `HTTP ${d1Res.status}`) : null;

  let workerMetrics = null;
  let workerError = null;
  if (gqlRes.ok && gqlRes.data?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive) {
    const rows = gqlRes.data.data.viewer.accounts[0].workersInvocationsAdaptive;
    let requests = 0;
    let errors = 0;
    let subrequests = 0;
    let cpuSum = 0;
    let cpuCount = 0;
    for (const r of rows) {
      requests += Number(r?.sum?.requests || 0);
      errors += Number(r?.sum?.errors || 0);
      subrequests += Number(r?.sum?.subrequests || 0);
      if (r?.quantiles?.cpuTimeP50 != null) {
        cpuSum += Number(r.quantiles.cpuTimeP50);
        cpuCount++;
      }
    }
    workerMetrics = {
      requests24h: requests,
      errors24h: errors,
      subrequests24h: subrequests,
      cpuTimeP50Ms: cpuCount > 0 ? Math.round((cpuSum / cpuCount / 1000) * 100) / 100 : 0,
    };
  } else {
    workerError = gqlRes.data?.errors?.[0]?.message || gqlRes.error || `HTTP ${gqlRes.status}`;
  }

  return {
    configured: true,
    d1: d1
      ? {
          name: d1.name,
          uuid: d1.uuid,
          numTables: d1.num_tables,
          region: d1.running_in_region,
          databaseSizeBytes: Number(d1.file_size || 0),
          readQueries24h: Number(d1.read_queries_24h || 0),
          writeQueries24h: Number(d1.write_queries_24h || 0),
          rowsRead24h: Number(d1.rows_read_24h || 0),
          rowsWritten24h: Number(d1.rows_written_24h || 0),
        }
      : null,
    d1Error,
    worker: workerMetrics,
    workerError,
  };
}

function renderHtml(apiUrl) {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GameVault · Đăng nhập &amp; Profile</title>
  <script src="https://accounts.google.com/gsi/client" async defer></script>
  <style>
    :root {
      --bg: #0b0f17;
      --panel: #131a26;
      --panel-2: #192233;
      --border: #263248;
      --text: #e6edf7;
      --muted: #8b9bb4;
      --accent: #6366f1;
      --accent-hover: #4f46e5;
      --accent-2: #22d3ee;
      --ok: #10b981;
      --warn: #f59e0b;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at top right, rgba(99,102,241,0.14), transparent 36%), var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    .wrap { max-width: 1180px; margin: 0 auto; padding: 22px 18px 56px; }
    .topbar {
      display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between;
      margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border);
    }
    .brand { display: flex; align-items: center; gap: 12px; text-decoration: none; color: inherit; }
    .logo {
      width: 38px; height: 38px; border-radius: 10px;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      display: grid; place-items: center; font-weight: 800; color: #fff; font-size: 18px;
    }
    .title { font-size: 18px; font-weight: 700; margin: 0; }
    .subtitle { font-size: 12px; color: var(--muted); margin: 2px 0 0; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .pill {
      display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px;
      border-radius: 999px; font-size: 12px; font-weight: 600;
      background: var(--panel); border: 1px solid var(--border); color: var(--text);
      text-decoration: none; cursor: pointer; transition: 0.15s all;
    }
    .pill:hover { border-color: var(--accent); color: #fff; }
    .pill-accent {
      background: var(--accent); border-color: var(--accent); color: #fff;
    }
    .pill-accent:hover { background: var(--accent-hover); }
    button, .btn {
      cursor: pointer; border: 1px solid var(--border); background: var(--panel-2); color: var(--text);
      padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600;
      transition: 0.15s border-color, 0.15s background;
    }
    button:hover, .btn:hover { border-color: var(--accent); }
    .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .btn-primary:hover { filter: brightness(1.08); }
    .tabs { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
    .tab {
      padding: 9px 16px; border-radius: 9px; border: 1px solid var(--border);
      background: var(--panel); color: var(--muted); font-weight: 600; font-size: 13px;
    }
    .tab.active { background: var(--accent); border-color: var(--accent); color: #fff; }
    .hero {
      background: linear-gradient(135deg, rgba(99,102,241,0.16), rgba(34,211,238,0.08));
      border: 1px solid var(--border); border-radius: 16px; padding: 24px; margin-bottom: 18px;
    }
    .hero h2 { margin: 0 0 8px; font-size: 24px; }
    .hero p { margin: 0; color: var(--muted); line-height: 1.6; max-width: 760px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
    .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    @media (max-width: 920px) { .grid-4 { grid-template-columns: repeat(2, 1fr); } .grid-3, .grid-2 { grid-template-columns: 1fr; } }
    @media (max-width: 540px) { .grid-4 { grid-template-columns: 1fr; } }
    .card {
      background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 20px;
    }
    .card h3 { margin: 0 0 14px; font-size: 16px; font-weight: 700; display: flex; align-items: center; justify-content: space-between; }
    .metric-label { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
    .metric-val { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; }
    .metric-sub { font-size: 12px; color: var(--muted); margin-top: 6px; }
    .bar { height: 7px; border-radius: 999px; background: #0c111b; overflow: hidden; margin-top: 10px; border: 1px solid var(--border); }
    .bar > i { display: block; height: 100%; background: var(--accent); transition: width 0.3s ease; }
    .bar.warn > i { background: var(--warn); }
    .bar.danger > i { background: var(--danger); }
    .bar.ok > i { background: var(--ok); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); display: inline-block; }
    .dot.ok { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
    .dot.bad { background: var(--danger); }
    .section { margin-top: 18px; }
    .input {
      width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border);
      background: #0c111b; color: var(--text); font-size: 13px;
    }
    .row { display: flex; gap: 8px; align-items: center; }
    .muted { color: var(--muted); font-size: 13px; }
    .list { display: flex; flex-direction: column; gap: 10px; }
    .item {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 10px 12px; border-radius: 10px; background: var(--panel-2); border: 1px solid var(--border);
    }
    .item-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .thumb { width: 38px; height: 50px; border-radius: 6px; object-fit: cover; background: #0c111b; flex-shrink: 0; }
    .avatar { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; border: 2px solid var(--accent); background: #0c111b; }
    .truncate { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .badge {
      font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 999px;
      background: rgba(99,102,241,0.16); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.35);
    }
    .badge.ok { background: rgba(16,185,129,0.14); color: #6ee7b7; border-color: rgba(16,185,129,0.35); }
    .notice {
      padding: 12px 14px; border-radius: 10px; background: rgba(245,158,11,0.08);
      border: 1px solid rgba(245,158,11,0.3); font-size: 13px; line-height: 1.5;
    }
    .hidden { display: none !important; }
    code { background: #0c111b; padding: 2px 6px; border-radius: 5px; font-size: 12px; }
    .login-box {
      background: rgba(99,102,241,0.06); border: 1px solid rgba(99,102,241,0.25);
      border-radius: 14px; padding: 24px; max-width: 600px; margin: 0 auto;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="topbar">
      <a href="/" class="brand">
        <div class="logo">GV</div>
        <div>
          <h1 class="title">GameVault</h1>
          <p class="subtitle">Quản lý thư viện game, theo dõi giờ chơi &amp; Cộng đồng</p>
        </div>
      </a>
      <div class="actions">
        <a class="pill" href="/">← Trang chủ</a>
        <a class="pill" href="${apiUrl}/community/" target="_blank" rel="noreferrer">Cộng đồng ↗</a>
        <button id="topbar-login-btn" class="pill pill-accent" onclick="switchTab('profile')">🔑 Đăng nhập</button>
        <a id="admin-portal-link" class="pill hidden" href="${apiUrl}/admin/" target="_blank" rel="noreferrer">Admin Covers ↗</a>
        <button id="logout-btn" class="pill hidden">Đăng xuất</button>
      </div>
    </header>

    <nav class="tabs">
      <button class="tab active" id="tab-btn-profile" data-tab="profile">Đăng nhập / Profile</button>
      <button class="tab" id="tab-btn-intro" data-tab="intro">Giới thiệu &amp; BXH</button>
      <button class="tab hidden" id="admin-tab-btn" data-tab="admin">Quản trị Server</button>
    </nav>

    <!-- TAB 1: PROFILE / LOGIN (Active by default for Profile/Login requests) -->
    <div id="tab-profile">
      <div class="card">
        <div id="auth-guest">
          <div class="login-box">
            <div style="text-align: center; margin-bottom: 18px;">
              <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(99,102,241,0.2); color: #818cf8; display: inline-grid; place-items: center; font-size: 20px; margin-bottom: 8px;">🔑</div>
              <h2 style="margin: 0 0 6px; font-size: 19px; font-weight: 800; color: #fff;">Đăng nhập tài khoản GameVault</h2>
              <p class="muted" style="margin: 0; font-size: 13px;">Đăng nhập bằng tài khoản Google đã liên kết với app GameVault để xem nhanh thư viện game, số giờ chơi và cấu hình PC.</p>
            </div>

            <div id="google-btn-wrap" style="display: flex; justify-content: center; margin: 18px 0; min-height: 44px;">
              <button id="google-custom-btn" onclick="triggerGoogleLogin()" style="display: inline-flex; align-items: center; justify-content: center; gap: 10px; background: #ffffff; color: #1f1f1f; border: 1px solid #747775; border-radius: 24px; padding: 10px 24px; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.2); transition: all 0.2s;">
                <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
                <span>Đăng nhập bằng Google</span>
              </button>
            </div>
            <div id="google-note" class="muted" style="font-size: 12px; text-align: center; margin-bottom: 14px;"></div>

            <p id="auth-error" class="muted" style="color: var(--danger); margin-top: 10px; font-weight: 600; text-align: center;"></p>
          </div>
        </div>

        <div id="auth-profile" class="hidden">
          <div class="row" style="gap: 16px; align-items: center; margin-bottom: 20px;">
            <img id="p-avatar" class="avatar" alt="Avatar" />
            <div style="min-width: 0; flex: 1;">
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <strong id="p-name" style="font-size: 18px;">—</strong>
                <span id="p-admin-badge" class="badge ok hidden">Admin</span>
              </div>
              <div class="muted truncate" id="p-email" style="font-size: 13px; margin-top: 2px;">—</div>
              <div class="muted" id="p-hw" style="font-size: 12px; margin-top: 4px; color: var(--accent-2);"></div>
            </div>
          </div>

          <div class="grid-4" style="gap: 10px; margin-bottom: 22px;">
            <div class="item" style="flex-direction: column; align-items: flex-start; gap: 2px;">
              <span class="muted" style="font-size: 11px;">Tổng game</span>
              <strong id="p-total-games" style="font-size: 20px;">0</strong>
            </div>
            <div class="item" style="flex-direction: column; align-items: flex-start; gap: 2px;">
              <span class="muted" style="font-size: 11px;">Phá đảo</span>
              <strong id="p-completed" style="font-size: 20px; color: var(--ok);">0</strong>
            </div>
            <div class="item" style="flex-direction: column; align-items: flex-start; gap: 2px;">
              <span class="muted" style="font-size: 11px;">Đang chơi</span>
              <strong id="p-playing" style="font-size: 20px; color: var(--accent-2);">0</strong>
            </div>
            <div class="item" style="flex-direction: column; align-items: flex-start; gap: 2px;">
              <span class="muted" style="font-size: 11px;">Tổng giờ chơi</span>
              <strong id="p-hours" style="font-size: 20px;">0h</strong>
            </div>
          </div>

          <div style="font-size: 14px; font-weight: 700; margin-bottom: 12px;">Game chơi nhiều nhất</div>
          <div class="list" id="p-games"></div>
        </div>
      </div>
    </div>

    <!-- TAB 2: INTRO / LANDING (Public) -->
    <div id="tab-intro" class="hidden">
      <section class="hero">
        <h2>GameVault — Thư viện game &amp; Theo dõi thời gian chơi</h2>
        <p>Tự động nhận diện game đang chơi trên Windows, ghi nhận chính xác từng phiên chơi, đồng bộ thư viện nhiều máy qua Cloud, chấm điểm, đánh giá và kết nối cộng đồng game thủ.</p>
      </section>

      <section class="grid-3">
        <div class="card">
          <h3>Theo dõi tự động</h3>
          <p class="muted" style="margin:0;">Tự phát hiện game đang chạy, thống kê giờ chơi theo ngày/tháng, FPS và cấu hình phần cứng.</p>
        </div>
        <div class="card">
          <h3>Đồng bộ nhiều máy</h3>
          <p class="muted" style="margin:0;">Lưu trạng thái phá đảo, ghi chú, ảnh bìa và lịch sử phiên chơi an toàn trên Cloudflare.</p>
        </div>
        <div class="card">
          <h3>Cộng đồng &amp; BXH</h3>
          <p class="muted" style="margin:0;">Bảng xếp hạng Top Game, Top Người chơi, đánh giá &amp; chia sẻ khoảnh khắc trong game.</p>
        </div>
      </section>

      <section class="section grid-2">
        <div class="card">
          <h3>Top Game Cộng đồng</h3>
          <div class="list" id="c-games"></div>
        </div>
        <div class="card">
          <h3>Top Người chơi (Giờ chơi)</h3>
          <div class="list" id="c-players"></div>
        </div>
      </section>
    </div>

    <!-- TAB 3: ADMIN SERVER MONITOR (Strict Admin Only) -->
    <div id="tab-admin" class="hidden">
      <div class="row" style="justify-content: space-between; margin-bottom: 14px; flex-wrap: wrap;">
        <span class="pill"><span class="dot" id="health-dot"></span><span id="health-text">Đang kiểm tra server...</span></span>
        <button id="admin-refresh-btn">Làm mới số liệu Server</button>
      </div>

      <div class="grid-4">
        <div class="card">
          <div class="metric-label">D1 Rows Written (24h / Free 100k)</div>
          <div class="metric-val" id="m-written">—</div>
          <div class="bar" id="b-written"><i style="width:0%"></i></div>
          <div class="metric-sub" id="s-written">Đang tải...</div>
        </div>
        <div class="card">
          <div class="metric-label">D1 Rows Read (24h / Free 5M)</div>
          <div class="metric-val" id="m-read">—</div>
          <div class="bar ok" id="b-read"><i style="width:0%"></i></div>
          <div class="metric-sub" id="s-read">Đang tải...</div>
        </div>
        <div class="card">
          <div class="metric-label">D1 Storage (Free 5 GB)</div>
          <div class="metric-val" id="m-size">—</div>
          <div class="bar ok" id="b-size"><i style="width:0%"></i></div>
          <div class="metric-sub" id="s-size">Đang tải...</div>
        </div>
        <div class="card">
          <div class="metric-label">Worker Invocations (24h / Free 100k)</div>
          <div class="metric-val" id="m-req">—</div>
          <div class="bar ok" id="b-req"><i style="width:0%"></i></div>
          <div class="metric-sub" id="s-req">Đang tải...</div>
        </div>
      </div>

      <div id="admin-db-box" class="card section">
        <h3>Thống kê nội bộ GameVault D1</h3>
        <div class="muted" id="admin-db-text">—</div>
      </div>

      <div id="cf-setup-box" class="notice section hidden">
        <strong>Chưa gắn Cloudflare API Token (Read-only):</strong> Để xem trực tiếp số liệu D1 &amp; Worker của tài khoản <code>son623200@gmail.com</code>, hãy tạo 1 API Token quyền đọc (<em>D1:Read + Account Analytics:Read</em>) rồi dán vào đây (chỉ lưu trên trình duyệt Admin) hoặc đặt secret <code>CF_API_TOKEN</code> trên Worker.
        <div class="row" style="margin-top:10px; max-width:580px;">
          <input id="cf-token-input" class="input" type="password" placeholder="Dán Cloudflare API Token (Read-only)..." />
          <button id="cf-token-save" class="btn-primary" style="white-space:nowrap;">Lưu Token</button>
          <button id="cf-token-clear" class="hidden" style="white-space:nowrap;">Xóa</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    const API_URL = ${JSON.stringify(apiUrl)};
    const LS_SESSION = 'gv_dash_session_token';
    const LS_CF_TOKEN = 'gv_dash_cf_token';
    let isAdminUser = false;

    const $ = (id) => document.getElementById(id);
    const fmtNum = (n) => Number(n || 0).toLocaleString('en-US');
    const fmtMb = (bytes) => (Number(bytes || 0) / (1024 * 1024)).toFixed(2) + ' MB';
    const fmtHours = (mins) => (Number(mins || 0) / 60).toFixed(1) + 'h';

    function escapeHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function setBar(barId, pct) {
      const el = $(barId);
      if (!el) return;
      const clamped = Math.max(0, Math.min(100, pct));
      el.firstElementChild.style.width = clamped + '%';
      el.classList.remove('ok', 'warn', 'danger');
      el.classList.add(clamped >= 80 ? 'danger' : clamped >= 50 ? 'warn' : 'ok');
    }

    function switchTab(name) {
      if (name === 'admin' && !isAdminUser) name = 'profile';
      for (const t of ['intro', 'profile', 'admin']) {
        const tabEl = $('tab-' + t);
        if (tabEl) tabEl.classList.toggle('hidden', t !== name);
      }
      document.querySelectorAll('.tab').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === name);
      });
      if (name === 'admin' && isAdminUser) {
        loadAdminServerStatus();
      }
    }

    document.querySelectorAll('.tab').forEach((btn) => {
      btn.onclick = () => switchTab(btn.dataset.tab);
    });

    async function loadPublicCommunity() {
      try {
        const res = await fetch('/api/public-summary');
        const data = await res.json();
        const games = data.topGames || [];
        $('c-games').innerHTML = games.length
          ? games.map((g, i) =>
            '<div class="item">' +
              '<div class="item-left">' +
                '<span class="badge">#' + (i + 1) + '</span>' +
                (g.coverUrl ? '<img class="thumb" src="' + escapeHtml(g.coverUrl.startsWith('/') ? API_URL + g.coverUrl : g.coverUrl) + '" alt="" />' : '') +
                '<div style="min-width:0;">' +
                  '<div class="truncate" style="font-weight:600;font-size:13px;">' + escapeHtml(g.title) + '</div>' +
                  '<div class="muted" style="font-size:11px;">' + fmtHours(g.totalMinutes) + ' · ' + g.players + ' người chơi</div>' +
                '</div>' +
              '</div>' +
              (g.averageScore ? '<span class="badge ok">' + Number(g.averageScore).toFixed(1) + '★</span>' : '') +
            '</div>'
          ).join('')
          : '<div class="muted">Chưa có dữ liệu.</div>';

        const players = data.topPlayers || [];
        $('c-players').innerHTML = players.length
          ? players.map((p, i) =>
            '<div class="item">' +
              '<div class="item-left">' +
                '<span class="badge">#' + (i + 1) + '</span>' +
                '<div style="min-width:0;">' +
                  '<div class="truncate" style="font-weight:600;font-size:13px;">' + escapeHtml(p.nickname) + '</div>' +
                  '<div class="muted" style="font-size:11px;">' + p.completedGames + '/' + p.totalGames + ' phá đảo</div>' +
                '</div>' +
              '</div>' +
              '<strong style="font-size:13px;color:var(--accent-2);">' + fmtHours(p.totalMinutes) + '</strong>' +
            '</div>'
          ).join('')
          : '<div class="muted">Chưa có dữ liệu.</div>';
      } catch {}
    }

    async function loadAdminServerStatus() {
      const token = localStorage.getItem(LS_SESSION);
      if (!token || !isAdminUser) return;
      const cfToken = localStorage.getItem(LS_CF_TOKEN) || '';
      if (cfToken) {
        $('cf-token-input').value = cfToken;
        $('cf-token-clear').classList.remove('hidden');
      } else {
        $('cf-token-clear').classList.add('hidden');
      }

      const headers = { Authorization: 'Bearer ' + token };
      if (cfToken) headers['X-CF-Token'] = cfToken;

      const res = await fetch('/api/status', { headers });
      if (!res.ok) return;
      const data = await res.json();

      if (data.health?.ok) {
        $('health-dot').className = 'dot ok';
        $('health-text').textContent = 'Worker Online · ' + data.health.latencyMs + 'ms';
      } else {
        $('health-dot').className = 'dot bad';
        $('health-text').textContent = 'Worker Lỗi (' + (data.health?.status || 'offline') + ')';
      }

      const cf = data.cloudflare;
      if (!cf?.configured || (!cf.d1 && !cf.worker)) {
        $('cf-setup-box').classList.remove('hidden');
        $('s-written').textContent = cf?.d1Error ? 'Lỗi CF Token: ' + cf.d1Error : 'Chưa cấu hình CF Token';
        $('s-read').textContent = 'Chưa cấu hình CF Token';
        $('s-size').textContent = 'Chưa cấu hình CF Token';
        $('s-req').textContent = 'Chưa cấu hình CF Token';
      } else {
        $('cf-setup-box').classList.add('hidden');
      }

      if (cf?.d1) {
        const d1 = cf.d1;
        $('m-written').textContent = fmtNum(d1.rowsWritten24h);
        setBar('b-written', (d1.rowsWritten24h / 100000) * 100);
        $('s-written').textContent = fmtNum(d1.writeQueries24h) + ' lệnh ghi · ' + ((d1.rowsWritten24h / 100000) * 100).toFixed(1) + '% hạn mức ngày';

        $('m-read').textContent = fmtNum(d1.rowsRead24h);
        setBar('b-read', (d1.rowsRead24h / 5000000) * 100);
        $('s-read').textContent = fmtNum(d1.readQueries24h) + ' lệnh đọc · ' + ((d1.rowsRead24h / 5000000) * 100).toFixed(2) + '% hạn mức ngày';

        $('m-size').textContent = fmtMb(d1.databaseSizeBytes);
        setBar('b-size', (d1.databaseSizeBytes / (5 * 1024 * 1024 * 1024)) * 100);
        $('s-size').textContent = d1.numTables + ' bảng · Region ' + (d1.region || 'APAC');
      }

      if (cf?.worker) {
        const w = cf.worker;
        $('m-req').textContent = fmtNum(w.requests24h);
        setBar('b-req', (w.requests24h / 100000) * 100);
        $('s-req').textContent = w.errors24h + ' lỗi · CPU p50 ' + w.cpuTimeP50Ms + 'ms';
      } else if (cf?.configured && cf?.workerError) {
        $('s-req').textContent = 'Analytics: ' + cf.workerError;
      }

      if (data.admin?.stats) {
        const a = data.admin.stats;
        $('admin-db-text').textContent =
          'Covers: ' + a.totalCovers + ' (Cloud: ' + a.cloudCovers + ', Thiếu: ' + a.missingCovers + ') · User Library rows: ' + a.libraryGamesCount + ' · Reviews: ' + a.reviewsCount + ' · Ảnh lưu trong D1: ' + a.storedImagesCount;
      }
    }

    async function loadUserProfile() {
      const token = localStorage.getItem(LS_SESSION);
      if (!token) {
        isAdminUser = false;
        $('admin-tab-btn').classList.add('hidden');
        $('admin-portal-link').classList.add('hidden');
        $('auth-guest').classList.remove('hidden');
        $('auth-profile').classList.add('hidden');
        $('logout-btn').classList.add('hidden');
        $('topbar-login-btn').classList.remove('hidden');
        $('tab-btn-profile').textContent = 'Đăng nhập / Profile';
        return;
      }

      const headers = { Authorization: 'Bearer ' + token };
      try {
        const [libRes, meRes, adminRes] = await Promise.all([
          fetch(API_URL + '/api/library', { headers }),
          fetch(API_URL + '/api/community/me', { headers }),
          fetch(API_URL + '/api/admin/me', { headers }),
        ]);

        if (libRes.status === 401) {
          localStorage.removeItem(LS_SESSION);
          $('auth-error').textContent = 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.';
          return loadUserProfile();
        }

        const lib = await libRes.json();
        const me = meRes.ok ? await meRes.json() : null;
        const admin = adminRes.ok ? await adminRes.json() : null;
        isAdminUser = Boolean(admin?.isAdmin);

        $('admin-tab-btn').classList.toggle('hidden', !isAdminUser);
        $('admin-portal-link').classList.toggle('hidden', !isAdminUser);
        $('p-admin-badge').classList.toggle('hidden', !isAdminUser);

        $('auth-guest').classList.add('hidden');
        $('auth-profile').classList.remove('hidden');
        $('logout-btn').classList.remove('hidden');
        $('topbar-login-btn').classList.add('hidden');

        const userName = me?.nickname || admin?.user?.displayName || 'GameVault User';
        $('tab-btn-profile').textContent = 'Profile (' + userName + ')';
        $('p-name').textContent = userName;
        $('p-email').textContent = admin?.user?.email || ('UID: ' + (me?.uid || '—'));
        if (me?.avatarUrl) {
          $('p-avatar').src = me.avatarUrl.startsWith('/') ? API_URL + me.avatarUrl : me.avatarUrl;
        } else {
          $('p-avatar').removeAttribute('src');
        }

        if (me?.uid) {
          fetch(API_URL + '/api/users/' + encodeURIComponent(me.uid)).then(r => r.ok ? r.json() : null).then(u => {
            if (u && (u.gpu || u.cpu || u.ramGb)) {
              $('p-hw').textContent = [u.cpu, u.gpu, u.ramGb ? u.ramGb + 'GB RAM' : ''].filter(Boolean).join(' · ');
            }
          }).catch(() => {});
        }

        const st = lib?.stats || {};
        $('p-total-games').textContent = fmtNum(st.total || 0);
        $('p-completed').textContent = fmtNum(st.completed || 0);
        $('p-playing').textContent = fmtNum(st.playing || 0);
        $('p-hours').textContent = fmtHours(st.totalPlaytimeMinutes || 0);

        const topGames = (lib?.games || [])
          .slice()
          .sort((a, b) => (b.playtimeMinutes || 0) - (a.playtimeMinutes || 0))
          .slice(0, 6);

        $('p-games').innerHTML = topGames.length
          ? topGames.map(g =>
            '<div class="item">' +
              '<div class="item-left">' +
                (g.coverUrl ? '<img class="thumb" src="' + escapeHtml(g.coverUrl.startsWith('/') ? API_URL + g.coverUrl : g.coverUrl) + '" alt="" />' : '') +
                '<div style="min-width:0;">' +
                  '<div class="truncate" style="font-weight:600;font-size:13px;">' + escapeHtml(g.title) + '</div>' +
                  '<div class="muted" style="font-size:11px;">' + escapeHtml(g.status || 'Chưa phân loại') + '</div>' +
                '</div>' +
              '</div>' +
              '<strong style="font-size:13px;">' + fmtHours(g.playtimeMinutes) + '</strong>' +
            '</div>'
          ).join('')
          : '<div class="muted">Thư viện trống.</div>';
      } catch (err) {
        $('auth-error').textContent = 'Không tải được profile: ' + (err?.message || 'Lỗi mạng');
      }
    }

    async function initGoogleSignIn() {
      try {
        let clientId = '772752742447-4qhtfeqmelvqd4poeb73kb0teukj7puv.apps.googleusercontent.com';
        try {
          const res = await fetch(API_URL + '/api/admin/config');
          const cfg = await res.json();
          if (cfg?.webGoogleClientId) clientId = cfg.webGoogleClientId;
        } catch {}

        const render = () => {
          if (!window.google?.accounts?.id) return false;
          try {
            window.google.accounts.id.initialize({
              client_id: clientId,
              callback: async (resp) => {
                if (!resp?.credential) return;
                $('auth-error').textContent = 'Đang xác thực tài khoản Google...';
                try {
                  const authRes = await fetch(API_URL + '/api/auth/google', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ idToken: resp.credential }),
                  });
                  const data = await authRes.json();
                  if (!authRes.ok || !data?.token) {
                    $('auth-error').textContent = data?.error || 'Đăng nhập Google thất bại';
                    return;
                  }
                  localStorage.setItem(LS_SESSION, data.token);
                  $('auth-error').textContent = '';
                  await loadUserProfile();
                } catch (err) {
                  $('auth-error').textContent = 'Lỗi kết nối khi xác thực: ' + (err?.message || err);
                }
              },
            });
            window.google.accounts.id.renderButton($('google-btn-wrap'), {
              theme: 'filled_black',
              size: 'large',
              width: 300,
              text: 'signin_with',
              shape: 'pill',
              logo_alignment: 'left',
            });
            return true;
          } catch (e) {
            console.warn('GIS render error:', e);
            return false;
          }
        };

        if (!render()) {
          const t = setInterval(() => { if (render()) clearInterval(t); }, 200);
          setTimeout(() => clearInterval(t), 8000);
        }
      } catch (err) {
        console.error('Google init failed:', err);
      }
    }

    function triggerGoogleLogin() {
      if (window.google?.accounts?.id) {
        try {
          window.google.accounts.id.prompt();
        } catch (e) {
          console.warn('prompt error:', e);
        }
      }
    }

    $('admin-refresh-btn').onclick = () => loadAdminServerStatus();
    $('cf-token-save').onclick = () => {
      const v = $('cf-token-input').value.trim();
      if (v) localStorage.setItem(LS_CF_TOKEN, v);
      loadAdminServerStatus();
    };
    $('cf-token-clear').onclick = () => {
      localStorage.removeItem(LS_CF_TOKEN);
      $('cf-token-input').value = '';
      loadAdminServerStatus();
    };
    $('logout-btn').onclick = () => {
      localStorage.removeItem(LS_SESSION);
      isAdminUser = false;
      loadUserProfile();
      switchTab('profile');
    };

    // Auto-login if token is passed in query string (from PC app 1-click launch)
    const searchParams = new URLSearchParams(window.location.search);
    const urlToken = searchParams.get('token') || searchParams.get('session');
    if (urlToken) {
      localStorage.setItem(LS_SESSION, urlToken);
      window.history.replaceState({}, document.title, window.location.pathname + (window.location.hash || ''));
    }

    // Determine default tab based on query/hash or default to profile (login/account)
    const hash = window.location.hash.toLowerCase();
    let initialTab = 'profile';
    if (searchParams.get('tab') === 'intro' || hash === '#intro') {
      initialTab = 'intro';
    } else if (searchParams.get('tab') === 'admin' || hash === '#admin') {
      initialTab = 'admin';
    }
    switchTab(initialTab);

    loadPublicCommunity();
    loadUserProfile();
    initGoogleSignIn();
  </script>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const apiUrl = (env.GAMEVAULT_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
    const accountId = env.CF_ACCOUNT_ID || DEFAULT_CF_ACCOUNT_ID;
    const d1Id = env.CF_D1_ID || DEFAULT_CF_D1_ID;
    const workerName = env.CF_WORKER_NAME || DEFAULT_CF_WORKER_NAME;

    if (url.pathname === '/api/public-summary') {
      const [gamesRes, playersRes] = await Promise.all([
        fetchJsonWithTiming(`${apiUrl}/api/community/rankings?limit=6`),
        fetchJsonWithTiming(`${apiUrl}/api/community/players?limit=5&sort=hours`),
      ]);
      return json({
        topGames: gamesRes.data?.items || [],
        topPlayers: playersRes.data?.items || [],
      });
    }

    if (url.pathname === '/api/status') {
      const authCheck = await verifyAdminSession(apiUrl, request.headers.get('Authorization') || '');
      if (!authCheck.ok) {
        return json({ error: authCheck.error }, authCheck.status);
      }

      const cfToken = env.CF_API_TOKEN || request.headers.get('X-CF-Token') || '';
      const [health, cf] = await Promise.all([
        fetchJsonWithTiming(`${apiUrl}/api/health`),
        fetchCloudflareMetrics(cfToken, accountId, d1Id, workerName),
      ]);

      return json({
        checkedAt: new Date().toISOString(),
        apiUrl,
        health,
        cloudflare: cf,
        admin: authCheck.admin,
      });
    }

    if (url.pathname === '/privacy' || url.pathname === '/privacy/') {
      return new Response(PRIVACY_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/terms' || url.pathname === '/terms/') {
      return new Response(TERMS_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/dashboard' || url.pathname === '/dashboard/' || url.pathname === '/profile') {
      return new Response(renderHtml(apiUrl), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return new Response(HOME_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
};
