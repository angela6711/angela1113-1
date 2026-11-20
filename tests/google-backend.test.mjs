import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';

function fixture({ beforeSetup, skipSetup = false } = {}) {
  const properties = new Map(), sheets = new Map();
  let held = false, busy = false, count = 0;
  class Sheet {
    constructor(name) { this.name = name; this.data = []; this.cols = 26; this.rows = 1000; sheets.set(name, this); }
    setName(name) { sheets.delete(this.name); this.name = name; sheets.set(name, this); }
    getRange(row, col, rows, cols) {
      return { setValues: values => { assert.equal(values.length, rows); for (let r = 0; r < rows; r++) { assert.equal(values[r].length, cols); this.data[row + r - 1] ||= []; for (let c = 0; c < cols; c++) { const value = values[r][c]; this.data[row + r - 1][col + c - 1] = typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value; } } }, getValues: () => Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => this.data[row + r - 1]?.[col + c - 1] ?? '')) };
    }
    getLastColumn() { return Math.max(1, ...this.data.map(row => row.length)); }
    getMaxColumns() { return this.cols; }
    insertColumnsAfter(_, count) { this.cols += count; }
    getMaxRows() { return this.rows; }
    insertRowsAfter(_, count) { this.rows += count; }
    clearContents() { this.data = []; }
    setFrozenRows() {}
  }
  const original = new Sheet('Sheet1');
  original.data = [['原本的資料'], [123]];
  const book = { getSheets: () => [...sheets.values()], insertSheet: name => new Sheet(name), getSheetByName: name => sheets.get(name), getId: () => '17BTKjJJPznABLK0su4HlHf5UkvCicoeFbK7aFf-tu6s', getUrl: () => 'https://docs.google.com/spreadsheets/d/17BTKjJJPznABLK0su4HlHf5UkvCicoeFbK7aFf-tu6s/edit' };
  const props = { getProperty: key => properties.get(key), setProperty: (key, value) => properties.set(key, value), setProperties: obj => Object.entries(obj).forEach(([k, v]) => properties.set(k, v)) };
  const lock = { tryLock: () => { if (busy) return false; held = true; return true; }, waitLock: () => { held = true; }, hasLock: () => held, releaseLock: () => { held = false; } };
  const context = vm.createContext({ console: { log() {} }, PropertiesService: { getScriptProperties: () => props }, SpreadsheetApp: { create: () => { count++; return book; }, openById: id => { assert.equal(id, '17BTKjJJPznABLK0su4HlHf5UkvCicoeFbK7aFf-tu6s'); return book; }, flush() {} }, Utilities: { getUuid: randomUUID, computeDigest: (_, value) => [...createHash('sha256').update(value).digest()], DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' } }, LockService: { getScriptLock: () => lock }, ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) } });
  vm.runInContext(readFileSync(new URL('../google-apps-script/Code.gs', import.meta.url), 'utf8'), context);
  if (beforeSetup) beforeSetup({ sheets, properties, Sheet });
  if (!skipSetup) context.setup();
  return { context, sheets, properties, call: input => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(input) } }).text), held: () => held, busy: () => { busy = true; }, creations: () => count };
}
const empty = () => ({ started: true, startMonth: '2026-11', budget: 3000000, transactions: [], recurring: [], settlements: [] });
const transaction = note => ({ id: 'tx-1', type: 'expense', amount: 12345, category: '餐飲', payment: '現金', date: '2026-11-20', note });
test('setup uses exactly the selected spreadsheet, preserves original cells and safely repeats', () => { const f = fixture(); f.context.setup(); assert.equal(f.creations(), 0); assert.equal(f.sheets.size, 6); assert.deepEqual(f.sheets.get('Sheet1').data, [['原本的資料'], [123]]); assert.equal(f.properties.get('SPREADSHEET_ID'), '17BTKjJJPznABLK0su4HlHf5UkvCicoeFbK7aFf-tu6s'); assert.equal(f.held(), false); });
test('anonymous visitors can discover public mode and read the shared ledger', () => { const f = fixture(); assert.equal(JSON.parse(f.context.doGet().text).public, true); assert.deepEqual(f.call({action:'pull'}), {ok:true,version:0,state:null}); });
test('push stores a complete versioned snapshot and readable currency projection', () => { const f = fixture(), state = empty(); state.transactions.push(transaction('lunch')); assert.equal(f.call({ action: 'push', expectedVersion: 0, state }).version, 1); assert.deepEqual(f.call({ action: 'pull' }).state, state); assert.equal(f.sheets.get('想飛_交易明細').data[1][5], 123.45); assert.equal(f.held(), false); });
test('stale versions cannot overwrite committed data', () => { const f = fixture(); f.call({ action: 'push', expectedVersion: 0, state: empty() }); assert.equal(f.call({ action: 'push', expectedVersion: 0, state: { ...empty(), budget: 1 } }).code, 'CONFLICT'); assert.equal(f.call({ action: 'pull' }).state.budget, 3000000); });
test('busy lock refuses access instead of permitting concurrent writes', () => { const f = fixture(); f.busy(); assert.equal(f.call({ action: 'pull' }).code, 'BUSY'); });
test('large ledgers round-trip through multiple safe spreadsheet cells', () => { const f = fixture(), state = empty(); f.sheets.get('想飛_帳本資料').cols = 3; state.transactions = Array.from({ length: 1200 }, (_, i) => ({ ...transaction('測試資料'.repeat(20)), id: 'tx-' + i })); assert.equal(f.call({ action: 'push', expectedVersion: 0, state }).ok, true); assert(f.sheets.get('想飛_帳本資料').cols > 3); assert.deepEqual(f.call({ action: 'pull' }).state, state); });
test('formula-like labels are escaped in spreadsheet projections', () => { const f = fixture(), state = empty(); state.transactions.push(transaction('=IMPORTXML("https://example.invalid", "a")')); assert.equal(f.call({ action: 'push', expectedVersion: 0, state }).ok, true); assert.equal(f.context.safeCell_('=1+1'), "'=1+1"); assert.equal(f.context.safeCell_('+1'), "'+1"); });
test('invalid amounts, dates, duplicate IDs and malicious IDs are rejected without changing version', () => { for (const mutate of [s => s.transactions[0].amount = NaN, s => s.transactions[0].date = '2026-02-31', s => s.transactions.push({ ...s.transactions[0] }), s => s.transactions[0].id = "');alert(1)//"]) { const f = fixture(), state = empty(); state.transactions.push(transaction('x')); mutate(state); assert.equal(f.call({ action: 'push', expectedVersion: 0, state }).ok, false); assert.equal(f.call({ action: 'pull' }).version, 0); assert.equal(f.held(), false); } });
test('anonymous visitors can update the same shared ledger without a key', () => { const f = fixture(); assert.equal(f.call({action:'push',expectedVersion:0,state:empty()}).ok,true); const remote=f.call({action:'pull'}); remote.state.budget=500000; assert.equal(f.call({action:'push',expectedVersion:remote.version,state:remote.state}).ok,true); assert.equal(f.call({action:'pull'}).state.budget,500000); });

test('setup refuses conflicting existing tabs without writing or renaming user sheets', () => { const f = fixture({skipSetup:true,beforeSetup:({Sheet})=>{const sheet=new Sheet('想飛_交易明細');sheet.data=[['保留原帳目']];}}); assert.throws(()=>f.context.setup(),/已有同名分頁/); assert.equal(f.sheets.size,2); assert.deepEqual(f.sheets.get('想飛_交易明細').data,[['保留原帳目']]); assert.deepEqual(f.sheets.get('Sheet1').data,[['原本的資料'],[123]]); assert.equal(f.held(),false); });
test('repeating setup preserves an existing committed ledger', () => { const f=fixture(); const state=empty(); state.transactions.push(transaction('保留帳目')); f.call({action:'push',expectedVersion:0,state}); f.context.setup(); assert.deepEqual(f.call({action:'pull'}).state,state); assert.deepEqual(f.sheets.get('Sheet1').data,[['原本的資料'],[123]]); });
test('requests cannot write an old or different configured spreadsheet', () => { const f=fixture(); f.properties.set('SPREADSHEET_ID','another-file'); assert.equal(f.call({action:'push',expectedVersion:0,state:empty()}).ok,false); assert.equal(f.sheets.get('想飛_帳本資料').data[0][0],0); });
