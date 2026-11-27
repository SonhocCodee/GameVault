const fs = require('fs');
const path = require('path');

const svgIcon16 = `<svg class="w-4 h-4 shrink-0 inline-block" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
const svgIcon20 = `<svg class="w-5 h-5 shrink-0 inline-block" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
const svgBack14 = `<svg class="w-3.5 h-3.5 inline-block" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>`;
const svgBack16 = `<svg class="w-4 h-4 inline-block" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>`;

// --- 1. public-web/index.html is maintained directly ---
console.log('Skipped overwriting public-web/index.html');


// --- 2. UPDATE public-web/privacy.html ---
let privHtml = fs.readFileSync('public-web/privacy.html', 'utf8');

// Replace header nav
privHtml = privHtml.replace(
  /<nav class="flex items-center gap-5 text-sm font-medium text-slate-300">[\s\S]*?<\/nav>/,
`<nav class="flex items-center gap-4 text-sm font-medium text-slate-300">
        <a href="/" onclick="if (window.history.length > 1) { window.history.back(); return false; }" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors">
          ${svgBack14}
          <span>Quay lại</span>
        </a>
        <a href="/" class="hover:text-white transition-colors">Trang chủ</a>
        <a href="/terms" class="hover:text-white transition-colors">Terms of Service</a>
        <a href="/dashboard?tab=profile" class="hover:text-white transition-colors text-indigo-400">Đăng nhập</a>
        <a href="/#download" class="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-all shadow-md shadow-indigo-600/30 flex items-center gap-1.5">
          ${svgIcon16}
          <span>Download</span>
        </a>
      </nav>`
);

// Add top Back link before document title if not present
if (!privHtml.includes('Quay lại trang trước')) {
  privHtml = privHtml.replace(
    '<main class="flex-1 max-w-4xl mx-auto px-6 py-12">',
    `<main class="flex-1 max-w-4xl mx-auto px-6 py-12">
    <div class="mb-6">
      <a href="/" onclick="if (window.history.length > 1) { window.history.back(); return false; }" class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-indigo-400 hover:text-indigo-300 text-sm font-medium border border-slate-800 transition-colors">
        ${svgBack16}
        <span>Quay lại trang trước</span>
      </a>
    </div>`
  );
}

// Add bottom navigation before </main>
if (!privHtml.includes('Về Trang chủ GameVault')) {
  privHtml = privHtml.replace(
    '</main>',
    `  <div class="mt-12 pt-6 border-t border-slate-800/80 flex items-center justify-between">
      <a href="/" onclick="if (window.history.length > 1) { window.history.back(); return false; }" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition-colors">
        ← Quay lại
      </a>
      <a href="/" class="text-sm text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
        Về Trang chủ GameVault →
      </a>
    </div>
  </main>`
  );
}
fs.writeFileSync('public-web/privacy.html', privHtml);
console.log('Updated public-web/privacy.html');


// --- 3. UPDATE public-web/terms.html ---
let termsHtml = fs.readFileSync('public-web/terms.html', 'utf8');

// Replace header nav
termsHtml = termsHtml.replace(
  /<nav class="flex items-center gap-5 text-sm font-medium text-slate-300">[\s\S]*?<\/nav>/,
`<nav class="flex items-center gap-4 text-sm font-medium text-slate-300">
        <a href="/" onclick="if (window.history.length > 1) { window.history.back(); return false; }" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors">
          ${svgBack14}
          <span>Quay lại</span>
        </a>
        <a href="/" class="hover:text-white transition-colors">Trang chủ</a>
        <a href="/privacy" class="hover:text-white transition-colors">Privacy Policy</a>
        <a href="/dashboard?tab=profile" class="hover:text-white transition-colors text-indigo-400">Đăng nhập</a>
        <a href="/#download" class="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-all shadow-md shadow-indigo-600/30 flex items-center gap-1.5">
          ${svgIcon16}
          <span>Download</span>
        </a>
      </nav>`
);

// Add top Back link before document title if not present
if (!termsHtml.includes('Quay lại trang trước')) {
  termsHtml = termsHtml.replace(
    '<main class="flex-1 max-w-4xl mx-auto px-6 py-12">',
    `<main class="flex-1 max-w-4xl mx-auto px-6 py-12">
    <div class="mb-6">
      <a href="/" onclick="if (window.history.length > 1) { window.history.back(); return false; }" class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-indigo-400 hover:text-indigo-300 text-sm font-medium border border-slate-800 transition-colors">
        ${svgBack16}
        <span>Quay lại trang trước</span>
      </a>
    </div>`
  );
}

// Add bottom navigation before </main>
if (!termsHtml.includes('Về Trang chủ GameVault')) {
  termsHtml = termsHtml.replace(
    '</main>',
    `  <div class="mt-12 pt-6 border-t border-slate-800/80 flex items-center justify-between">
      <a href="/" onclick="if (window.history.length > 1) { window.history.back(); return false; }" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition-colors">
        ← Quay lại
      </a>
      <a href="/" class="text-sm text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
        Về Trang chủ GameVault →
      </a>
    </div>
  </main>`
  );
}
fs.writeFileSync('public-web/terms.html', termsHtml);
console.log('Updated public-web/terms.html');
