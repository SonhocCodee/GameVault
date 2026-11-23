const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/MacPro/AppData/Roaming/game-vault/gamevault.db');
const rows = db.prepare('SELECT id, title, cover_url, banner_url, playtime_minutes FROM games ORDER BY playtime_minutes DESC').all();
for (const r of rows) {
  console.log(`[ID ${r.id}] ${r.title} (${(r.playtime_minutes/60).toFixed(1)}h):`);
  console.log(`  cover_url: ${r.cover_url}`);
  console.log(`  banner_url: ${r.banner_url}`);
}
