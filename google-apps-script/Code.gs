/** Public shared ledger: anonymous visitors may read and replace account data.
 * Run setup once as the owner, then deploy as owner with access set to Anyone.
 * The spreadsheet itself can stay private; all ledger data is public through this API.
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SPREADSHEET_ID')) {
    const existing = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
    console.log(existing.getUrl());
    return existing.getUrl();
  }
  const book = SpreadsheetApp.create('想飛記帳本');
  const config = book.getSheets()[0];
  config.setName('連線設定');
  config.getRange(1, 1, 4, 2).setValues([
    ['項目', '內容'], ['存取模式', '公開共用：任何訪客可讀寫帳本'],
    ['使用方式', '部署為網頁應用程式，將 /exec 網址填入 GitHub 的 cloud-config.json'],
    ['注意', '請透過 App 編輯帳目；明細分頁是檢視用，直接改儲存格不會回寫 App。']
  ]);
  for (const name of ['帳本資料', '交易明細', '固定支出', '月結報表']) book.insertSheet(name);
  book.getSheetByName('帳本資料').getRange(1, 1, 1, 3).setValues([[0, 0, '']]);
  props.setProperties({ SPREADSHEET_ID: book.getId() });
  console.log(book.getUrl());
  return book.getUrl();
}

function doGet() {
  return json_({ ok: true, public: true, message: '公開共用帳本。請以 POST pull 讀取、push 寫入。' });
}

function doPost(e) {
  let lock;
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 1500000) throw Error('請求大小無效');
    const input = JSON.parse(raw);
    const props = PropertiesService.getScriptProperties();
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
