const fs = require('fs');

// Execute update_pages first
require('./update_pages.cjs');

const HOME_HTML = fs.readFileSync('public-web/index.html', 'utf8');
const PRIVACY_HTML = fs.readFileSync('public-web/privacy.html', 'utf8');
const TERMS_HTML = fs.readFileSync('public-web/terms.html', 'utf8');

const workerScript = `const HOME_HTML = ${JSON.stringify(HOME_HTML)};
const PRIVACY_HTML = ${JSON.stringify(PRIVACY_HTML)};
const TERMS_HTML = ${JSON.stringify(TERMS_HTML)};

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
  const res = await fetchJsonWithTiming(\`\${apiUrl}/api/admin/me\`, {
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
    Authorization: \`Bearer \${cfToken}\`,
    'Content-Type': 'application/json',
  };

  const d1Promise = fetchJsonWithTiming(
    \`https://api.cloudflare.com/client/v4/accounts/\${accountId}/d1/database/\${d1Id}\`,
    { headers }
  );

  const now = new Date();
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const until = now.toISOString();
  const gqlQuery = {
    query: \`query($accountTag: string!, $since: Time!, $until: Time!, $scriptName: string!) {
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
    }\`,
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
  const d1Error = !d1 ? (d1Res.data?.errors?.[0]?.message || d1Res.error || \`HTTP \${d1Res.status}\`) : null;

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
    workerError = gqlRes.data?.errors?.[0]?.message || gqlRes.error || \`HTTP \${gqlRes.status}\`;
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
  return \`<!DOCTYPE html>
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
        <a href="\${apiUrl}/community/" target="_blank" rel="noreferrer">Cộng đồng ↗</a>
        <a href="/privacy">Bảo mật</a>
        <a href="/terms">Điều khoản</a>
      </nav>

      <div class="actions">
        <a class="pill" href="/">← Trang chủ</a>
        <button id="topbar-login-btn" class="pill pill-accent" onclick="switchTab('profile')">Đăng nhập</button>
        <a id="admin-portal-link" class="pill hidden" href="\${apiUrl}/admin/" target="_blank" rel="noreferrer">Admin Covers ↗</a>
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
    const API_URL = \${JSON.stringify(apiUrl)};
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
</html>\`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const apiUrl = (env.GAMEVAULT_API_URL || DEFAULT_API_URL).replace(/\\/+$/, '');
    const accountId = env.CF_ACCOUNT_ID || DEFAULT_CF_ACCOUNT_ID;
    const d1Id = env.CF_D1_ID || DEFAULT_CF_D1_ID;
    const workerName = env.CF_WORKER_NAME || DEFAULT_CF_WORKER_NAME;

    if (url.pathname === '/api/public-summary') {
      const [gamesRes, playersRes] = await Promise.all([
        fetchJsonWithTiming(\`\${apiUrl}/api/community/rankings?limit=6\`),
        fetchJsonWithTiming(\`\${apiUrl}/api/community/players?limit=5&sort=hours\`),
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
        fetchJsonWithTiming(\`\${apiUrl}/api/health\`),
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
`;

fs.writeFileSync('GameVault/status-worker/index.js', workerScript);
console.log('Successfully bundled GameVault/status-worker/index.js. Length:', workerScript.length);
