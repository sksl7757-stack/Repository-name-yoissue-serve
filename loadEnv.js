// loadEnv.js — .env 수동 파싱 공통 유틸
// select-news.js, poll-and-generate.js에서 공유 사용
// dotenvx 암호화 우회용. 파일 없으면 process.env(GitHub Secrets) 사용.

const path = require('path');
const fs   = require('fs');

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.log('.env 파일 없음 — process.env(GitHub Secrets) 사용');
    return;
  }
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    // 따옴표 제거 후 인라인 주석(# ...) 제거
    const raw = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    const val = raw.replace(/\s+#.*$/, '').trim();
    if (key) process.env[key] = val;
  });
}

module.exports = { loadEnv };
