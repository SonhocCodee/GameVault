// Rebuild the small, shared static catalogue. No image bytes are stored per user.
import fs from "node:fs/promises";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "lucide-react";
import { AVATAR_PRESETS, BANNER_PRESETS } from "../src/shared/profile-presets.ts";

const palettes = [
  ["#112c36", "#2dd4bf", "#818cf8"], ["#231d38", "#c4b5fd", "#fb7185"],
  ["#351e26", "#fb923c", "#fbbf24"], ["#102b40", "#38bdf8", "#2563eb"],
  ["#192c3c", "#a5f3fc", "#60a5fa"], ["#15342c", "#6ee7b7", "#059669"],
  ["#2c1c42", "#c084fc", "#6366f1"], ["#202f24", "#bef264", "#22c55e"],
  ["#382139", "#f0abfc", "#fb7185"], ["#3a2821", "#fdba74", "#fb7185"],
  ["#211b42", "#818cf8", "#e879f9"], ["#172e3e", "#7dd3fc", "#22d3ee"],
  ["#30203b", "#f472b6", "#a78bfa"], ["#112e38", "#22d3ee", "#14b8a6"],
  ["#392e24", "#fcd34d", "#d97706"], ["#243139", "#cbd5e1", "#38bdf8"],
  ["#322a40", "#fda4af", "#818cf8"], ["#292145", "#a78bfa", "#2dd4bf"],
  ["#351d2f", "#fb7185", "#f472b6"], ["#1b2c3e", "#60a5fa", "#c4b5fd"],
];
const root = path.resolve("public/profile-presets");
await fs.mkdir(path.join(root, "avatars"), { recursive: true });
await fs.mkdir(path.join(root, "banners"), { recursive: true });
for (const [i, preset] of AVATAR_PRESETS.entries()) {
  const [bg, ink, accent] = palettes[i];
  const icon = renderToStaticMarkup(React.createElement(icons[preset.icon], {
    x: 28, y: 28, width: 72, height: 72, color: ink, strokeWidth: 1.7,
  }));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="${bg}"/><circle cx="112" cy="16" r="40" fill="${accent}" opacity=".14"/><path d="M0 102h30l26 26H0" fill="${ink}" opacity=".1"/>${icon}</svg>`;
  await fs.writeFile(path.join(root, "avatars", `${preset.id}.svg`), svg, "utf8");
}
for (const [i, preset] of BANNER_PRESETS.entries()) {
  const [bg, ink, accent] = palettes[i];
  // Abstract geometry with a quiet left edge for the profile identity.
  const motifs = [
    `<path d="M260 280C430 190 520 10 790 20s290 160 490 30v270H260Z" fill="${accent}" opacity=".3"/><path d="M360 320C640 260 650 60 900 70s240 150 380 90v160Z" fill="${ink}" opacity=".32"/><path d="M520 320C760 220 870 120 1280 230v90Z" fill="${ink}" opacity=".3"/>`,
    `<circle cx="940" cy="154" r="230" fill="none" stroke="${accent}" stroke-width="70" opacity=".28"/><circle cx="940" cy="154" r="144" fill="none" stroke="${ink}" stroke-width="2" opacity=".8"/><circle cx="940" cy="154" r="90" fill="${ink}" opacity=".24"/>`,
    `<path d="m570 320 240-320h125L695 320Zm230 0L1040 0h80L880 320Z" fill="${ink}" opacity=".32"/><path d="m920 320 240-320h120v320Z" fill="${accent}" opacity=".3"/><path d="m640 320 240-320" stroke="${ink}" stroke-width="2" opacity=".8"/>`,
    `<path d="M480 320 760 40l280 280ZM760 320 1010 70l270 250Z" fill="${accent}" opacity=".38"/><path d="m690 320 220-220 220 220Z" fill="${ink}" opacity=".3"/><path d="m758 44 282 276" stroke="${ink}" stroke-width="2" opacity=".65"/>`,
    `<path d="M480 240H640V130H800V200H960V60H1280" fill="none" stroke="${accent}" stroke-width="36" opacity=".25"/><path d="M580 280H740V170H900V240H1060V100H1280" fill="none" stroke="${ink}" stroke-width="3" opacity=".7"/><circle cx="740" cy="170" r="9" fill="${ink}"/><circle cx="1060" cy="100" r="9" fill="${ink}"/>`,
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 320"><rect width="1280" height="320" fill="${bg}"/>${motifs[i % motifs.length]}</svg>`;
  await fs.writeFile(path.join(root, "banners", `${preset.id}.svg`), svg, "utf8");
}
await fs.copyFile("node_modules/lucide-react/LICENSE", path.join(root, "LUCIDE-LICENSE.txt"));
console.log(`Generated ${AVATAR_PRESETS.length} avatars and ${BANNER_PRESETS.length} banners.`);
