/** Deploy this file as a standalone Google Apps Script web app (execute as owner).
 * Run setup once while signed into the Google account that will own the private sheet.
 * Connection keys live only in that private sheet, Script Properties and the user's device.
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SPREADSHEET_ID')) {
    const existing = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
    console.log(existing.getUrl());
    return existing.getUrl();
  }
  const book = SpreadsheetApp.create('想飛記帳本');
  const key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const config = book.getSheets()[0];
  config.setName('連線設定');
  config.getRange(1, 1, 4, 2).setValues([
    ['項目', '內容'], ['連線金鑰（請勿分享）', key],
    ['使用方式', '部署 Apps Script 網頁應用程式後，在記帳 App 設定填入 /exec 網址與上方金鑰'],
    ['注意', '試算表保持私人。請透過 App 編輯帳目；明細分頁是檢視用，直接改儲存格不會回寫 App。']
  ]);
  for (const name of ['帳本資料', '交易明細', '固定支出', '月結報表']) book.insertSheet(name);
  book.getSheetByName('帳本資料').getRange(1, 1, 1, 3).setValues([[0, 0, '']]);
  props.setProperties({ SPREADSHEET_ID: book.getId(), KEY_HASH: hashKey_(key) });
  console.log(book.getUrl()); // Intentionally log only the private sheet URL, never the key.
  return book.getUrl();
}

function hashKey_(key) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}

function rotateConnectionKey() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (!id) throw Error('請先執行 setup');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    SpreadsheetApp.openById(id).getSheetByName('連線設定').getRange(2, 2, 1, 1).setValues([[key]]);
    props.setProperty('KEY_HASH', hashKey_(key));
  } finally { lock.releaseLock(); }
}

function doGet() {
  return json_({ ok: false, code: 'POST_REQUIRED', error: '請透過記帳 App 連線；此網址不公開帳本資料。' });
}

function doPost(e) {
  let lock;
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 1500000) throw Error('請求大小無效');
    const input = JSON.parse(raw);
    const props = PropertiesService.getScriptProperties();
    const expected = props.getProperty('KEY_HASH');
    if (!expected || typeof input.key !== 'string' || input.key.length !== 64 || hashKey_(input.key) !== expected) {
      return json_({ ok: false, code: 'UNAUTHORIZED', error: '連線金鑰不正確，請檢查私人試算表的「連線設定」分頁。' });
    }
    if (!['pull', 'push'].includes(input.action)) throw Error('不支援的操作');
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return json_({ ok: false, code: 'BUSY', error: '另一台裝置同步中，請稍後重試。' });
    const book = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
    const sheet = book.getSheetByName('帳本資料');
    const cells = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const version = Number(cells[0]) || 0;
    const count = Number(cells[1]) || 0;
    if (!Number.isSafeInteger(version) || version < 0 || !Number.isSafeInteger(count) || count < 0 || count > 40 || count + 3 > cells.length) throw Error('雲端資料格式無效');
    if (input.action === 'pull') {
      const state = count ? JSON.parse(cells.slice(3, 3 + count).join('')) : null;
      return json_({ ok: true, version: version, state: state });
    }
    if (input.expectedVersion !== version) {
      return json_({ ok: false, code: 'CONFLICT', error: '另一台裝置已更新帳本。請先選擇保留本機或雲端版本。' });
    }
    validateState_(input.state);
    const serialized = JSON.stringify(input.state);
    if (serialized.length > 1000000) throw Error('帳本超過此個人版的 100 萬字元容量，請先下載備份。');
    const chunks = serialized.match(/[\s\S]{1,30000}/g) || [];
    const width = Math.max(3 + chunks.length, sheet.getLastColumn());
    if (width > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
    const row = [version + 1, chunks.length, new Date().toISOString()].concat(chunks.map(safeCell_));
    while (row.length < width) row.push('');
    // One range write commits the version and entire snapshot under the same script lock.
    sheet.getRange(1, 1, 1, width).setValues([row]);
    SpreadsheetApp.flush();
    // Projections are not the source of truth. A view failure must not disguise a successful commit.
    let warning = '';
    try { updateViews_(book, input.state); } catch (_) { warning = '帳本已儲存，但明細檢視更新失敗；下次同步會重建。'; }
    return json_({ ok: true, version: version + 1, warning: warning });
  } catch (_) {
    return json_({ ok: false, code: 'INVALID_REQUEST', error: '無法處理帳本資料，請確認格式與容量，並稍後重試。' });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function validateState_(state) {
  if (!state || typeof state.started !== 'boolean' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(state.startMonth)) throw Error('帳本格式無效');
  if (!Number.isSafeInteger(state.budget) || state.budget < 0 || state.budget > 100000000000) throw Error('預算無效');
  for (const name of ['transactions', 'recurring', 'settlements']) {
    if (!Array.isArray(state[name]) || state[name].length > 10000) throw Error('資料筆數無效');
  }
  for (const name of ['transactions', 'recurring']) {
    const ids = new Set();
    for (const item of state[name]) {
      if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(item.id) || ids.has(item.id)) throw Error('資料 ID 無效');
      ids.add(item.id);
      if (!Number.isSafeInteger(item.amount) || item.amount <= 0 || item.amount > 100000000000) throw Error('金額無效');
      for (const field of ['category', 'payment']) if (typeof item[field] !== 'string' || item[field].length > 200) throw Error('文字無效');
      if (name === 'transactions' && (!['income', 'expense'].includes(item.type) || !validDate_(item.date) || typeof item.note !== 'string' || item.note.length > 100)) throw Error('收支格式無效');
      if (name === 'recurring' && (typeof item.name !== 'string' || item.name.length > 50 || !Number.isInteger(item.day) || item.day < 1 || item.day > 31 || typeof item.active !== 'boolean' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.nextMonth))) throw Error('固定支出格式無效');
    }
  }
  const months = new Set();
  for (const item of state.settlements) {
    if (!item || !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.month) || months.has(item.month)) throw Error('月結月份無效');
    months.add(item.month);
    for (const field of ['income', 'expense', 'opening', 'closing', 'count']) if (!Number.isSafeInteger(item[field])) throw Error('月結金額無效');
    if (!item.breakdown || typeof item.breakdown !== 'object' || Array.isArray(item.breakdown)) throw Error('月結分類無效');
    for (const value of Object.values(item.breakdown)) if (!Number.isSafeInteger(value) || value < 0) throw Error('月結分類金額無效');
    if (typeof item.closedAt !== 'string' || !Number.isFinite(Date.parse(item.closedAt))) throw Error('月結時間無效');
  }
}

function validDate_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function safeCell_(value) {
  // Treat user-entered labels as text, including formulas and dates.
  return typeof value === 'string' ? "'" + value : value == null ? '' : value;
}

function writeView_(book, name, headers, rows) {
  const sheet = book.getSheetByName(name);
  if (rows.length + 1 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 1 - sheet.getMaxRows());
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length + 1, headers.length).setValues([headers].concat(rows.map(row => row.map(safeCell_))));
  sheet.setFrozenRows(1);
}

function updateViews_(book, state) {
  writeView_(book, '交易明細', ['ID', '日期', '收支', '分類', '名稱', '新台幣金額', '付款方式'],
    state.transactions.map(t => [t.id, t.date, t.type === 'income' ? '進帳' : '出帳', t.category, t.note, t.amount / 100, t.payment]));
  writeView_(book, '固定支出', ['ID', '名稱', '新台幣金額', '分類', '付款方式', '每月扣款日', '下次月份', '啟用'],
    state.recurring.map(r => [r.id, r.name, r.amount / 100, r.category, r.payment, r.day, r.nextMonth, r.active]));
  writeView_(book, '月結報表', ['月份', '收入', '支出', '期初', '期末', '筆數', '結帳時間'],
    state.settlements.map(s => [s.month, s.income / 100, s.expense / 100, s.opening / 100, s.closing / 100, s.count, s.closedAt]));
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
