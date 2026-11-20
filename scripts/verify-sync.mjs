import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function checkResponse(result) {
  if (!result?.ok) {
    const error = Error(result?.error || 'Google 回傳失敗');
    error.code = result?.code;
    throw error;
  }
  if (!Number.isSafeInteger(result.version) || result.version < 0) throw Error('Google 回傳的版本無效');
  return result;
}

function checkSnapshot(result) {
  checkResponse(result);
  const state = result.state;
  if (state !== null && (!state || typeof state.started !== 'boolean' || !['transactions', 'recurring', 'settlements'].every(key => Array.isArray(state[key])))) throw Error('Google 回傳的帳本格式無效');
  return result;
}

async function removeProbe(call, key, token) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = checkSnapshot(await call('pull'));
    if (!current.state || !Object.hasOwn(current.state, key)) return;
    if (current.state[key] !== token) throw Error('驗證標記已被改動，停止清理以保留其他資料');
    const next = structuredClone(current.state);
    delete next[key];
    const result = await call('push', { expectedVersion: current.version, state: next });
    if (result.code === 'CONFLICT') continue;
    checkResponse(result);
    const after = checkSnapshot(await call('pull'));
    if (!after.state || !Object.hasOwn(after.state, key)) return;
  }
  throw Error('其他裝置持續修改帳本，驗證標記尚未清除');
}

/** A probe adds only temporary metadata, never transactions, amounts or budget changes. */
export async function verifySync(call, { write = false } = {}) {
  let snapshot = checkSnapshot(await call('pull'));
  const summary = {
    read: true, write: false, readBack: false, cleaned: false,
    version: snapshot.version,
    transactions: snapshot.state?.transactions.length || 0,
    recurring: snapshot.state?.recurring.length || 0,
    settlements: snapshot.state?.settlements.length || 0
  };
  if (!write) return summary;
  const token = randomUUID();
  const key = '__sync_verify_' + token.replaceAll('-', '');
  let attempted = false;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const month = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' }).format(new Date());
      const state = structuredClone(snapshot.state || { started: false, startMonth: month, budget: 3000000, transactions: [], recurring: [], settlements: [] });
      state[key] = token;
      attempted = true;
      const result = await call('push', { expectedVersion: snapshot.version, state });
      if (result.code === 'CONFLICT') { snapshot = checkSnapshot(await call('pull')); continue; }
      checkResponse(result);
      summary.write = true;
      const readBack = checkSnapshot(await call('pull'));
      if (readBack.version < result.version || readBack.state?.[key] !== token) throw Error('已收到寫入回應，但無法讀回驗證標記');
      summary.readBack = true;
      break;
    }
    if (!summary.readBack) throw Error('其他裝置持續修改帳本，尚未完成寫入驗證');
  } finally {
    // Also clean up if a successful write was followed by a lost or invalid response.
    if (attempted) {
      try { await removeProbe(call, key, token); summary.cleaned = true; }
      catch (error) { throw Error('驗證清理未完成（標記 ' + key + '）：' + error.message); }
    }
  }
  return summary;
}

function curlJson(url, body) {
  const args = ['-sS', '-L', '--max-time', '30', '--fail-with-body', '-w', '\n%{http_code}'];
  if (body) args.push('-H', 'Content-Type: text/plain;charset=utf-8', '--data-binary', '@-');
  args.push(url);
  // Inherit the managed proxy and TLS trust. Never disable certificate verification.
  const result = spawnSync('curl', args, { input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('HTTPS 請求失敗：' + (result.stderr || 'curl exit ' + result.status).trim());
  const end = result.stdout.lastIndexOf('\n');
  const status = Number(result.stdout.slice(end + 1));
  if (status !== 200) throw Error('HTTPS 回傳 HTTP ' + status);
  try { return JSON.parse(result.stdout.slice(0, end)); }
  catch { throw Error('回應不是 JSON；請確認 Apps Script 部署允許「任何人」存取，並已更新正確程式版本'); }
}

async function main() {
  const config = JSON.parse(await readFile(new URL('../cloud-config.json', import.meta.url), 'utf8'));
  const endpoint = new URL(config.url);
  if (endpoint.origin !== 'https://script.google.com' || !/^\/macros\/s\/[\w-]+\/exec$/.test(endpoint.pathname) || endpoint.search || endpoint.hash) throw Error('Apps Script 部署網址無效');
  const write = process.argv.includes('--write');
  const result = await verifySync((action, payload = {}) => Promise.resolve(curlJson(config.url, { action, ...payload })), { write });
  console.log(JSON.stringify(result)); // Counts and outcomes only; no account contents.
  if (process.argv.includes('--site')) {
    const published = curlJson('https://angela6711.github.io/angela1113-1/cloud-config.json');
    if (published.url !== config.url || published.spreadsheetId !== config.spreadsheetId) throw Error('GitHub Pages 尚未發布目前的 Google 連線設定');
    console.log('Published website configuration PASS');
  }
  console.log(write ? 'Google Sheets write/read-back/cleanup PASS' : 'Google Sheets read PASS (write not tested)');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
