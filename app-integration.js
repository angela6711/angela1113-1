(function () {
  'use strict';
  let timer, installPrompt, registration;
  const labels = { disconnected: '尚未連線', pending: '本機已儲存，等待同步', syncing: '正在同步 Google Sheets…', synced: '已同步 Google Sheets', conflict: '需要處理版本衝突', error: '同步失敗；本機資料仍保留' };
  const cloud = new LedgerCloud({
    storage: localStorage,
    getState: () => JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null') || initialState(),
    setState: async value => {
      if (!value || typeof value.started !== 'boolean' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.startMonth) || !Number.isSafeInteger(value.budget) || !['transactions', 'recurring', 'settlements'].every(key => Array.isArray(value[key]))) throw Error('雲端帳本格式無效，本機資料未變更');
      localStorage.setItem(LOCAL_KEY, JSON.stringify(value));
      await load();
    },
    notify: () => {
      const banner = document.querySelector('#connection-status');
      if (banner) banner.textContent = cloud.config ? '公開共用 · 任何人可編輯｜' + labels[cloud.status] : '本機帳本 · 尚未連接 Google Sheets';
      if (tab === 'settings' && !$('#modal').open) render();
      const status = document.querySelector('#cloud-status');
      if (status) { status.textContent = labels[cloud.status]; status.title = cloud.message || ''; }
    }
  });
  window.ledgerCloud = cloud;
  function schedule() {
    clearTimeout(timer);
    if (cloud.config && cloud.status !== 'conflict') timer = setTimeout(() => { if (!$('#modal').open) cloud.sync(); }, 1200);
  }
  const changed = cloud.changed.bind(cloud);
  cloud.changed = () => { changed(); schedule(); };
  const originalSettings = renderSettings;
  renderSettings = function () {
    const configured = Boolean(cloud.config);
    const busy = cloud.running ? 'disabled' : '';
    return `<section class="card cloud-card"><div class="section-head"><h2>Google Sheets 公開共用帳本</h2><span class="tiny-tag" id="cloud-status" role="status">${esc(labels[cloud.status])}</span></div>
      <p class="subtext">任何訪客都可查看、新增、修改及刪除這份共用帳本。離線先儲存在裝置，連線後同步。</p>
      ${siteSpreadsheetId ? `<p class="save-message">帳目目的地：<a href="https://docs.google.com/spreadsheets/d/${esc(siteSpreadsheetId)}/edit" target="_blank" rel="noopener noreferrer">開啟指定 Google 試算表 ↗</a>（需完成部署後才會同步）</p>` : ''}
      ${cloud.message ? `<p class="form-error" role="alert">${esc(cloud.message)}</p>` : ''}
      ${configured ? `<p class="save-message">${cloud.config.lastSync ? '上次同步：' + esc(new Date(cloud.config.lastSync).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })) : '尚未完成首次同步'}</p>
        <button class="primary wide" onclick="syncLedger()" ${busy}>${icon('cloud')}立即同步</button>
        <button class="secondary wide" onclick="copyLedgerConnection()" ${busy}>複製共用帳本網址</button><p class="save-message">用同一個網址在其他手機或電腦開啟，就能存取同一份公開帳本。</p>
        ${cloud.status === 'conflict' ? `<div class="notice"><span>選擇前請先下載完整 JSON 備份。選擇會取代另一份帳本，不會自動合併。</span></div><button class="secondary wide" onclick="resolveLedger('cloud')" ${busy}>以試算表版本取代本機</button><button class="secondary wide" onclick="resolveLedger('local')" ${busy}>以本機版本取代試算表</button>` : ''}
        <button class="inline-button" onclick="disconnectLedger()" ${busy}>中斷連線（保留本機與試算表資料）</button>` : `<form id="cloud-form" onsubmit="connectLedger(event)">
        <label class="field">Apps Script 網頁應用程式網址<input id="cloud-url" required type="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec"></label>
        <p class="save-message">首次連線時，空白試算表會接收本機帳本；若兩邊已有資料，會先詢問保留哪一份。</p>
        <button class="primary wide" type="submit">連線公開共用帳本</button></form>`}
      <p class="save-message"><a href="./setup.html" target="_blank" rel="noopener">建立共用帳本與部署步驟 ↗</a></p>
    </section><section class="card"><h2>安裝到手機主畫面</h2><p class="subtext">${window.matchMedia('(display-mode: standalone)').matches ? '目前已使用 App 模式。' : 'iPhone：Safari 分享 → 加入主畫面。Android／電腦：使用瀏覽器的安裝選項。第一次開啟需要網路。'}</p>
    ${installPrompt ? '<button class="primary" onclick="installLedger()">安裝想飛記帳本</button>' : ''}
    ${registration?.waiting ? '<button class="secondary" onclick="updateLedger()">套用新版並重新開啟</button>' : ''}</section>` + originalSettings();
  };
  window.connectLedger = async e => {
    e.preventDefault();
    try { cloud.configure($('#cloud-url').value.trim()); await cloud.sync(); }
    catch (error) { toast(error.message); }
    if (tab === 'settings') render();
  };
  window.syncLedger = () => cloud.sync();
  window.copyLedgerConnection = async () => {
    if (!cloud.config) return;
    const url = new URL('./', location.href);
    if (cloud.config.url !== siteEndpoint) url.hash = 'connect=' + btoa(JSON.stringify({ url: cloud.config.url }));
    try { await navigator.clipboard.writeText(url.href); toast('已複製共用帳本網址'); }
    catch { toast('瀏覽器未允許複製，請在 HTTPS 環境再試一次'); }
  };
  window.resolveLedger = async resolution => {
    if (!confirm(resolution === 'cloud' ? '確定以試算表資料取代本機帳本？請先下載本機備份。' : '確定以本機資料取代試算表帳本？其他裝置尚未同步的變更可能不同。')) return;
    await cloud.sync(resolution);
  };
  window.disconnectLedger = () => {
    try { cloud.disconnect(); clearTimeout(timer); render(); } catch (error) { toast(error.message); }
  };
  window.installLedger = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    if (tab === 'settings') render();
  };
  window.updateLedger = () => registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; if (tab === 'settings') render(); });
  window.addEventListener('appinstalled', () => { installPrompt = null; if (tab === 'settings') render(); });
  window.addEventListener('online', schedule);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#modal').open) schedule(); });
  // Pull other devices' changes even when this device has no pending edits.
  setInterval(() => { if (cloud.config && !document.hidden) schedule(); }, 30000);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').then(value => {
      registration = value;
      if (tab === 'settings') render();
      value.addEventListener('updatefound', () => value.installing?.addEventListener('statechange', () => { if (tab === 'settings') render(); }));
    }).catch(() => toast('離線快取未啟用；目前仍可在線上使用'));
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!refreshing) { refreshing = true; location.reload(); } });
  }
  function connectFromUrl() {
    if (!location.hash.startsWith('#connect=')) return;
    const encoded = location.hash.slice(9);
    // Remove connection parameters from the address bar after reading them.
    history.replaceState(null, '', location.pathname + location.search);
    try {
      if (encoded.length > 3000) throw Error('連線網址無效');
      const incoming = JSON.parse(atob(encoded));
      if (!cloud.config || cloud.config.url !== incoming.url) {
        if (!cloud.config || confirm('此連線網址使用另一份雲端帳本。要切換嗎？本機帳本會保留，首次同步時可選擇版本。')) cloud.configure(incoming.url);
      }
    } catch { toast('共用帳本網址無效，請重新複製完整網址'); }
  }
  window.addEventListener('hashchange', () => { connectFromUrl(); schedule(); });
  connectFromUrl();
  let siteEndpoint = '';
  let siteSpreadsheetId = '';
  // A published endpoint connects every visitor using the ordinary site URL.
  fetch('./cloud-config.json', { cache: 'no-store' }).then(response => {
    if (!response.ok) throw Error('未讀取網站連線設定');
    return response.json();
  }).then(config => {
    if (typeof config.spreadsheetId === 'string' && /^[A-Za-z0-9_-]+$/.test(config.spreadsheetId)) siteSpreadsheetId = config.spreadsheetId;
    if (typeof config.url === 'string' && config.url) {
      siteEndpoint = config.url;
      if (!cloud.config || cloud.config.url !== siteEndpoint) cloud.configure(siteEndpoint);
    }
    if (tab === 'settings') render();
  }).catch(() => {}).finally(schedule);
})();
