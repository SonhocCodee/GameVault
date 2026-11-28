const HOME_HTML = "<!DOCTYPE html>\n<html lang=\"vi\" class=\"scroll-smooth\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>GameVault - Thư viện Game & Theo dõi Giờ chơi</title>\n  <meta name=\"description\" content=\"GameVault giúp bạn tự động đếm giờ chơi, quản lý thư viện game, vẽ dòng thời gian phá đảo và kết nối cộng đồng game thủ.\">\n  <script src=\"https://cdn.tailwindcss.com\"></script>\n  <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n  <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n  <link href=\"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap\" rel=\"stylesheet\">\n  <style>\n    :root {\n      --gv-bg: #0c0e13;\n      --gv-surface: #13161f;\n      --gv-surface-2: #191d28;\n      --gv-accent: #ff2a44;\n      --gv-accent-hover: #e11d48;\n    }\n    body {\n      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;\n      background-color: var(--gv-bg);\n      color: #f1f3f7;\n    }\n    .gv-glow {\n      background: radial-gradient(ellipse 75% 45% at 50% 0%, rgba(255, 42, 68, 0.16) 0%, rgba(14, 165, 233, 0.06) 45%, rgba(12, 14, 19, 0) 75%);\n    }\n    .gv-card {\n      background-color: var(--gv-surface);\n      border: 1px solid rgba(255, 255, 255, 0.08);\n    }\n    .gv-card:hover {\n      border-color: rgba(255, 42, 68, 0.4);\n    }\n  </style>\n</head>\n<body class=\"min-h-screen flex flex-col antialiased selection:bg-[#ff2a44]/40 selection:text-white\">\n\n  <!-- Header -->\n  <header class=\"border-b border-white/[0.08] bg-[#0c0e13]/85 backdrop-blur-md sticky top-0 z-50\">\n    <div class=\"max-w-6xl mx-auto px-5 h-16 flex items-center justify-between gap-4\">\n      <a href=\"/\" class=\"flex items-center gap-3 group shrink-0\">\n        <div class=\"w-9 h-9 rounded-xl bg-gradient-to-br from-[#ff2a44] to-[#be123c] flex items-center justify-center font-black text-sm text-white shadow-lg shadow-[#ff2a44]/30\">\n          GV\n        </div>\n        <div>\n          <div class=\"flex items-center gap-1.5\">\n            <span class=\"font-extrabold text-base tracking-wide text-white\">GAMEVAULT</span>\n            <span class=\"text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#ff2a44]/15 text-[#ff5c70] border border-[#ff2a44]/35\">PRO</span>\n          </div>\n          <div class=\"text-[11px] text-slate-400 hidden sm:block\">Permanent Playtime &amp; Media</div>\n        </div>\n      </a>\n\n      <nav class=\"hidden md:flex items-center gap-6 text-sm font-semibold text-slate-400\">\n        <a href=\"#features\" class=\"hover:text-white transition-colors\" data-i18n=\"navFeatures\">Tính năng</a>\n        <a href=\"#screenshots\" class=\"hover:text-white transition-colors\" data-i18n=\"navScreenshots\">Giao diện</a>\n        <a href=\"/privacy\" class=\"hover:text-white transition-colors\" data-i18n=\"navPrivacy\">Bảo mật</a>\n        <a href=\"/terms\" class=\"hover:text-white transition-colors\" data-i18n=\"navTerms\">Điều khoản</a>\n      </nav>\n\n      <div class=\"flex items-center gap-2.5\">\n        <div class=\"inline-flex bg-[#13161f] border border-white/[0.08] rounded-lg p-0.5\" role=\"group\" aria-label=\"Language\">\n          <button type=\"button\" id=\"btn-lang-vi\" onclick=\"setLang('vi')\" class=\"px-2.5 py-1 rounded-md text-xs font-bold transition-all bg-[#191d28] text-white shadow-sm\">\n            VI\n          </button>\n          <button type=\"button\" id=\"btn-lang-en\" onclick=\"setLang('en')\" class=\"px-2.5 py-1 rounded-md text-xs font-bold transition-all text-slate-400 hover:text-white\">\n            EN\n          </button>\n        </div>\n\n        <a href=\"/dashboard?tab=profile\" class=\"hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-white/10 bg-[#191d28] hover:bg-[#222736] text-slate-200 text-xs font-semibold transition-all\">\n          <span data-i18n=\"navLogin\">Đăng nhập / Hồ sơ</span>\n        </a>\n\n        <a href=\"#download\" class=\"inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#ff2a44] hover:bg-[#e11d48] text-white font-bold text-xs sm:text-sm transition-all shadow-lg shadow-[#ff2a44]/30\">\n          <svg class=\"w-4 h-4 shrink-0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" viewBox=\"0 0 24 24\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"></path><polyline points=\"7 10 12 15 17 10\"></polyline><line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"></line></svg>\n          <span data-i18n=\"navDownload\">Tải về</span>\n        </a>\n      </div>\n    </div>\n  </header>\n\n  <main class=\"flex-1 gv-glow\">\n    <!-- Hero Section -->\n    <section class=\"max-w-6xl mx-auto px-5 pt-14 pb-12 lg:pt-20 lg:pb-16\">\n      <div class=\"grid grid-cols-1 lg:grid-cols-12 gap-10 items-center\">\n        <div class=\"lg:col-span-6\">\n          <div class=\"inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#ff2a44]/30 bg-[#ff2a44]/10 text-[#ff6b7d] text-xs font-bold mb-5\">\n            <span class=\"w-2 h-2 rounded-full bg-emerald-400 animate-pulse\"></span>\n            <span data-i18n=\"heroBadge\">GameVault Desktop cho Windows</span>\n          </div>\n\n          <h1 class=\"text-3xl sm:text-5xl font-extrabold tracking-tight text-white mb-5 leading-[1.15]\">\n            <span data-i18n=\"heroTitle1\">Lưu giữ trọn vẹn</span><br>\n            <span class=\"bg-gradient-to-r from-[#ff2a44] via-[#fb7185] to-[#fda4af] bg-clip-text text-transparent\" data-i18n=\"heroTitle2\">\n              hành trình chơi game của bạn\n            </span>\n          </h1>\n\n          <p class=\"text-slate-400 text-base leading-relaxed mb-7 max-w-xl\" data-i18n=\"heroDesc\">\n            Tự động đếm giờ chơi chính xác, quản lý thư viện đa nền tảng, vẽ dòng thời gian phá đảo và kết nối cùng cộng đồng game thủ.\n          </p>\n\n          <div class=\"flex flex-wrap items-center gap-3 mb-7\">\n            <a href=\"#download\" class=\"px-6 py-3 rounded-xl bg-[#ff2a44] hover:bg-[#e11d48] text-white font-bold text-sm transition-all shadow-lg shadow-[#ff2a44]/30 flex items-center gap-2\">\n              <svg class=\"w-4 h-4 shrink-0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" viewBox=\"0 0 24 24\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"></path><polyline points=\"7 10 12 15 17 10\"></polyline><line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"></line></svg>\n              <span data-i18n=\"heroDownload\">Tải GameVault cho Windows</span>\n            </a>\n            <a href=\"#screenshots\" class=\"px-5 py-3 rounded-xl bg-[#191d28] hover:bg-[#222736] border border-white/10 text-slate-200 font-semibold text-sm transition-all\" data-i18n=\"heroPreviewBtn\">\n              Xem giao diện App\n            </a>\n          </div>\n\n          <div class=\"flex flex-wrap items-center gap-5 text-xs text-slate-400\">\n            <div class=\"flex items-center gap-2\">\n              <span class=\"w-1.5 h-1.5 rounded-full bg-[#ff2a44]\"></span>\n              <span data-i18n=\"stat1\">Tự động đếm giờ chơi</span>\n            </div>\n            <div class=\"flex items-center gap-2\">\n              <span class=\"w-1.5 h-1.5 rounded-full bg-emerald-400\"></span>\n              <span data-i18n=\"stat2\">Dòng thời gian phá đảo</span>\n            </div>\n            <div class=\"flex items-center gap-2\">\n              <span class=\"w-1.5 h-1.5 rounded-full bg-sky-400\"></span>\n              <span data-i18n=\"stat3\">Đồng bộ đám mây</span>\n            </div>\n          </div>\n        </div>\n\n        <div class=\"lg:col-span-6\">\n          <button type=\"button\" onclick=\"openLightbox('https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/library.jpg', currentLang === 'vi' ? 'Thư viện & Game chơi gần đây' : 'Library & Recent Games')\" class=\"block w-full text-left rounded-2xl overflow-hidden border border-white/15 bg-[#13161f] shadow-2xl shadow-black/60 hover:border-[#ff2a44]/50 transition-all group\">\n            <img src=\"https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/library.jpg\" alt=\"GameVault Desktop Library\" class=\"w-full h-auto block group-hover:scale-[1.01] transition-transform duration-300\">\n          </button>\n        </div>\n      </div>\n    </section>\n\n    <!-- Features Grid -->\n    <section id=\"features\" class=\"max-w-6xl mx-auto px-5 py-12 border-t border-white/[0.06] scroll-mt-16\">\n      <div class=\"mb-10\">\n        <h2 class=\"text-2xl sm:text-3xl font-extrabold text-white mb-2\" data-i18n=\"featuresTitle\">Mọi thứ bạn cần trong một ứng dụng</h2>\n        <p class=\"text-slate-400 text-sm\" data-i18n=\"featuresSub\">Thiết kế tối ưu cho game thủ PC: nhẹ, đẹp, không quảng cáo và đồng bộ tức thì.</p>\n      </div>\n\n      <div class=\"grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4\">\n        <div class=\"p-5 rounded-2xl gv-card transition-all\">\n          <span class=\"inline-block text-[11px] font-bold px-2.5 py-1 rounded-md bg-[#ff2a44]/15 text-[#ff6b7d] mb-3\">Tracker</span>\n          <h3 class=\"text-base font-bold text-white mb-1.5\" data-i18n=\"f1Title\">Theo dõi giờ chơi tự động</h3>\n          <p class=\"text-slate-400 text-xs sm:text-sm leading-relaxed\" data-i18n=\"f1Desc\">\n            Tự động nhận diện game đang chạy trên Windows và ghi nhận từng phút chơi thực tế.\n          </p>\n        </div>\n\n        <div class=\"p-5 rounded-2xl gv-card transition-all\">\n          <span class=\"inline-block text-[11px] font-bold px-2.5 py-1 rounded-md bg-amber-500/15 text-amber-400 mb-3\">Timeline</span>\n          <h3 class=\"text-base font-bold text-white mb-1.5\" data-i18n=\"f2Title\">Dòng thời gian phá đảo</h3>\n          <p class=\"text-slate-400 text-xs sm:text-sm leading-relaxed\" data-i18n=\"f2Desc\">\n            Nhìn lại những tựa game đã chinh phục theo từng tháng, từng năm kèm điểm đánh giá.\n          </p>\n        </div>\n\n        <div class=\"p-5 rounded-2xl gv-card transition-all\">\n          <span class=\"inline-block text-[11px] font-bold px-2.5 py-1 rounded-md bg-emerald-500/15 text-emerald-400 mb-3\">Library</span>\n          <h3 class=\"text-base font-bold text-white mb-1.5\" data-i18n=\"f3Title\">Thư viện &amp; Trạng thái</h3>\n          <p class=\"text-slate-400 text-xs sm:text-sm leading-relaxed\" data-i18n=\"f3Desc\">\n            Phân loại Đang chơi, Đã phá đảo, Chờ chơi, Tạm dừng hay Bỏ dở cực kỳ trực quan.\n          </p>\n        </div>\n\n        <div class=\"p-5 rounded-2xl gv-card transition-all\">\n          <span class=\"inline-block text-[11px] font-bold px-2.5 py-1 rounded-md bg-sky-500/15 text-sky-400 mb-3\">Community</span>\n          <h3 class=\"text-base font-bold text-white mb-1.5\" data-i18n=\"f4Title\">Cộng đồng &amp; Bảng xếp hạng</h3>\n          <p class=\"text-slate-400 text-xs sm:text-sm leading-relaxed\" data-i18n=\"f4Desc\">\n            Chia sẻ khoảnh khắc, viết cảm nhận và so tài giờ chơi thực tế với mọi người.\n          </p>\n        </div>\n      </div>\n    </section>\n\n    <!-- App Screenshots Showcase -->\n    <section id=\"screenshots\" class=\"max-w-6xl mx-auto px-5 py-12 border-t border-white/[0.06] scroll-mt-16\">\n      <div class=\"mb-10\">\n        <h2 class=\"text-2xl sm:text-3xl font-extrabold text-white mb-2\" data-i18n=\"shotsTitle\">Trải nghiệm thực tế trên GameVault</h2>\n        <p class=\"text-slate-400 text-sm\" data-i18n=\"shotsSub\">Nhấn vào từng ảnh để phóng to và xem chi tiết giao diện ứng dụng Desktop.</p>\n      </div>\n\n      <div class=\"grid grid-cols-1 md:grid-cols-2 gap-5\">\n        <button type=\"button\" onclick=\"openLightbox('https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/library.jpg', currentLang === 'vi' ? 'Thư viện & Game chơi gần đây' : 'Library & Recent Games')\" class=\"text-left rounded-2xl gv-card overflow-hidden transition-all group\">\n          <div class=\"aspect-video overflow-hidden bg-[#090b10] border-b border-white/[0.08]\">\n            <img src=\"https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/library.jpg\" alt=\"Library\" loading=\"lazy\" class=\"w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300\">\n          </div>\n          <div class=\"p-4\">\n            <h3 class=\"text-sm sm:text-base font-bold text-white mb-1\" data-i18n=\"s1Title\">Thư viện &amp; Game chơi gần đây</h3>\n            <p class=\"text-xs sm:text-sm text-slate-400\" data-i18n=\"s1Desc\">Quản lý toàn bộ game với trạng thái, điểm đánh giá sao và tổng thời gian chơi.</p>\n          </div>\n        </button>\n\n        <button type=\"button\" onclick=\"openLightbox('https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/timeline.jpg', currentLang === 'vi' ? 'Dòng thời gian phá đảo' : 'Completion Timeline')\" class=\"text-left rounded-2xl gv-card overflow-hidden transition-all group\">\n          <div class=\"aspect-video overflow-hidden bg-[#090b10] border-b border-white/[0.08]\">\n            <img src=\"https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/timeline.jpg\" alt=\"Timeline\" loading=\"lazy\" class=\"w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300\">\n          </div>\n          <div class=\"p-4\">\n            <h3 class=\"text-sm sm:text-base font-bold text-white mb-1\" data-i18n=\"s2Title\">Dòng thời gian phá đảo</h3>\n            <p class=\"text-xs sm:text-sm text-slate-400\" data-i18n=\"s2Desc\">Lưu dấu cột mốc phá đảo theo từng tháng/năm cùng tổng thời lượng.</p>\n          </div>\n        </button>\n\n        <button type=\"button\" onclick=\"openLightbox('https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/community.jpg', currentLang === 'vi' ? 'Bảng tin Cộng đồng' : 'Community Feed')\" class=\"text-left rounded-2xl gv-card overflow-hidden transition-all group\">\n          <div class=\"aspect-video overflow-hidden bg-[#090b10] border-b border-white/[0.08]\">\n            <img src=\"https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/community.jpg\" alt=\"Community\" loading=\"lazy\" class=\"w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300\">\n          </div>\n          <div class=\"p-4\">\n            <h3 class=\"text-sm sm:text-base font-bold text-white mb-1\" data-i18n=\"s3Title\">Bảng tin Cộng đồng</h3>\n            <p class=\"text-xs sm:text-sm text-slate-400\" data-i18n=\"s3Desc\">Đăng ảnh game, chia sẻ cảm nhận, hỏi đáp và khoe thành tích vừa phá đảo.</p>\n          </div>\n        </button>\n\n        <button type=\"button\" onclick=\"openLightbox('https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/leaderboard.jpg', currentLang === 'vi' ? 'Top người chơi GameVault' : 'Top Players Leaderboard')\" class=\"text-left rounded-2xl gv-card overflow-hidden transition-all group\">\n          <div class=\"aspect-video overflow-hidden bg-[#090b10] border-b border-white/[0.08]\">\n            <img src=\"https://game-vault-worker.gamevault-son.workers.dev/community/screenshots/leaderboard.jpg\" alt=\"Leaderboard\" loading=\"lazy\" class=\"w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300\">\n          </div>\n          <div class=\"p-4\">\n            <h3 class=\"text-sm sm:text-base font-bold text-white mb-1\" data-i18n=\"s4Title\">Top người chơi GameVault</h3>\n            <p class=\"text-xs sm:text-sm text-slate-400\" data-i18n=\"s4Desc\">Xếp hạng minh bạch dựa trên số game phá đảo và giờ chơi app ghi nhận.</p>\n          </div>\n        </button>\n      </div>\n    </section>\n\n    <!-- Download Section -->\n    <section id=\"download\" class=\"max-w-4xl mx-auto px-5 py-14 scroll-mt-16\">\n      <div class=\"p-8 sm:p-12 rounded-3xl bg-gradient-to-b from-[#161923] to-[#13161f] border border-[#ff2a44]/30 text-center relative overflow-hidden shadow-2xl\">\n        <div class=\"inline-block px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-bold mb-4\" data-i18n=\"dlBadge\">\n          Phiên bản mới nhất v1.0.0\n        </div>\n        <h2 class=\"text-2xl sm:text-3xl font-extrabold text-white mb-3\" data-i18n=\"dlTitle\">Tải xuống GameVault Desktop</h2>\n        <p class=\"text-slate-400 text-sm sm:text-base max-w-xl mx-auto mb-8\" data-i18n=\"dlDesc\">\n          Hỗ trợ Windows 10 &amp; 11 (64-bit). Miễn phí, gọn nhẹ, không quảng cáo.\n        </p>\n\n        <div class=\"flex flex-col sm:flex-row items-center justify-center gap-3\">\n          <a href=\"/downloads/GameVault-Web-Setup-1.0.0.exe\" download=\"GameVault-Web-Setup-1.0.0.exe\" class=\"w-full sm:w-auto px-8 py-3.5 rounded-xl bg-[#ff2a44] hover:bg-[#e11d48] text-white font-bold text-sm transition-all shadow-lg shadow-[#ff2a44]/30 flex items-center justify-center gap-2\">\n            <svg class=\"w-5 h-5 shrink-0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" viewBox=\"0 0 24 24\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"></path><polyline points=\"7 10 12 15 17 10\"></polyline><line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"></line></svg>\n            <span data-i18n=\"dlBtn\">Tải bản cài đặt (.exe)</span>\n          </a>\n          <a href=\"/dashboard?tab=profile\" class=\"w-full sm:w-auto px-6 py-3.5 rounded-xl bg-[#191d28] hover:bg-[#222736] border border-white/10 text-slate-200 font-semibold text-sm transition-all\" data-i18n=\"dlProfile\">\n            Đăng nhập / Hồ sơ\n          </a>\n        </div>\n      </div>\n    </section>\n\n    <!-- Support / Contact Section -->\n    <section class=\"max-w-4xl mx-auto px-5 pb-16\">\n      <div class=\"p-6 sm:p-8 rounded-2xl gv-card flex flex-col sm:flex-row items-center justify-between gap-5\">\n        <div>\n          <h3 class=\"text-base sm:text-lg font-bold text-white mb-1\" data-i18n=\"supportTitle\">Cần hỗ trợ hoặc yêu cầu xóa dữ liệu?</h3>\n          <p class=\"text-slate-400 text-xs sm:text-sm\" data-i18n=\"supportDesc\">Gửi email cho chúng tôi để được hỗ trợ nhanh nhất trong vòng 24 giờ.</p>\n        </div>\n        <a href=\"mailto:son62320@gmail.com\" class=\"shrink-0 px-5 py-2.5 rounded-xl bg-[#191d28] hover:bg-[#222736] border border-white/10 text-[#ff6b7d] font-semibold text-sm transition-all\">\n          son62320@gmail.com\n        </a>\n      </div>\n    </section>\n  </main>\n\n  <!-- Lightbox Modal -->\n  <div id=\"lightbox\" class=\"fixed inset-0 z-[100] hidden bg-black/85 backdrop-blur-sm items-center justify-center p-4\" onclick=\"closeLightbox()\">\n    <div class=\"max-w-5xl w-full rounded-2xl bg-[#13161f] border border-white/15 overflow-hidden shadow-2xl\" onclick=\"event.stopPropagation()\">\n      <div class=\"flex items-center justify-between px-4 py-3 border-b border-white/10\">\n        <strong id=\"lightbox-title\" class=\"text-sm sm:text-base text-white\"></strong>\n        <button type=\"button\" onclick=\"closeLightbox()\" class=\"px-3 py-1.5 rounded-lg bg-[#191d28] hover:bg-[#222736] border border-white/10 text-xs font-semibold text-slate-200\" data-i18n=\"closeBtn\">Đóng</button>\n      </div>\n      <img id=\"lightbox-img\" src=\"\" alt=\"\" class=\"w-full max-h-[78vh] object-contain bg-[#080a0e]\">\n    </div>\n  </div>\n\n  <!-- Footer -->\n  <footer class=\"border-t border-white/[0.06] bg-[#0c0e13] py-8 text-slate-500 text-xs sm:text-sm\">\n    <div class=\"max-w-6xl mx-auto px-5 flex flex-col sm:flex-row items-center justify-between gap-4\">\n      <div data-i18n=\"footerCopy\">© 2026 GameVault. Lưu giữ kỷ niệm &amp; thời gian chơi game bền vững.</div>\n      <div class=\"flex flex-wrap items-center gap-5\">\n        <a href=\"#features\" class=\"hover:text-slate-300 transition-colors\" data-i18n=\"navFeatures\">Tính năng</a>\n        <a href=\"#screenshots\" class=\"hover:text-slate-300 transition-colors\" data-i18n=\"navScreenshots\">Giao diện</a>\n        <a href=\"/privacy\" class=\"hover:text-slate-300 transition-colors\" data-i18n=\"navPrivacy\">Bảo mật</a>\n        <a href=\"/terms\" class=\"hover:text-slate-300 transition-colors\" data-i18n=\"navTerms\">Điều khoản</a>\n        <a href=\"mailto:son62320@gmail.com\" class=\"hover:text-slate-300 transition-colors\" data-i18n=\"footerContact\">Liên hệ</a>\n      </div>\n    </div>\n  </footer>\n\n  <script>\n    const i18n = {\n      vi: {\n        navFeatures: 'Tính năng',\n        navScreenshots: 'Giao diện',\n        navPrivacy: 'Bảo mật',\n        navTerms: 'Điều khoản',\n        navLogin: 'Đăng nhập / Hồ sơ',\n        navDownload: 'Tải về',\n        heroBadge: 'GameVault Desktop cho Windows',\n        heroTitle1: 'Lưu giữ trọn vẹn',\n        heroTitle2: 'hành trình chơi game của bạn',\n        heroDesc: 'Tự động đếm giờ chơi chính xác, quản lý thư viện đa nền tảng, vẽ dòng thời gian phá đảo và kết nối cùng cộng đồng game thủ.',\n        heroDownload: 'Tải GameVault cho Windows',\n        heroPreviewBtn: 'Xem giao diện App',\n        stat1: 'Tự động đếm giờ chơi',\n        stat2: 'Dòng thời gian phá đảo',\n        stat3: 'Đồng bộ đám mây',\n        featuresTitle: 'Mọi thứ bạn cần trong một ứng dụng',\n        featuresSub: 'Thiết kế tối ưu cho game thủ PC: nhẹ, đẹp, không quảng cáo và đồng bộ tức thì.',\n        f1Title: 'Theo dõi giờ chơi tự động',\n        f1Desc: 'Tự động nhận diện game đang chạy trên Windows và ghi nhận từng phút chơi thực tế.',\n        f2Title: 'Dòng thời gian phá đảo',\n        f2Desc: 'Nhìn lại những tựa game đã chinh phục theo từng tháng, từng năm kèm điểm đánh giá.',\n        f3Title: 'Thư viện & Trạng thái',\n        f3Desc: 'Phân loại Đang chơi, Đã phá đảo, Chờ chơi, Tạm dừng hay Bỏ dở cực kỳ trực quan.',\n        f4Title: 'Cộng đồng & Bảng xếp hạng',\n        f4Desc: 'Chia sẻ khoảnh khắc, viết cảm nhận và so tài giờ chơi thực tế với mọi người.',\n        shotsTitle: 'Trải nghiệm thực tế trên GameVault',\n        shotsSub: 'Nhấn vào từng ảnh để phóng to và xem chi tiết giao diện ứng dụng Desktop.',\n        s1Title: 'Thư viện & Game chơi gần đây',\n        s1Desc: 'Quản lý toàn bộ game với trạng thái, điểm đánh giá sao và tổng thời gian chơi.',\n        s2Title: 'Dòng thời gian phá đảo',\n        s2Desc: 'Lưu dấu cột mốc phá đảo theo từng tháng/năm cùng tổng thời lượng.',\n        s3Title: 'Bảng tin Cộng đồng',\n        s3Desc: 'Đăng ảnh game, chia sẻ cảm nhận, hỏi đáp và khoe thành tích vừa phá đảo.',\n        s4Title: 'Top người chơi GameVault',\n        s4Desc: 'Xếp hạng minh bạch dựa trên số game phá đảo và giờ chơi app ghi nhận.',\n        dlBadge: 'Phiên bản mới nhất v1.0.0',\n        dlTitle: 'Tải xuống GameVault Desktop',\n        dlDesc: 'Hỗ trợ Windows 10 & 11 (64-bit). Miễn phí, gọn nhẹ, không quảng cáo.',\n        dlBtn: 'Tải bản cài đặt (.exe)',\n        dlProfile: 'Đăng nhập / Hồ sơ',\n        supportTitle: 'Cần hỗ trợ hoặc yêu cầu xóa dữ liệu?',\n        supportDesc: 'Gửi email cho chúng tôi để được hỗ trợ nhanh nhất trong vòng 24 giờ.',\n        closeBtn: 'Đóng',\n        footerCopy: '© 2026 GameVault. Lưu giữ kỷ niệm & thời gian chơi game bền vững.',\n        footerContact: 'Liên hệ'\n      },\n      en: {\n        navFeatures: 'Features',\n        navScreenshots: 'Screenshots',\n        navPrivacy: 'Privacy Policy',\n        navTerms: 'Terms of Service',\n        navLogin: 'Sign in / Profile',\n        navDownload: 'Download',\n        heroBadge: 'GameVault Desktop for Windows',\n        heroTitle1: 'Preserve every moment',\n        heroTitle2: 'of your gaming journey',\n        heroDesc: 'Automatically track real playtime, organize your multi-platform library, visualize your completion timeline, and connect with fellow gamers.',\n        heroDownload: 'Download GameVault for Windows',\n        heroPreviewBtn: 'View App Screenshots',\n        stat1: 'Auto playtime tracking',\n        stat2: 'Completion timeline',\n        stat3: 'Cloud sync & backup',\n        featuresTitle: 'Everything you need in one place',\n        featuresSub: 'Built for PC gamers: fast, clean, ad-free, and seamlessly synced.',\n        f1Title: 'Auto Playtime Tracker',\n        f1Desc: 'Detects running games on Windows and records every minute of real gameplay.',\n        f2Title: 'Completion Timeline',\n        f2Desc: 'Relive every game you finished by month and year with your personal ratings.',\n        f3Title: 'Smart Game Library',\n        f3Desc: 'Organize games by Playing, Completed, Backlog, On Hold, or Dropped effortlessly.',\n        f4Title: 'Community & Leaderboard',\n        f4Desc: 'Share screenshots, write reviews, and compare verified playtime with others.',\n        shotsTitle: 'Inside GameVault Desktop',\n        shotsSub: 'Click any screenshot to inspect the full desktop interface.',\n        s1Title: 'Library & Recent Games',\n        s1Desc: 'Manage your entire collection with status badges, star ratings, and playtime.',\n        s2Title: 'Completion Timeline',\n        s2Desc: 'Track your finished games month by month with total hours played.',\n        s3Title: 'Community Feed',\n        s3Desc: 'Post screenshots, share reviews, ask questions, and celebrate completions.',\n        s4Title: 'Top Players Leaderboard',\n        s4Desc: 'Fair rankings based on completed games and verified app playtime.',\n        dlBadge: 'Latest Release v1.0.0',\n        dlTitle: 'Download GameVault Desktop',\n        dlDesc: 'Compatible with Windows 10 & 11 (64-bit). Free, lightweight, and ad-free.',\n        dlBtn: 'Download Installer (.exe)',\n        dlProfile: 'Sign in / Profile',\n        supportTitle: 'Need help or want to request data deletion?',\n        supportDesc: 'Send us an email and our team will assist you within 24 hours.',\n        closeBtn: 'Close',\n        footerCopy: '© 2026 GameVault. Permanent Playtime & Gaming Memories.',\n        footerContact: 'Contact'\n      }\n    };\n\n    let currentLang = localStorage.getItem('gamevault.web.lang') === 'en' ? 'en' : 'vi';\n\n    function setLang(lang) {\n      currentLang = lang;\n      localStorage.setItem('gamevault.web.lang', lang);\n      document.documentElement.lang = lang;\n      const dict = i18n[lang];\n      document.querySelectorAll('[data-i18n]').forEach((el) => {\n        const key = el.getAttribute('data-i18n');\n        if (dict[key]) el.textContent = dict[key];\n      });\n      const viBtn = document.getElementById('btn-lang-vi');\n      const enBtn = document.getElementById('btn-lang-en');\n      if (lang === 'vi') {\n        viBtn.className = 'px-2.5 py-1 rounded-md text-xs font-bold transition-all bg-[#191d28] text-white shadow-sm';\n        enBtn.className = 'px-2.5 py-1 rounded-md text-xs font-bold transition-all text-slate-400 hover:text-white';\n      } else {\n        enBtn.className = 'px-2.5 py-1 rounded-md text-xs font-bold transition-all bg-[#191d28] text-white shadow-sm';\n        viBtn.className = 'px-2.5 py-1 rounded-md text-xs font-bold transition-all text-slate-400 hover:text-white';\n      }\n    }\n\n    function openLightbox(src, title) {\n      const box = document.getElementById('lightbox');\n      document.getElementById('lightbox-img').src = src;\n      document.getElementById('lightbox-title').textContent = title;\n      box.classList.remove('hidden');\n      box.classList.add('flex');\n    }\n\n    function closeLightbox() {\n      const box = document.getElementById('lightbox');\n      box.classList.add('hidden');\n      box.classList.remove('flex');\n    }\n\n    setLang(currentLang);\n  </script>\n</body>\n</html>\n";
const PRIVACY_HTML = "<!DOCTYPE html>\n<html lang=\"vi\" class=\"scroll-smooth\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>Chính sách bảo mật - GameVault</title>\n  <meta name=\"description\" content=\"Privacy Policy for GameVault application and gametracking.id.vn services.\">\n  <script src=\"https://cdn.tailwindcss.com\"></script>\n  <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n  <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n  <link href=\"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap\" rel=\"stylesheet\">\n  <style>\n    :root {\n      --gv-bg: #0c0e13;\n      --gv-surface: #13161f;\n      --gv-surface-2: #191d28;\n      --gv-accent: #ff2a44;\n      --gv-accent-hover: #e11d48;\n    }\n    body {\n      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;\n      background-color: var(--gv-bg);\n      color: #f1f3f7;\n    }\n    .gv-glow {\n      background: radial-gradient(ellipse 75% 45% at 50% 0%, rgba(255, 42, 68, 0.16) 0%, rgba(14, 165, 233, 0.06) 45%, rgba(12, 14, 19, 0) 75%);\n    }\n    .gv-card {\n      background-color: var(--gv-surface);\n      border: 1px solid rgba(255, 255, 255, 0.08);\n    }\n  </style>\n</head>\n<body class=\"min-h-screen flex flex-col antialiased selection:bg-[#ff2a44]/40 selection:text-white\">\n\n  <!-- Header -->\n  <header class=\"border-b border-white/[0.08] bg-[#0c0e13]/85 backdrop-blur-md sticky top-0 z-50\">\n    <div class=\"max-w-6xl mx-auto px-5 h-16 flex items-center justify-between gap-4\">\n      <a href=\"/\" class=\"flex items-center gap-3 group shrink-0\">\n        <div class=\"w-9 h-9 rounded-xl bg-gradient-to-br from-[#ff2a44] to-[#be123c] flex items-center justify-center font-black text-sm text-white shadow-lg shadow-[#ff2a44]/30\">\n          GV\n        </div>\n        <div>\n          <div class=\"flex items-center gap-1.5\">\n            <span class=\"font-extrabold text-base tracking-wide text-white\">GAMEVAULT</span>\n            <span class=\"text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#ff2a44]/15 text-[#ff5c70] border border-[#ff2a44]/35\">PRO</span>\n          </div>\n          <div class=\"text-[11px] text-slate-400 hidden sm:block\">Permanent Playtime &amp; Media</div>\n        </div>\n      </a>\n\n      <nav class=\"hidden md:flex items-center gap-6 text-sm font-semibold text-slate-400\">\n        <a href=\"/\" class=\"hover:text-white transition-colors\" data-i18n=\"navHome\">Trang chủ</a>\n        <a href=\"/privacy\" class=\"text-white transition-colors\" data-i18n=\"navPrivacy\">Bảo mật</a>\n        <a href=\"/terms\" class=\"hover:text-white transition-colors\" data-i18n=\"navTerms\">Điều khoản</a>\n      </nav>\n\n      <div class=\"flex items-center gap-2.5\">\n        <div class=\"inline-flex bg-[#13161f] border border-white/[0.08] rounded-lg p-0.5\" role=\"group\" aria-label=\"Language\">\n          <button type=\"button\" id=\"btn-lang-vi\" onclick=\"setLang('vi')\" class=\"px-2.5 py-1 rounded-md text-xs font-bold transition-all bg-[#191d28] text-white shadow-sm\">\n            VI\n          </button>\n          <button type=\"button\" id=\"btn-lang-en\" onclick=\"setLang('en')\" class=\"px-2.5 py-1 rounded-md text-xs font-bold transition-all text-slate-400 hover:text-white\">\n            EN\n          </button>\n        </div>\n\n        <a href=\"/dashboard?tab=profile\" class=\"hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-white/10 bg-[#191d28] hover:bg-[#222736] text-slate-200 text-xs font-semibold transition-all\">\n          <span data-i18n=\"navLogin\">Đăng nhập / Hồ sơ</span>\n        </a>\n        <a href=\"/#download\" class=\"inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#ff2a44] hover:bg-[#e11d48] text-white font-bold text-xs sm:text-sm transition-all shadow-lg shadow-[#ff2a44]/30\">\n          <svg class=\"w-4 h-4 shrink-0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" viewBox=\"0 0 24 24\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"></path><polyline points=\"7 10 12 15 17 10\"></polyline><line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"></line></svg>\n          <span data-i18n=\"navDownload\">Tải về</span>\n        </a>\n      </div>\n    </div>\n  </header>\n\n  <main class=\"flex-1 gv-glow\">\n    <div class=\"max-w-4xl mx-auto px-5 py-12\">\n      <div class=\"mb-6\">\n        <a href=\"/\" onclick=\"if (window.history.length > 1) { window.history.back(); return false; }\" class=\"inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#191d28] hover:bg-[#222736] text-slate-200 text-xs sm:text-sm font-semibold border border-white/10 transition-all\">\n          <svg class=\"w-4 h-4 inline-block text-[#ff6b7d]\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" viewBox=\"0 0 24 24\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M10 19l-7-7m0 0l7-7m-7 7h18\"/></svg>\n          <span data-i18n=\"backPrev\">Quay lại trang trước</span>\n        </a>\n      </div>\n\n      <div class=\"mb-10 pb-6 border-b border-white/[0.08]\">\n        <div class=\"inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#ff2a44]/10 border border-[#ff2a44]/30 text-[#ff6b7d] text-xs font-bold mb-3\" data-i18n=\"docBadge\">\n          Tài liệu pháp lý\n        </div>\n        <h1 class=\"text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-2\" data-i18n=\"pageTitle\">Chính sách bảo mật</h1>\n        <p class=\"text-sm text-slate-400\" data-i18n=\"effectiveDate\">Ngày hiệu lực: 23/11/2026 | Cập nhật lần cuối: 23/11/2026</p>\n      </div>\n\n      <div class=\"space-y-8 text-slate-300 leading-relaxed text-sm sm:text-base\">\n\n        <!-- Section 1 -->\n        <section class=\"p-6 rounded-2xl gv-card\">\n          <h2 class=\"text-xl font-bold text-white mb-3\" data-i18n=\"s1Title\">1. Giới thiệu</h2>\n          <p data-i18n-html=\"s1P1\">\n            Chào mừng bạn đến với <strong>GameVault</strong> (\"chúng tôi\"), truy cập qua <a href=\"https://gametracking.id.vn\" class=\"text-[#ff6b7d] hover:text-[#ff8594] underline\">https://gametracking.id.vn</a> và ứng dụng máy tính của chúng tôi. GameVault tôn trọng quyền riêng tư của bạn và cam kết bảo vệ thông tin cá nhân bạn chia sẻ.\n          </p>\n          <p class=\"mt-2\" data-i18n=\"s1P2\">\n            Chính sách bảo mật này mô tả cách chúng tôi thu thập, sử dụng, tiết lộ và bảo vệ thông tin của bạn khi sử dụng ứng dụng và các dịch vụ web đi kèm.\n          </p>\n        </section>\n\n        <!-- Section 2 -->\n        <section class=\"p-6 rounded-2xl gv-card\">\n          <h2 class=\"text-xl font-bold text-white mb-3\" data-i18n=\"s2Title\">2. Thông tin chúng tôi thu thập</h2>\n          <p data-i18n=\"s2Intro\">Chúng tôi chỉ thu thập những thông tin cần thiết để cung cấp và nâng cao trải nghiệm chơi game của bạn:</p>\n          <ul class=\"list-disc pl-6 mt-2 space-y-2 text-slate-300\">\n            <li data-i18n-html=\"s2L1\">\n              <strong>Thông tin tài khoản Google (OAuth):</strong> Khi bạn chọn đăng nhập bằng Google, chúng tôi thu thập địa chỉ email Google, tên hiển thị cơ bản, mã định danh Google duy nhất và ảnh đại diện. Chúng tôi <em>không</em> truy cập Google Drive, danh bạ, email hay mật khẩu của bạn.\n            </li>\n            <li data-i18n-html=\"s2L2\">\n              <strong>Dữ liệu thư viện &amp; giờ chơi:</strong> Tên game, tổng giờ chơi, thời điểm mở game, trạng thái phá đảo, thẻ cá nhân và điểm đánh giá bạn theo dõi trong ứng dụng.\n            </li>\n            <li data-i18n-html=\"s2L3\">\n              <strong>Nội dung cộng đồng:</strong> Bài đánh giá công khai, bình chọn cộng đồng và điểm bảng xếp hạng mà bạn tự nguyện gửi lên.\n            </li>\n            <li data-i18n-html=\"s2L4\">\n              <strong>Thông số phần cứng (Tùy chọn):</strong> Thông số hệ thống (CPU, GPU, RAM) bạn lưu trong hồ sơ để kiểm tra độ tương thích và hiệu năng game.\n            </li>\n          </ul>\n        </section>\n\n        <!-- Section 3: Google Limited Use -->\n        <section class=\"p-6 rounded-2xl bg-gradient-to-b from-[#1a1520] to-[#13161f] border border-[#ff2a44]/30\">\n          <h2 class=\"text-xl font-bold text-white mb-2\" data-i18n=\"s3Title\">3. Tuân thủ Chính sách dữ liệu người dùng Google API</h2>\n          <p class=\"text-slate-200\" data-i18n-html=\"s3P1\">\n            Việc GameVault sử dụng và chuyển giao thông tin nhận được từ Google API tới bất kỳ ứng dụng nào khác đều tuân thủ\n            <a href=\"https://developers.google.com/terms/api-services-user-data-policy\" target=\"_blank\" rel=\"noopener noreferrer\" class=\"text-[#ff6b7d] hover:text-[#ff8594] underline font-medium\">\n              Chính sách dữ liệu người dùng dịch vụ Google API\n            </a>, bao gồm các yêu cầu về Giới hạn sử dụng (Limited Use).\n          </p>\n          <p class=\"text-slate-300 mt-2 text-sm\" data-i18n=\"s3P2\">\n            Chúng tôi tuyệt đối không sử dụng dữ liệu người dùng Google để huấn luyện mô hình AI/ML tổng quát, bán dữ liệu cho bên thứ ba hoặc dùng cho mục đích quảng cáo.\n          </p>\n        </section>\n\n        <!-- Section 4 -->\n        <section class=\"p-6 rounded-2xl gv-card\">\n          <h2 class=\"text-xl font-bold text-white mb-3\" data-i18n=\"s4Title\">4. Cách chúng tôi sử dụng thông tin</h2>\n          <p data-i18n=\"s4Intro\">Chúng tôi chỉ sử dụng thông tin thu thập được cho các mục đích sau:</p>\n          <ul class=\"list-disc pl-6 mt-2 space-y-1.5\">\n            <li data-i18n=\"s4L1\">Xác thực tài khoản và duy trì phiên đăng nhập của bạn.</li>\n            <li data-i18n=\"s4L2\">Đồng bộ thư viện game, thống kê và giờ chơi trên nhiều thiết bị.</li>\n            <li data-i18n=\"s4L3\">Hiển thị bảng xếp hạng cộng đồng, bài đánh giá và thống kê bình chọn.</li>\n            <li data-i18n=\"s4L4\">Đảm bảo an toàn dịch vụ, phòng chống gian lận và chẩn đoán sự cố kỹ thuật.</li>\n          </ul>\n        </section>\n\n        <!-- Section 5 -->\n        <section class=\"p-6 rounded-2xl gv-card\">\n          <h2 class=\"text-xl font-bold text-white mb-3\" data-i18n=\"s5Title\">5. Chia sẻ dữ liệu &amp; Bên thứ ba</h2>\n          <p data-i18n-html=\"s5Intro\">\n            Chúng tôi <strong>không</strong> bán, cho thuê hoặc thương mại hóa thông tin cá nhân của bạn dưới bất kỳ hình thức nào. Chúng tôi chỉ chia sẻ thông tin với các nhà cung cấp hạ tầng đáng tin cậy để vận hành dịch vụ:\n          </p>\n          <ul class=\"list-disc pl-6 mt-2 space-y-1.5\">\n            <li data-i18n-html=\"s5L1\"><strong>Cloudflare:</strong> Hạ tầng serverless bảo mật, cơ sở dữ liệu mã hóa (D1) và mạng phân phối nội dung.</li>\n            <li data-i18n-html=\"s5L2\"><strong>Google Identity Services:</strong> Xác minh thông tin xác thực khi bạn đăng nhập.</li>\n          </ul>\n        </section>\n\n        <!-- Section 6: Data Deletion -->\n        <section id=\"deletion\" class=\"p-6 rounded-2xl gv-card border-white/15\">\n          <h2 class=\"text-xl font-bold text-white mb-2\" data-i18n=\"s6Title\">6. Quyền người dùng &amp; Hướng dẫn xóa dữ liệu</h2>\n          <p class=\"mb-3\" data-i18n=\"s6Intro\">\n            Bạn có quyền xem, chỉnh sửa hoặc xóa vĩnh viễn tài khoản cùng toàn bộ dữ liệu liên quan bất kỳ lúc nào.\n          </p>\n          <div class=\"space-y-2\">\n            <p class=\"font-semibold text-[#ff6b7d]\" data-i18n=\"s6Sub\">Cách yêu cầu xóa dữ liệu:</p>\n            <ul class=\"list-decimal pl-6 space-y-1.5 text-slate-300\">\n              <li data-i18n-html=\"s6L1\">\n                Gửi email đến đội ngũ hỗ trợ tại <a href=\"mailto:son62320@gmail.com\" class=\"text-[#ff6b7d] hover:text-[#ff8594] font-medium underline\">son62320@gmail.com</a> với tiêu đề <strong>\"Data Deletion Request\"</strong>.\n              </li>\n              <li data-i18n=\"s6L2\">Đính kèm địa chỉ email Google đã đăng ký với tài khoản GameVault của bạn.</li>\n              <li data-i18n-html=\"s6L3\">Sau khi tiếp nhận yêu cầu, toàn bộ dữ liệu thư viện, hồ sơ và bản ghi xác thực sẽ được xóa vĩnh viễn khỏi máy chủ trong vòng <strong>30 ngày</strong>.</li>\n            </ul>\n          </div>\n        </section>\n\n        <!-- Section 7 -->\n        <section class=\"p-6 rounded-2xl gv-card\">\n          <h2 class=\"text-xl font-bold text-white mb-3\" data-i18n=\"s7Title\">7. Bảo mật dữ liệu</h2>\n          <p data-i18n=\"s7P1\">\n            Mọi kết nối giữa ứng dụng khách và máy chủ của chúng tôi đều được mã hóa trên đường truyền bằng giao thức TLS/HTTPS tiêu chuẩn. Dữ liệu lưu trong cơ sở dữ liệu được bảo vệ bằng các biện pháp kiểm soát truy cập hiện đại.\n          </p>\n        </section>\n\n        <!-- Section 8 -->\n        <section class=\"p-6 rounded-2xl gv-card\">\n          <h2 class=\"text-xl font-bold text-white mb-3\" data-i18n=\"s8Title\">8. Liên hệ với chúng tôi</h2>\n          <p data-i18n=\"s8Intro\">Nếu bạn có câu hỏi, góp ý hoặc thắc mắc liên quan đến Chính sách bảo mật này, vui lòng liên hệ:</p>\n          <div class=\"mt-3 p-4 rounded-xl bg-[#191d28] border border-white/[0.08] text-sm\">\n            <p class=\"text-white font-semibold\" data-i18n=\"s8Team\">Đội ngũ phát triển GameVault</p>\n            <p class=\"text-slate-400 mt-1\" data-i18n-html=\"s8Email\">Email: <a href=\"mailto:son62320@gmail.com\" class=\"text-[#ff6b7d] hover:text-[#ff8594] underline\">son62320@gmail.com</a></p>\n            <p class=\"text-slate-400\">Website: <a href=\"https://gametracking.id.vn\" class=\"text-[#ff6b7d] hover:text-[#ff8594] underline\">https://gametracking.id.vn</a></p>\n          </div>\n        </section>\n\n      </div>\n\n      <div class=\"mt-12 pt-6 border-t border-white/[0.08] flex items-center justify-between gap-4\">\n        <a href=\"/\" onclick=\"if (window.history.length > 1) { window.history.back(); return false; }\" class=\"inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#191d28] hover:bg-[#222736] border border-white/10 text-slate-200 text-sm font-semibold transition-all\">\n          <span data-i18n=\"backShort\">← Quay lại</span>\n        </a>\n        <a href=\"/\" class=\"text-sm text-[#ff6b7d] hover:text-[#ff8594] font-semibold transition-colors\" data-i18n=\"goHome\">\n          Về Trang chủ GameVault →\n        </a>\n      </div>\n    </div>\n  </main>\n\n  <!-- Footer -->\n  <footer class=\"border-t border-white/[0.06] bg-[#0c0e13] py-8 text-slate-500 text-xs sm:text-sm\">\n    <div class=\"max-w-6xl mx-auto px-5 flex flex-col sm:flex-row items-center justify-between gap-4\">\n      <div data-i18n=\"footerCopy\">© 2026 GameVault. Lưu giữ kỷ niệm &amp; thời gian chơi game bền vững.</div>\n      <div class=\"flex flex-wrap items-center gap-5\">\n        <a href=\"/\" class=\"hover:text-slate-300 transition-colors\" data-i18n=\"navHome\">Trang chủ</a>\n        <a href=\"/#download\" class=\"hover:text-slate-300 transition-colors\" data-i18n=\"navDownload\">Tải về</a>\n        <a href=\"/privacy\" class=\"text-slate-300\" data-i18n=\"navPrivacy\">Bảo mật</a>\n        <a href=\"/terms\" class=\"hover:text-slate-300 transition-colors\" data-i18n=\"navTerms\">Điều khoản</a>\n        <a href=\"mailto:son62320@gmail.com\" class=\"hover:text-slate-300 transition-colors\" data-i18n=\"footerContact\">Liên hệ</a>\n      </div>\n    </div>\n  </footer>\n\n  <script>\n    const i18n = {\n      vi: {\n        docTitle: 'Chính sách bảo mật - GameVault',\n        navHome: 'Trang chủ',\n        navPrivacy: 'Bảo mật',\n        navTerms: 'Điều khoản',\n        navLogin: 'Đăng nhập / Hồ sơ',\n        navDownload: 'Tải về',\n        backPrev: 'Quay lại trang trước',\n        backShort: '← Quay lại',\n        goHome: 'Về Trang chủ GameVault →',\n        docBadge: 'Tài liệu pháp lý',\n        pageTitle: 'Chính sách bảo mật',\n        effectiveDate: 'Ngày hiệu lực: 23/11/2026 | Cập nhật lần cuối: 23/11/2026',\n        s1Title: '1. Giới thiệu',\n        s1P1: 'Chào mừng bạn đến với <strong>GameVault</strong> (\"chúng tôi\"), truy cập qua <a href=\"https://gametracking.id.vn\" class=\"text-[#ff6b7d] hover:text-[#ff8594] underline\">https://gametracking.id.vn</a> và ứng dụng máy tính của chúng tôi. GameVault tôn trọng quyền riêng tư của bạn và cam kết bảo vệ thông tin cá nhân bạn chia sẻ.',\n        s1P2: 'Chính sách bảo mật này mô tả cách chúng tôi thu thập, sử dụng, tiết lộ và bảo vệ thông tin của bạn khi sử dụng ứng dụng và các dịch vụ web đi kèm.',\n        s2Title: '2. Thông tin chúng tôi thu thập',\n        s2Intro: 'Chúng tôi chỉ thu thập những thông tin cần thiết để cung cấp và nâng cao trải nghiệm chơi game của bạn:',\n        s2L1: '<strong>Thông tin tài khoản Google (OAuth):</strong> Khi bạn chọn đăng nhập bằng Google, chúng tôi thu thập địa chỉ email Google, tên hiển thị cơ bản, mã định danh Google duy nhất và ảnh đại diện. Chúng tôi <em>không</em> truy cập Google Drive, danh bạ, email hay mật khẩu của bạn.',\n        s2L2: '<strong>Dữ liệu thư viện &amp; giờ chơi:</strong> Tên game, tổng giờ chơi, thời điểm mở game, trạng thái phá đảo, thẻ cá nhân và điểm đánh giá bạn theo dõi trong ứng dụng.',\n        s2L3: '<strong>Nội dung cộng đồng:</strong> Bài đánh giá công khai, bình chọn cộng đồng và điểm bảng xếp hạng mà bạn tự nguyện gửi lên.',\n        s2L4: '<strong>Thông số phần cứng (Tùy chọn):</strong> Thông số hệ thống (CPU, GPU, RAM) bạn lưu trong hồ sơ để kiểm tra độ tương thích và hiệu năng game.',\n        s3Title: '3. Tuân thủ Chính sách dữ liệu người dùng Google API',\n        s3P1: 'Việc GameVault sử dụng và chuyển giao thông tin nhận được từ Google API tới bất kỳ ứng dụng nào khác đều tuân thủ <a href=\"https://developers.google.com/terms/api-services-user-data-policy\" target=\"_blank\" rel=\"noopener noreferrer\" class=\"text-[#ff6b7d] hover:text-[#ff8594] underline font-medium\">Chính sách dữ liệu người dùng dịch vụ Google API</a>, bao gồm các yêu cầu về Giới hạn sử dụng (Limited Use).',\n        s3P2: 'Chúng tôi tuyệt đối không sử dụng dữ liệu người dùng Google để huấn luyện mô hình AI/ML tổng quát, bán dữ liệu cho bên thứ ba hoặc dùng cho mục đích quảng cáo.',\n        s4Title: '4. Cách chúng tôi sử dụng thông tin',\n        s4Intro: 'Chúng tôi chỉ sử dụng thông tin thu thập được cho các mục đích sau:',\n        s4L1: 'Xác thực tài khoản và duy trì phiên đăng nhập của bạn.',\n        s4L2: 'Đồng bộ thư viện game, thống kê và giờ chơi trên nhiều thiết bị.',\n        s4L3: 'Hiển thị bảng xếp hạng cộng đồng, bài đánh giá và thống kê bình chọn.',\n        s4L4: 'Đảm bảo an toàn dịch vụ, phòng chống gian lận và chẩn đoán sự cố kỹ thuật.',\n        s5Title: '5. Chia sẻ dữ liệu & Bên thứ ba',\n        s5Intro: 'Chúng tôi <strong>không</strong> bán, cho thuê hoặc thương mại hóa thông tin cá nhân của bạn dưới bất kỳ hình thức nào. Chúng tôi chỉ chia sẻ thông tin với các nhà cung cấp hạ tầng đáng tin cậy để vận hành dịch vụ:',\n        s5L1: '<strong>Cloudflare:</strong> Hạ tầng serverless bảo mật, cơ sở dữ liệu mã hóa (D1) và mạng phân phối nội dung.',\n        s5L2: '<strong>Google Identity Services:</strong> Xác minh thông tin xác thực khi bạn đăng nhập.',\n        s6Title: '6. Quyền người dùng & Hướng dẫn xóa dữ liệu',\n        s6Intro: 'Bạn có quyền xem, chỉnh sửa hoặc xóa vĩnh viễn tài khoản cùng toàn bộ dữ liệu liên quan bất kỳ lúc nào.',\n        s6Sub: 'Cách yêu cầu xóa dữ liệu:',\n        s6L1: 'Gửi email đến đội ngũ hỗ trợ tại <a href=\"mailto:son62320@gmail.com\" class=\"text-[#ff6b7d] hover:text-[#ff8594] font-medium underline\">son62320@gmail.com</a> với tiêu đề <strong>\"Data Deletion Request\"</strong>.',\n        s6L2: 'Đính kèm địa chỉ email Google đã đăng ký với tài khoản GameVault của bạn.',\n        s6L3: 'Sau khi tiếp nhận yêu cầu, toàn bộ dữ liệu thư viện, hồ sơ và bản ghi xác thực sẽ được xóa vĩnh viễn khỏi máy chủ trong vòng <strong>30 ngày</strong>.',\n        s7Title: '7. Bảo mật dữ liệu',\n        s7P1: 'Mọi kết nối giữa ứng dụng khách và máy chủ của chúng tôi đều được mã hóa trên đường truyền bằng giao thức TLS/HTTPS tiêu chuẩn. Dữ liệu lưu trong cơ sở dữ liệu được bảo vệ bằng các biện pháp kiểm soát truy cập hiện đại.',\n        s8Title: '8. Liên hệ với chúng tôi',\n        s8Intro: 'Nếu bạn có câu hỏi, góp ý hoặc thắc mắc liên quan đến Chính sách bảo mật này, vui lòng liên hệ:',\n        s8Team: 'Đội ngũ phát triển GameVault',\n        s8Email: 'Email: <a href=\"mailto:son62320@gmail.com\" class=\"text-[#ff6b7d] hover:text-[#ff8594] underline\">son62320@gmail.com</a>',\n        footerCopy: '© 2026 GameVault. Lưu giữ kỷ niệm & thời gian chơi game bền vững.',\n        footerContact: 'Liên hệ'\n      },\n      en: {\n        docTitle: 'Privacy Policy - GameVault',\n        navHome: 'Home',\n        navPrivacy: 'Privacy Policy',\n        navTerms: 'Terms of Service',\n        navLogin: 'Sign in / Profile',\n        navDownload: 'Download',\n        backPrev: 'Go back',\n        backShort: '← Back',\n        goHome: 'Back to GameVault Home →',\n        docBadge: 'Legal Document',\n        pageTitle: 'Privacy Policy',\n        effectiveDate: 'Effective Date: November 23, 2026 | Last Updated: November 23, 2026',\n        s1Title: '1. Introduction',\n        s1P1: 'Welcome to <strong>GameVault</strong> (\"we\", \"our\", or \"us\"), accessible via <a href=\"https://gametracking.id.vn\" class=\"text-[#ff6b7d] hover:text-[#ff8594] underline\">https://gametracking.id.vn</a> and our desktop application. GameVault respects your privacy and is committed to protecting the personal information you share with us.',\n        s1P2: 'This Privacy Policy outlines how we collect, use, disclose, and safeguard your information when you use our application and associated web services.',\n        s2Title: '2. Information We Collect',\n        s2Intro: 'We only collect information necessary to provide and enhance your gaming experience:',\n        s2L1: '<strong>Google Account Information (OAuth):</strong> When you choose to sign in with Google, we collect your Google email address, basic profile name, unique Google user ID, and avatar profile picture. We do <em>not</em> access your Google Drive, contacts, emails, or password.',\n        s2L2: '<strong>Game Library &amp; Playtime Data:</strong> Game titles, total playtime hours, launch timestamps, completion statuses, personal tags, and ratings you track within the application.',\n        s2L3: '<strong>Community Content:</strong> Public reviews, community pick votes, and leaderboard scores that you voluntarily submit.',\n        s2L4: '<strong>Hardware Specifications (Optional):</strong> Optional system specifications (CPU, GPU, RAM) you choose to save in your profile to check game compatibility.',\n        s3Title: '3. Google API Services User Data Policy Compliance',\n        s3P1: 'GameVault\\'s use and transfer of information received from Google APIs to any other app will adhere to the <a href=\"https://developers.google.com/terms/api-services-user-data-policy\" target=\"_blank\" rel=\"noopener noreferrer\" class=\"text-[#ff6b7d] hover:text-[#ff8594] underline font-medium\">Google API Services User Data Policy</a>, including the Limited Use requirements.',\n        s3P2: 'We strictly do not use Google user data to train generalized AI/ML models, sell data to third parties, or use your data for advertising purposes.',\n        s4Title: '4. How We Use Your Information',\n        s4Intro: 'We use the collected information solely for:',\n        s4L1: 'Authenticating your account and maintaining your session.',\n        s4L2: 'Synchronizing your game library, statistics, and playtime across multiple devices.',\n        s4L3: 'Displaying community leaderboards, reviews, and community pick statistics.',\n        s4L4: 'Ensuring service security, preventing fraud, and diagnosing technical issues.',\n        s5Title: '5. Data Sharing & Third Parties',\n        s5Intro: 'We do <strong>not</strong> sell, rent, or monetize your personal information under any circumstances. We only share information with trusted infrastructure providers required to operate the service:',\n        s5L1: '<strong>Cloudflare:</strong> Secure serverless hosting, encrypted database (D1), and content delivery network.',\n        s5L2: '<strong>Google Identity Services:</strong> To verify authentication credentials when logging in.',\n        s6Title: '6. User Rights & Data Deletion Instructions',\n        s6Intro: 'You have the right to view, modify, or permanently delete your account and all associated data at any time.',\n        s6Sub: 'How to request data deletion:',\n        s6L1: 'Send an email to our support team at <a href=\"mailto:son62320@gmail.com\" class=\"text-[#ff6b7d] hover:text-[#ff8594] font-medium underline\">son62320@gmail.com</a> with the subject line <strong>\"Data Deletion Request\"</strong>.',\n        s6L2: 'Include the Google email address registered with your GameVault account.',\n        s6L3: 'Upon receiving your request, all your library data, profile, and authentication records will be permanently purged from our servers within <strong>30 days</strong>.',\n        s7Title: '7. Data Security',\n        s7P1: 'All communications between your client application and our servers are encrypted in transit using industry-standard TLS/HTTPS protocols. Data stored in our database is secured with modern access control measures.',\n        s8Title: '8. Contact Us',\n        s8Intro: 'If you have any questions, feedback, or concerns regarding this Privacy Policy, please contact:',\n        s8Team: 'GameVault Development Team',\n        s8Email: 'Lead Developer Email: <a href=\"mailto:son62320@gmail.com\" class=\"text-[#ff6b7d] hover:text-[#ff8594] underline\">son62320@gmail.com</a>',\n        footerCopy: '© 2026 GameVault. Permanent Playtime & Gaming Memories.',\n        footerContact: 'Contact'\n      }\n    };\n\n    let currentLang = localStorage.getItem('gamevault.web.lang') === 'en' ? 'en' : 'vi';\n\n    function setLang(lang) {\n      currentLang = lang;\n      localStorage.setItem('gamevault.web.lang', lang);\n      document.documentElement.lang = lang;\n      const dict = i18n[lang];\n      if (dict.docTitle) document.title = dict.docTitle;\n      document.querySelectorAll('[data-i18n]').forEach((el) => {\n        const key = el.getAttribute('data-i18n');\n        if (dict[key]) el.textContent = dict[key];\n      });\n      document.querySelectorAll('[data-i18n-html]').forEach((el) => {\n        const key = el.getAttribute('data-i18n-html');\n        if (dict[key]) el.innerHTML = dict[key];\n      });\n      const viBtn = document.getElementById('btn-lang-vi');\n      const enBtn = document.getElementById('btn-lang-en');\n      if (lang === 'vi') {\n        viBtn.className = 'px-2.5 py-1 rounded-md text-xs font-bold transition-all bg-[#191d28] text-white shadow-sm';\n        enBtn.className = 'px-2.5 py-1 rounded-md text-xs font-bold transition-all text-slate-400 hover:text-white';\n      } else {\n        enBtn.className = 'px-2.5 py-1 rounded-md text-xs font-bold transition-all bg-[#191d28] text-white shadow-sm';\n        viBtn.className = 'px-2.5 py-1 rounded-md text-xs font-bold transition-all text-slate-400 hover:text-white';\n      }\n    }\n\n    setLang(currentLang);\n  </script>\n</body>\n</html>\n";
const TERMS_HTML = "<!DOCTYPE html>\n<html lang=\"vi\" class=\"scroll-smooth\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>Điều khoản dịch vụ - GameVault</title>\n  <meta name=\"description\" content=\"Terms of Service for GameVault application and gametracking.id.vn.\">\n  <script src=\"https://cdn.tailwindcss.com\"></script>\n  <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n  <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n  <link href=\"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap\" rel=\"stylesheet\">\n  <style>\n    :root {\n      --gv-bg: #0c0e13;\n      --gv-surface: #13161f;\n      --gv-surface-2: #191d28;\n      --gv-accent: #ff2a44;\n      --gv-accent-hover: #e11d48;\n    }\n    body {\n      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;\n      background-color: var(--gv-bg);\n      color: #f1f3f7;\n    }\n    .gv-glow {\n      background: radial-gradient(ellipse 75% 45% at 50% 0%, rgba(255, 42, 68, 0.16) 0%, rgba(14, 165, 233, 0.06) 45%, rgba(12, 14, 19, 0) 75%);\n    }\n    .gv-card {\n      background-color: var(--gv-surface);\n      border: 1px solid rgba(255, 255, 255, 0.08);\n    }\n  </style>\n</head>\n<body class=\"min-h-screen flex flex-col antialiased selection:bg-[#ff2a44]/40 selection:text-white\">\n\n  <!-- Header -->\n  <header class=\"border-b border-white/[0.08] bg-[#0c0e13]/85 backdrop-blur-md sticky top-0 z-50\">\n    <div class=\"max-w-6xl mx-auto px-5 h-16 flex items-center justify-between gap-4\">\n      <a href=\"/\" class=\"flex items-center gap-3 group shrink-0\">\n        <div class=\"w-9 h-9 rounded-xl bg-gradient-to-br from-[#ff2a44] to-[#be123c] flex items-center justify-center font-black text-sm text-white shadow-lg shadow-[#ff2a44]/30\">\n          GV\n        </div>\n        <div>\n          <div class=\"flex items-center gap-1.5\">\n            <span class=\"font-extrabold text-base tracking-wide text-white\">GAMEVAULT</span>\n            <span class=\"text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#ff2a44]/15 text-[#ff5c70] border border-[#ff2a44]/35\">PRO</span>\n          </div>\n          <div class=\"text-[11px] text-slate-400 hidden sm:block\">Permanent Playtime &amp; Media</div>\n        </div>\n      </a>\n\n      <nav class=\"hidden md:flex items-center gap-6 text-sm font-semibold text-slate-400\">\n        <a href=\"/\" class=\"hover:text-white transition-colors\" data-i18n=\"navHome\">Trang chủ</a>\n        <a href=\"/privacy\" class=\"hover:text-white transition-colors\" data-i18n=\"navPrivacy\">Bảo mật</a>\n        <a href=\"/terms\" class=\"text-white transition-colors\" data-i18n=\"navTerms\">Điều khoản</a>\n      </nav>\n\n      <div class=\"flex items-center gap-2.5\">\n        <div class=\"inline-flex bg-[#13161f] border border-white/[0.08] rounded-lg p-0.5\" role=\"group\" aria-label=\"Language\">\n          <button type=\"button\" id=\"btn-lang-vi\" onclick=\"setLang('vi')\" class=\"px-2.5 py-1 rounded-md text-xs font-bold transition-all bg-[#191d28] text-white shadow-sm\">\n            VI\n          </button>\n          <button type=\"button\" id=\"btn-lang-en\" onclick=\"setLang('en')\" class=\"px-2.5 py-1 rounded-md text-xs font-bold transition-all text-slate-400 hover:text-white\">\n            EN\n          </button>\n        </div>\n\n        <a href=\"/dashboard?tab=profile\" class=\"hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-white/10 bg-[#191d28] hover:bg-[#222736] text-slate-200 text-xs font-semibold transition-all\">\n          <span data-i18n=\"navLogin\">Đăng nhập / Hồ sơ</span>\n        </a>\n        <a href=\"/#download\" class=\"inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#ff2a44] hover:bg-[#e11d48] text-white font-bold text-xs sm:text-sm transition-all shadow-lg shadow-[#ff2a44]/30\">\n          <svg class=\"w-4 h-4 shrink-0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" viewBox=\"0 0 24 24\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"></path><polyline points=\"7 10 12 15 17 10\"></polyline><line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"></line></svg>\n          <span data-i18n=\"navDownload\">Tải về</span>\n        </a>\n      </div>\n    </div>\n  </header>\n\n  <main class=\"flex-1 gv-glow\">\n    <div class=\"max-w-4xl mx-auto px-5 py-12\">\n      <div class=\"mb-6\">\n        <a href=\"/\" onclick=\"if (window.history.length > 1) { window.history.back(); return false; }\" class=\"inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#191d28] hover:bg-[#222736] text-slate-200 text-xs sm:text-sm font-semibold border border-white/10 transition-all\">\n          <svg class=\"w-4 h-4 inline-block text-[#ff6b7d]\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" viewBox=\"0 0 24 24\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M10 19l-7-7m0 0l7-7m-7 7h18\"/></svg>\n          <span data-i18n=\"backPrev\">Quay lại trang trước</span>\n        </a>\n      </div>\n\n      <div class=\"mb-10 pb-6 border-b border-white/[0.08]\">\n        <div class=\"inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#ff2a44]/10 border border-[#ff2a44]/30 text-[#ff6b7d] text-xs font-bold mb-3\" data-i18n=\"docBadge\">\n          Tài liệu pháp lý\n        </div>\n        <h1 class=\"text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-2\" data-i18n=\"pageTitle\">Điều khoản dịch vụ</h1>\n        <p class=\"text-sm text-slate-400\" data-i18n=\"effectiveDate\">Ngày hiệu lực: 23/11/2026 | Cập nhật lần cuối: 23/11/2026</p>\n      </div>\n\n      <div class=\"space-y-8 text-slate-300 leading-relaxed text-sm sm:text-base\">\n\n        <!-- Section 1 -->\n        <section class=\"p-6 rounded-2xl gv-card\">\n          <h2 class=\"text-xl font-bold text-white mb-3\" data-i18n=\"s1Title\">1. Chấp thuận điều khoản</h2>\n          <p data-i18n-html=\"s1P1\">\n            Các Điều khoản dịch vụ này cấu thành thỏa thuận ràng buộc pháp lý giữa bạn (\"Người dùng\") và <strong>GameVault</strong> (\"chúng tôi\"), liên quan đến việc truy cập và sử dụng ứng dụng GameVault, trang web (<a href=\"https://gametracking.id.vn\" class=\"text-[#ff6b7d] hover:text-[#ff8594] underline\">https://gametracking.id.vn</a>) cùng các dịch vụ đồng bộ liên quan.\n          </p>\n          <p class=\"mt-2\" data-i18n=\"s1P2\">\n            Bằng việc tải xuống, cài đặt, truy cập hoặc sử dụng GameVault, bạn xác nhận đã đọc, hiểu và đồng ý tuân thủ toàn bộ các Điều khoản dịch vụ này. Nếu không đồng ý, bạn vui lòng ngừng sử dụng dịch vụ.\n          </p>\n        </section>\n\n        <!-- Section 2 -->\n        <section class=\"p-6 rounded-2xl gv-card\">\n          <h2 class=\"text-xl font-bold text-white mb-3\" data-i18n=\"s2Title\">2. Tài khoản người dùng &amp; Xác thực Google</h2>\n          <p data-i18n=\"s2Intro\">\n            Để sử dụng tính năng đồng bộ đám mây đa thiết bị và các tính năng cộng đồng, bạn có thể xác thực qua Tài khoản Google của mình. Bạn đồng ý:\n          </p>\n          <ul class=\"list-disc pl-6 mt-2 space-y-1.5\">\n            <li data-i18n=\"s2L1\">Bảo mật thông tin đăng nhập tài khoản của bạn.</li>\n            <li data-i18n=\"s2L2\">Thông báo ngay cho chúng tôi nếu phát hiện hoặc nghi ngờ truy cập trái phép vào tài khoản.</li>\n            <li data-i18n=\"s2L3\">Chịu trách nhiệm cho mọi hoạt động diễn ra dưới tài khoản đã xác thực của bạn.</li>\n          </ul>\n        </section>\n\n        <!-- Section 3 -->\n        <section class=\"p-6 rounded-2xl gv-card\">\n          <h2 class=\"text-xl font-bold text-white mb-3\" data-i18n=\"s3Title\">3. Quy tắc sử dụng hợp lệ</h2>\n          <p data-i18n=\"s3Intro\">Bạn đồng ý không thực hiện bất kỳ hành vi bị cấm nào sau đây:</p>\n          <ul class=\"list-disc pl-6 mt-2 space-y-1.5\">\n            <li data-i18n=\"s3L1\">Cố gắng vượt qua, vô hiệu hóa hoặc can thiệp vào các tính năng bảo mật của GameVault.</li>\n            <li data-i18n=\"s3L2\">Sử dụng script tự động, bot hoặc công cụ thu thập dữ liệu trái phép, spam bài đánh giá/bình chọn.</li>\n            <li data-i18n=\"s3L3\">Đăng tải nội dung quấy rối, lăng mạ, phỉ báng hoặc phản cảm trong bài đánh giá hay thảo luận cộng đồng.</li>\n            <li data-i18n=\"s3L4\">Gian lận, thao túng số liệu giờ chơi hoặc thứ hạng bảng xếp hạng.</li>\n          </ul>\n        </section>\n\n        <!-- Section 4 -->\n        <section class=\"p-6 rounded-2xl gv-card\">\n          <h2 class=\"text-xl font-bold text-white mb-3\" data-i18n=\"s4Title\">4. Quyền sở hữu trí tuệ</h2>\n          <p data-i18n=\"s4P1\">\n            Phần mềm GameVault, thương hiệu, thiết kế giao diện và kiến trúc hệ thống thuộc quyền sở hữu của đội ngũ phát triển GameVault.\n          </p>\n          <p class=\"mt-2 text-slate-400 text-sm\" data-i18n=\"s4P2\">\n            Tên game, logo, ảnh bìa và nhãn hiệu của bên thứ ba hiển thị trong GameVault thuộc sở hữu của các chủ sở hữu, nhà phát hành và nhà phát triển tương ứng. GameVault là dự án độc lập và không liên kết chính thức với Steam, Epic Games, GOG hay bất kỳ nhà phát hành game nào.\n          </p>\n        </section>\n\n        <!-- Section 5 -->\n        <section class=\"p-6 rounded-2xl gv-card\">\n          <h2 class=\"text-xl font-bold text-white mb-3\" data-i18n=\"s5Title\">5. Chấm dứt dịch vụ</h2>\n          <p data-i18n=\"s5P1\">\n            Chúng tôi có quyền tạm ngưng hoặc chấm dứt quyền truy cập dịch vụ đám mây GameVault của bạn mà không cần báo trước nếu có hành vi vi phạm Điều khoản dịch vụ hoặc gây hại cho người dùng khác và hệ thống.\n          </p>\n        </section>\n\n        <!-- Section 6 -->\n        <section class=\"p-6 rounded-2xl gv-card\">\n          <h2 class=\"text-xl font-bold text-white mb-3\" data-i18n=\"s6Title\">6. Tuyên bố miễn trừ bảo đảm</h2>\n          <p data-i18n=\"s6P1\">\n            GameVault được cung cấp trên cơ sở \"NGUYÊN TRẠNG\" (\"AS-IS\") và \"THEO KHẢ NĂNG SẴN CÓ\" (\"AS-AVAILABLE\"). Trong phạm vi tối đa pháp luật cho phép, chúng tôi từ chối mọi bảo đảm rõ ràng hay ngụ ý liên quan đến phần mềm và việc sử dụng của bạn.\n          </p>\n        </section>\n\n        <!-- Section 7 -->\n        <section class=\"p-6 rounded-2xl gv-card\">\n          <h2 class=\"text-xl font-bold text-white mb-3\" data-i18n=\"s7Title\">7. Giới hạn trách nhiệm</h2>\n          <p data-i18n=\"s7P1\">\n            Trong mọi trường hợp, GameVault và đội ngũ phát triển sẽ không chịu trách nhiệm đối với bạn hoặc bên thứ ba về bất kỳ thiệt hại trực tiếp, gián tiếp, ngẫu nhiên hay đặc biệt nào phát sinh từ việc sử dụng ứng dụng.\n          </p>\n        </section>\n\n        <!-- Section 8 -->\n        <section class=\"p-6 rounded-2xl gv-card\">\n          <h2 class=\"text-xl font-bold text-white mb-3\" data-i18n=\"s8Title\">8. Thay đổi điều khoản</h2>\n          <p data-i18n=\"s8P1\">\n            Chúng tôi có quyền sửa đổi các Điều khoản dịch vụ này bất kỳ lúc nào và sẽ cập nhật \"Ngày hiệu lực\" ở đầu tài liệu. Việc bạn tiếp tục sử dụng GameVault sau khi có thay đổi đồng nghĩa với việc chấp nhận các điều khoản mới.\n          </p>\n        </section>\n\n        <!-- Section 9 -->\n        <section class=\"p-6 rounded-2xl gv-card\">\n          <h2 class=\"text-xl font-bold text-white mb-3\" data-i18n=\"s9Title\">9. Thông tin liên hệ</h2>\n          <p data-i18n=\"s9Intro\">Nếu có câu hỏi hoặc thông báo liên quan đến Điều khoản dịch vụ này, vui lòng liên hệ:</p>\n          <div class=\"mt-3 p-4 rounded-xl bg-[#191d28] border border-white/[0.08] text-sm\">\n            <p class=\"text-white font-semibold\" data-i18n=\"s9Team\">Đội ngũ phát triển GameVault</p>\n            <p class=\"text-slate-400 mt-1\">Email: <a href=\"mailto:son62320@gmail.com\" class=\"text-[#ff6b7d] hover:text-[#ff8594] underline\">son62320@gmail.com</a></p>\n            <p class=\"text-slate-400\">Website: <a href=\"https://gametracking.id.vn\" class=\"text-[#ff6b7d] hover:text-[#ff8594] underline\">https://gametracking.id.vn</a></p>\n          </div>\n        </section>\n\n      </div>\n\n      <div class=\"mt-12 pt-6 border-t border-white/[0.08] flex items-center justify-between gap-4\">\n        <a href=\"/\" onclick=\"if (window.history.length > 1) { window.history.back(); return false; }\" class=\"inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#191d28] hover:bg-[#222736] border border-white/10 text-slate-200 text-sm font-semibold transition-all\">\n          <span data-i18n=\"backShort\">← Quay lại</span>\n        </a>\n        <a href=\"/\" class=\"text-sm text-[#ff6b7d] hover:text-[#ff8594] font-semibold transition-colors\" data-i18n=\"goHome\">\n          Về Trang chủ GameVault →\n        </a>\n      </div>\n    </div>\n  </main>\n\n  <!-- Footer -->\n  <footer class=\"border-t border-white/[0.06] bg-[#0c0e13] py-8 text-slate-500 text-xs sm:text-sm\">\n    <div class=\"max-w-6xl mx-auto px-5 flex flex-col sm:flex-row items-center justify-between gap-4\">\n      <div data-i18n=\"footerCopy\">© 2026 GameVault. Lưu giữ kỷ niệm &amp; thời gian chơi game bền vững.</div>\n      <div class=\"flex flex-wrap items-center gap-5\">\n        <a href=\"/\" class=\"hover:text-slate-300 transition-colors\" data-i18n=\"navHome\">Trang chủ</a>\n        <a href=\"/#download\" class=\"hover:text-slate-300 transition-colors\" data-i18n=\"navDownload\">Tải về</a>\n        <a href=\"/privacy\" class=\"hover:text-slate-300 transition-colors\" data-i18n=\"navPrivacy\">Bảo mật</a>\n        <a href=\"/terms\" class=\"text-slate-300\" data-i18n=\"navTerms\">Điều khoản</a>\n        <a href=\"mailto:son62320@gmail.com\" class=\"hover:text-slate-300 transition-colors\" data-i18n=\"footerContact\">Liên hệ</a>\n      </div>\n    </div>\n  </footer>\n\n  <script>\n    const i18n = {\n      vi: {\n        docTitle: 'Điều khoản dịch vụ - GameVault',\n        navHome: 'Trang chủ',\n        navPrivacy: 'Bảo mật',\n        navTerms: 'Điều khoản',\n        navLogin: 'Đăng nhập / Hồ sơ',\n        navDownload: 'Tải về',\n        backPrev: 'Quay lại trang trước',\n        backShort: '← Quay lại',\n        goHome: 'Về Trang chủ GameVault →',\n        docBadge: 'Tài liệu pháp lý',\n        pageTitle: 'Điều khoản dịch vụ',\n        effectiveDate: 'Ngày hiệu lực: 23/11/2026 | Cập nhật lần cuối: 23/11/2026',\n        s1Title: '1. Chấp thuận điều khoản',\n        s1P1: 'Các Điều khoản dịch vụ này cấu thành thỏa thuận ràng buộc pháp lý giữa bạn (\"Người dùng\") và <strong>GameVault</strong> (\"chúng tôi\"), liên quan đến việc truy cập và sử dụng ứng dụng GameVault, trang web (<a href=\"https://gametracking.id.vn\" class=\"text-[#ff6b7d] hover:text-[#ff8594] underline\">https://gametracking.id.vn</a>) cùng các dịch vụ đồng bộ liên quan.',\n        s1P2: 'Bằng việc tải xuống, cài đặt, truy cập hoặc sử dụng GameVault, bạn xác nhận đã đọc, hiểu và đồng ý tuân thủ toàn bộ các Điều khoản dịch vụ này. Nếu không đồng ý, bạn vui lòng ngừng sử dụng dịch vụ.',\n        s2Title: '2. Tài khoản người dùng & Xác thực Google',\n        s2Intro: 'Để sử dụng tính năng đồng bộ đám mây đa thiết bị và các tính năng cộng đồng, bạn có thể xác thực qua Tài khoản Google của mình. Bạn đồng ý:',\n        s2L1: 'Bảo mật thông tin đăng nhập tài khoản của bạn.',\n        s2L2: 'Thông báo ngay cho chúng tôi nếu phát hiện hoặc nghi ngờ truy cập trái phép vào tài khoản.',\n        s2L3: 'Chịu trách nhiệm cho mọi hoạt động diễn ra dưới tài khoản đã xác thực của bạn.',\n        s3Title: '3. Quy tắc sử dụng hợp lệ',\n        s3Intro: 'Bạn đồng ý không thực hiện bất kỳ hành vi bị cấm nào sau đây:',\n        s3L1: 'Cố gắng vượt qua, vô hiệu hóa hoặc can thiệp vào các tính năng bảo mật của GameVault.',\n        s3L2: 'Sử dụng script tự động, bot hoặc công cụ thu thập dữ liệu trái phép, spam bài đánh giá/bình chọn.',\n        s3L3: 'Đăng tải nội dung quấy rối, lăng mạ, phỉ báng hoặc phản cảm trong bài đánh giá hay thảo luận cộng đồng.',\n        s3L4: 'Gian lận, thao túng số liệu giờ chơi hoặc thứ hạng bảng xếp hạng.',\n        s4Title: '4. Quyền sở hữu trí tuệ',\n        s4P1: 'Phần mềm GameVault, thương hiệu, thiết kế giao diện và kiến trúc hệ thống thuộc quyền sở hữu của đội ngũ phát triển GameVault.',\n        s4P2: 'Tên game, logo, ảnh bìa và nhãn hiệu của bên thứ ba hiển thị trong GameVault thuộc sở hữu của các chủ sở hữu, nhà phát hành và nhà phát triển tương ứng. GameVault là dự án độc lập và không liên kết chính thức với Steam, Epic Games, GOG hay bất kỳ nhà phát hành game nào.',\n        s5Title: '5. Chấm dứt dịch vụ',\n        s5P1: 'Chúng tôi có quyền tạm ngưng hoặc chấm dứt quyền truy cập dịch vụ đám mây GameVault của bạn mà không cần báo trước nếu có hành vi vi phạm Điều khoản dịch vụ hoặc gây hại cho người dùng khác và hệ thống.',\n        s6Title: '6. Tuyên bố miễn trừ bảo đảm',\n        s6P1: 'GameVault được cung cấp trên cơ sở \"NGUYÊN TRẠNG\" (\"AS-IS\") và \"THEO KHẢ NĂNG SẴN CÓ\" (\"AS-AVAILABLE\"). Trong phạm vi tối đa pháp luật cho phép, chúng tôi từ chối mọi bảo đảm rõ ràng hay ngụ ý liên quan đến phần mềm và việc sử dụng của bạn.',\n        s7Title: '7. Giới hạn trách nhiệm',\n        s7P1: 'Trong mọi trường hợp, GameVault và đội ngũ phát triển sẽ không chịu trách nhiệm đối với bạn hoặc bên thứ ba về bất kỳ thiệt hại trực tiếp, gián tiếp, ngẫu nhiên hay đặc biệt nào phát sinh từ việc sử dụng ứng dụng.',\n        s8Title: '8. Thay đổi điều khoản',\n        s8P1: 'Chúng tôi có quyền sửa đổi các Điều khoản dịch vụ này bất kỳ lúc nào và sẽ cập nhật \"Ngày hiệu lực\" ở đầu tài liệu. Việc bạn tiếp tục sử dụng GameVault sau khi có thay đổi đồng nghĩa với việc chấp nhận các điều khoản mới.',\n        s9Title: '9. Thông tin liên hệ',\n        s9Intro: 'Nếu có câu hỏi hoặc thông báo liên quan đến Điều khoản dịch vụ này, vui lòng liên hệ:',\n        s9Team: 'Đội ngũ phát triển GameVault',\n        footerCopy: '© 2026 GameVault. Lưu giữ kỷ niệm & thời gian chơi game bền vững.',\n        footerContact: 'Liên hệ'\n      },\n      en: {\n        docTitle: 'Terms of Service - GameVault',\n        navHome: 'Home',\n        navPrivacy: 'Privacy Policy',\n        navTerms: 'Terms of Service',\n        navLogin: 'Sign in / Profile',\n        navDownload: 'Download',\n        backPrev: 'Go back',\n        backShort: '← Back',\n        goHome: 'Back to GameVault Home →',\n        docBadge: 'Legal Document',\n        pageTitle: 'Terms of Service',\n        effectiveDate: 'Effective Date: November 23, 2026 | Last Updated: November 23, 2026',\n        s1Title: '1. Agreement to Terms',\n        s1P1: 'These Terms of Service constitute a legally binding agreement made between you (\"User\", \"you\") and <strong>GameVault</strong> (\"we\", \"us\", or \"our\"), concerning your access to and use of the GameVault application, website (<a href=\"https://gametracking.id.vn\" class=\"text-[#ff6b7d] hover:text-[#ff8594] underline\">https://gametracking.id.vn</a>), and related sync services.',\n        s1P2: 'By downloading, installing, accessing, or using GameVault, you confirm that you have read, understood, and agreed to be bound by all of these Terms of Service. If you do not agree, you are expressly prohibited from using the service.',\n        s2Title: '2. User Accounts & Google Authentication',\n        s2Intro: 'To utilize multi-device cloud synchronization and community features, you may authenticate via your Google Account. You agree to:',\n        s2L1: 'Maintain the security of your account credentials.',\n        s2L2: 'Promptly notify us if you discover or suspect any unauthorized access to your account.',\n        s2L3: 'Accept responsibility for all activities that occur under your authenticated account.',\n        s3Title: '3. Acceptable Use Policy',\n        s3Intro: 'You agree not to engage in any of the following prohibited activities:',\n        s3L1: 'Attempting to bypass, disable, or interfere with security-related features of GameVault.',\n        s3L2: 'Using automated scripts, bots, or scrapers to extract data or spam reviews/votes.',\n        s3L3: 'Submitting harassing, abusive, defamatory, or obscene content in game reviews or community discussions.',\n        s3L4: 'Manipulating playtime statistics or leaderboard standings fraudulently.',\n        s4Title: '4. Intellectual Property Rights',\n        s4P1: 'The GameVault software, branding, UI designs, and backend architecture are owned by the GameVault developers.',\n        s4P2: 'Third-party game names, logos, cover art, and trademarks referenced within GameVault are the property of their respective owners, publishers, and developers. GameVault is an independent organization and is not officially affiliated with Steam, Epic Games, GOG, or any respective game publisher.',\n        s5Title: '5. Termination',\n        s5P1: 'We reserve the right to suspend or terminate your access to GameVault cloud services at our sole discretion, without notice, for conduct that violates these Terms of Service or is harmful to other users or the service.',\n        s6Title: '6. Disclaimer of Warranties',\n        s6P1: 'GameVault is provided on an \"AS-IS\" and \"AS-AVAILABLE\" basis. To the fullest extent permitted by law, we disclaim all warranties, express or implied, in connection with the software and your use thereof, including fitness for a particular purpose or non-infringement.',\n        s7Title: '7. Limitation of Liability',\n        s7P1: 'In no event will GameVault or its developers be liable to you or any third party for any direct, indirect, consequential, exemplary, incidental, or special damages arising from your use of the application.',\n        s8Title: '8. Changes to Terms',\n        s8P1: 'We reserve the right to modify these Terms of Service at any time. We will indicate the \"Effective Date\" at the top of this document. Continued use of GameVault following any changes indicates your acceptance of the revised terms.',\n        s9Title: '9. Contact Information',\n        s9Intro: 'For questions or notices concerning these Terms of Service, please reach out to:',\n        s9Team: 'GameVault Development Team',\n        footerCopy: '© 2026 GameVault. Permanent Playtime & Gaming Memories.',\n        footerContact: 'Contact'\n      }\n    };\n\n    let currentLang = localStorage.getItem('gamevault.web.lang') === 'en' ? 'en' : 'vi';\n\n    function setLang(lang) {\n      currentLang = lang;\n      localStorage.setItem('gamevault.web.lang', lang);\n      document.documentElement.lang = lang;\n      const dict = i18n[lang];\n      if (dict.docTitle) document.title = dict.docTitle;\n      document.querySelectorAll('[data-i18n]').forEach((el) => {\n        const key = el.getAttribute('data-i18n');\n        if (dict[key]) el.textContent = dict[key];\n      });\n      document.querySelectorAll('[data-i18n-html]').forEach((el) => {\n        const key = el.getAttribute('data-i18n-html');\n        if (dict[key]) el.innerHTML = dict[key];\n      });\n      const viBtn = document.getElementById('btn-lang-vi');\n      const enBtn = document.getElementById('btn-lang-en');\n      if (lang === 'vi') {\n        viBtn.className = 'px-2.5 py-1 rounded-md text-xs font-bold transition-all bg-[#191d28] text-white shadow-sm';\n        enBtn.className = 'px-2.5 py-1 rounded-md text-xs font-bold transition-all text-slate-400 hover:text-white';\n      } else {\n        enBtn.className = 'px-2.5 py-1 rounded-md text-xs font-bold transition-all bg-[#191d28] text-white shadow-sm';\n        viBtn.className = 'px-2.5 py-1 rounded-md text-xs font-bold transition-all text-slate-400 hover:text-white';\n      }\n    }\n\n    setLang(currentLang);\n  </script>\n</body>\n</html>\n";

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
  <title>GameVault · Đăng nhập &amp; Hồ sơ</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <script src="https://accounts.google.com/gsi/client" async defer></script>
  <style>
    :root {
      --bg: #0c0e13;
      --panel: #13161f;
      --panel-2: #191d28;
      --border: rgba(255, 255, 255, 0.08);
      --border-hover: rgba(255, 255, 255, 0.16);
      --text: #f1f3f7;
      --muted: #94a3b8;
      --accent: #ff2a44;
      --accent-hover: #e11d48;
      --accent-soft: rgba(255, 42, 68, 0.15);
      --accent-text: #ff6b7d;
      --accent-2: #38bdf8;
      --ok: #10b981;
      --warn: #f59e0b;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; }
    html { color-scheme: dark; }
    body {
      margin: 0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background:
        radial-gradient(ellipse 75% 45% at 50% 0%, rgba(255, 42, 68, 0.16) 0%, rgba(14, 165, 233, 0.06) 45%, rgba(12, 14, 19, 0) 75%),
        var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      -webkit-font-smoothing: antialiased;
    }
    ::selection { background: rgba(255, 42, 68, 0.35); color: #fff; }
    .topbar-shell {
      position: sticky;
      top: 0;
      z-index: 50;
      background: rgba(12, 14, 19, 0.85);
      backdrop-filter: blur(14px);
      border-bottom: 1px solid var(--border);
    }
    .topbar {
      max-width: 1180px;
      margin: 0 auto;
      padding: 0 20px;
      min-height: 64px;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
    }
    .wrap { max-width: 1180px; width: 100%; margin: 0 auto; padding: 24px 20px 56px; flex: 1; }
    .brand { display: flex; align-items: center; gap: 12px; text-decoration: none; color: inherit; }
    .logo {
      width: 36px; height: 36px; border-radius: 10px;
      background: linear-gradient(135deg, #ff2a44, #be123c);
      display: grid; place-items: center; font-weight: 900; color: #fff; font-size: 14px;
      box-shadow: 0 6px 18px rgba(255, 42, 68, 0.32);
    }
    .brand-title-row { display: flex; align-items: center; gap: 6px; }
    .title { font-size: 16px; font-weight: 800; letter-spacing: 0.4px; margin: 0; color: #fff; }
    .pro-badge {
      font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 6px;
      background: var(--accent-soft); color: #ff5c70; border: 1px solid rgba(255, 42, 68, 0.35);
    }
    .subtitle { font-size: 11px; color: var(--muted); margin: 2px 0 0; }
    .nav-links { display: flex; align-items: center; gap: 18px; }
    .nav-links a {
      font-size: 13px; font-weight: 600; color: var(--muted); text-decoration: none; transition: color 0.15s;
    }
    .nav-links a:hover { color: #fff; }
    @media (max-width: 820px) { .nav-links { display: none; } }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .pill {
      display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px;
      border-radius: 10px; font-size: 12px; font-weight: 600;
      background: var(--panel-2); border: 1px solid var(--border); color: var(--text);
      text-decoration: none; cursor: pointer; transition: 0.15s all;
    }
    .pill:hover { border-color: var(--border-hover); background: #222736; color: #fff; }
    .pill-accent {
      background: var(--accent); border-color: var(--accent); color: #fff;
      box-shadow: 0 4px 14px rgba(255, 42, 68, 0.3);
    }
    .pill-accent:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
    button, .btn {
      cursor: pointer; border: 1px solid var(--border); background: var(--panel-2); color: var(--text);
      padding: 8px 14px; border-radius: 10px; font-size: 13px; font-weight: 600;
      transition: 0.15s border-color, 0.15s background;
    }
    button:hover, .btn:hover { border-color: var(--border-hover); background: #222736; }
    .btn-primary {
      background: var(--accent); border-color: var(--accent); color: #fff;
      box-shadow: 0 4px 14px rgba(255, 42, 68, 0.28);
    }
    .btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
    .tabs { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
    .tab {
      padding: 9px 16px; border-radius: 10px; border: 1px solid var(--border);
      background: var(--panel); color: var(--muted); font-weight: 600; font-size: 13px;
    }
    .tab:hover { color: #fff; border-color: var(--border-hover); }
    .tab.active {
      background: var(--accent); border-color: var(--accent); color: #fff;
      box-shadow: 0 4px 14px rgba(255, 42, 68, 0.28);
    }
    .hero {
      background: linear-gradient(135deg, rgba(255, 42, 68, 0.14), rgba(14, 165, 233, 0.06));
      border: 1px solid rgba(255, 42, 68, 0.25); border-radius: 18px; padding: 24px; margin-bottom: 18px;
    }
    .hero h2 { margin: 0 0 8px; font-size: 24px; color: #fff; }
    .hero p { margin: 0; color: var(--muted); line-height: 1.6; max-width: 760px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
    .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    @media (max-width: 920px) { .grid-4 { grid-template-columns: repeat(2, 1fr); } .grid-3, .grid-2 { grid-template-columns: 1fr; } }
    @media (max-width: 540px) { .grid-4 { grid-template-columns: 1fr; } }
    .card {
      background: var(--panel); border: 1px solid var(--border); border-radius: 16px; padding: 22px;
    }
    .card h3 { margin: 0 0 14px; font-size: 16px; font-weight: 700; display: flex; align-items: center; justify-content: space-between; color: #fff; }
    .metric-label { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
    .metric-val { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; color: #fff; }
    .metric-sub { font-size: 12px; color: var(--muted); margin-top: 6px; }
    .bar { height: 7px; border-radius: 999px; background: #090b10; overflow: hidden; margin-top: 10px; border: 1px solid var(--border); }
    .bar > i { display: block; height: 100%; background: var(--accent); transition: width 0.3s ease; }
    .bar.warn > i { background: var(--warn); }
    .bar.danger > i { background: var(--danger); }
    .bar.ok > i { background: var(--ok); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); display: inline-block; }
    .dot.ok { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
    .dot.bad { background: var(--danger); }
    .section { margin-top: 18px; }
    .input {
      width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border);
      background: #090b10; color: var(--text); font-size: 13px;
    }
    .row { display: flex; gap: 8px; align-items: center; }
    .muted { color: var(--muted); font-size: 13px; }
    .list { display: flex; flex-direction: column; gap: 10px; }
    .item {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 11px 14px; border-radius: 12px; background: var(--panel-2); border: 1px solid var(--border);
    }
    .item-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .thumb { width: 38px; height: 50px; border-radius: 6px; object-fit: cover; background: #090b10; flex-shrink: 0; }
    .avatar { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; border: 2px solid var(--accent); background: #090b10; }
    .truncate { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .badge {
      font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 999px;
      background: var(--accent-soft); color: var(--accent-text); border: 1px solid rgba(255, 42, 68, 0.35);
    }
    .badge.ok { background: rgba(16,185,129,0.14); color: #6ee7b7; border-color: rgba(16,185,129,0.35); }
    .notice {
      padding: 12px 14px; border-radius: 12px; background: rgba(245,158,11,0.08);
      border: 1px solid rgba(245,158,11,0.3); font-size: 13px; line-height: 1.5;
    }
    .hidden { display: none !important; }
    code { background: #090b10; padding: 2px 6px; border-radius: 5px; font-size: 12px; }
    .login-box {
      background: linear-gradient(180deg, rgba(255, 42, 68, 0.08), rgba(19, 22, 31, 0.4));
      border: 1px solid rgba(255, 42, 68, 0.28);
      border-radius: 18px; padding: 28px 24px; max-width: 560px; margin: 12px auto;
    }
    .gv-footer {
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      background: var(--bg);
      padding: 24px 20px;
      color: #64748b;
      font-size: 13px;
    }
    .gv-footer-inner {
      max-width: 1180px; margin: 0 auto;
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px;
    }
    .gv-footer-links { display: flex; flex-wrap: wrap; gap: 18px; }
    .gv-footer-links a { color: #64748b; text-decoration: none; transition: color 0.15s; }
    .gv-footer-links a:hover { color: #cbd5e1; }
  </style>
</head>
<body>
  <header class="topbar-shell">
    <div class="topbar">
      <a href="/" class="brand">
        <div class="logo">GV</div>
        <div>
          <div class="brand-title-row">
            <h1 class="title">GAMEVAULT</h1>
            <span class="pro-badge">PRO</span>
          </div>
          <p class="subtitle">Permanent Playtime &amp; Media</p>
        </div>
      </a>

      <nav class="nav-links" aria-label="Primary">
        <a href="/">Trang chủ</a>
        <a href="${apiUrl}/community/" target="_blank" rel="noreferrer">Cộng đồng ↗</a>
        <a href="/privacy">Bảo mật</a>
        <a href="/terms">Điều khoản</a>
      </nav>

      <div class="actions">
        <a class="pill" href="/">← Trang chủ</a>
        <button id="topbar-login-btn" class="pill pill-accent" onclick="switchTab('profile')">Đăng nhập</button>
        <a id="admin-portal-link" class="pill hidden" href="${apiUrl}/admin/" target="_blank" rel="noreferrer">Admin Covers ↗</a>
        <button id="logout-btn" class="pill hidden">Đăng xuất</button>
      </div>
    </div>
  </header>

  <div class="wrap">
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
              <div style="width: 48px; height: 48px; border-radius: 14px; background: rgba(255,42,68,0.16); border: 1px solid rgba(255,42,68,0.35); color: #ff6b7d; display: inline-grid; place-items: center; font-size: 20px; margin-bottom: 12px;">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
              </div>
              <h2 style="margin: 0 0 8px; font-size: 20px; font-weight: 800; color: #fff;">Đăng nhập tài khoản GameVault</h2>
              <p class="muted" style="margin: 0; font-size: 13px; line-height: 1.55;">Đăng nhập bằng tài khoản Google đã liên kết với app GameVault để xem nhanh thư viện game, số giờ chơi và cấu hình PC.</p>
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

  <footer class="gv-footer">
    <div class="gv-footer-inner">
      <div>© 2026 GameVault. Lưu giữ kỷ niệm &amp; thời gian chơi game bền vững.</div>
      <div class="gv-footer-links">
        <a href="/">Trang chủ</a>
        <a href="/#download">Tải về</a>
        <a href="/privacy">Bảo mật</a>
        <a href="/terms">Điều khoản</a>
        <a href="mailto:son62320@gmail.com">Liên hệ</a>
      </div>
    </div>
  </footer>

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
