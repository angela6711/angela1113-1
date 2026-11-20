import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../cloud-sync.js', import.meta.url), 'utf8');
const context = vm.createContext({ fetch, URL, AbortSignal, structuredClone });
vm.runInContext(source, context);
const { LedgerCloud } = context;
const url = 'https://script.google.com/macros/s/test-deployment/exec';
const key = 'a'.repeat(64);
const state = note => ({ started: true, startMonth: '2026-11', budget: 3000000, transactions: note ? [{ id: 'one', note }] : [], recurring: [], settlements: [] });
function fixture(local = state()) {
  const values = new Map();
  let remote = null, version = 0, fail = false, hook;
  const calls = [];
  const storage = { getItem: name => values.get(name) ?? null, setItem: (name, value) => values.set(name, value), removeItem: name => values.delete(name) };
  const cloud = new LedgerCloud({ storage, getState: () => local, setState: async next => { local = structuredClone(next); }, request: async (target, options) => {
    if (fail) throw Error('offline');
    assert.equal(target, url);
    assert.equal(options.headers['Content-Type'], 'text/plain;charset=utf-8');
    assert.equal(options.credentials, 'omit');
    const input = JSON.parse(options.body); calls.push(input);
    if (hook) await hook(input);
    let result;
    if (input.action === 'pull') result = { ok: true, version, state: remote };
    else if (input.expectedVersion !== version) result = { ok: false, code: 'CONFLICT', error: 'conflict' };
    else { remote = input.state; version++; result = { ok: true, version }; }
    return { ok: true, json: async () => structuredClone(result) };
  }});
  cloud.configure(url, key);
  return { cloud, storage, calls, local: () => local, remote: () => remote, edit: next => { local = next; cloud.changed(); }, setRemote: next => { remote = next; version++; }, offline: value => { fail = value; }, hook: fn => { hook = fn; } };
}

test('rejects untrusted endpoints, preview URLs, query keys and short credentials', () => {
  const { cloud } = fixture();
  for (const bad of ['http://script.google.com/macros/s/id/exec', 'https://evil.example/macros/s/id/exec', 'https://script.google.com/macros/s/id/dev', url + '?key=x']) assert.throws(() => cloud.configure(bad, key));
  assert.throws(() => cloud.configure(url, 'short'));
});
test('empty cloud receives the local ledger using a versioned commit', async () => {
  const f = fixture(state('saved'));
  assert.equal(await f.cloud.sync(), true);
  assert.deepEqual(f.remote(), f.local());
  assert.equal(f.cloud.config.version, 1);
  assert.equal(f.cloud.status, 'synced');
});
test('a new device downloads existing cloud data', async () => {
  const f = fixture({ ...state(), started: false }); f.setRemote(state('from phone'));
  assert.equal(await f.cloud.sync(), true);
  assert.equal(f.local().transactions[0].note, 'from phone');
  assert.equal(f.calls.filter(c => c.action === 'push').length, 0);
});
test('first connection never silently replaces either populated ledger', async () => {
  const f = fixture(state('local')); f.setRemote(state('cloud'));
  assert.equal(await f.cloud.sync(), false);
  assert.equal(f.cloud.status, 'conflict');
  assert.equal(f.local().transactions[0].note, 'local');
  assert.equal(f.remote().transactions[0].note, 'cloud');
});
test('offline edits survive reload and sync when connection returns', async () => {
  const f = fixture(); await f.cloud.sync(); f.offline(true); f.edit(state('offline record'));
  assert.equal(await f.cloud.sync(), false);
  assert.equal(f.cloud.config.dirty, true);
  assert.equal(JSON.parse(f.storage.getItem('fly-ledger-cloud-v1')).dirty, true);
  assert.equal(f.local().transactions[0].note, 'offline record');
  f.offline(false); await f.cloud.sync();
  assert.equal(f.remote().transactions[0].note, 'offline record');
  assert.equal(f.cloud.config.dirty, false);
});
test('clean devices pull subsequent changes from other devices', async () => {
  const f = fixture(); await f.cloud.sync(); f.setRemote(state('other device'));
  await f.cloud.sync(); assert.equal(f.local().transactions[0].note, 'other device');
});
test('concurrent edits stop before overwriting, then require explicit resolution', async () => {
  const f = fixture(); await f.cloud.sync(); f.edit(state('local')); f.setRemote(state('remote'));
  assert.equal(await f.cloud.sync(), false); assert.equal(f.cloud.status, 'conflict');
  assert.equal(f.remote().transactions[0].note, 'remote');
  await f.cloud.sync('local'); assert.equal(f.remote().transactions[0].note, 'local');
});
test('choosing cloud intentionally replaces local only after explicit resolution', async () => {
  const f = fixture(state('local')); f.setRemote(state('remote'));
  await f.cloud.sync(); await f.cloud.sync('cloud');
  assert.equal(f.local().transactions[0].note, 'remote'); assert.equal(f.cloud.config.dirty, false);
});
test('write race after pull is rejected by server CAS', async () => {
  const f = fixture(); await f.cloud.sync(); f.edit(state('local'));
  f.hook(input => { if (input.action === 'push') f.setRemote(state('other device')); });
  assert.equal(await f.cloud.sync(), false); assert.equal(f.cloud.status, 'conflict');
  assert.equal(f.remote().transactions[0].note, 'other device');
});
test('edits made while pull is in flight are preserved without overwriting', async () => {
  const f = fixture(); await f.cloud.sync();
  f.hook(input => { if (input.action === 'pull') f.edit(state('during request')); });
  assert.equal(await f.cloud.sync(), false); assert.equal(f.cloud.status, 'pending');
  assert.equal(f.local().transactions[0].note, 'during request');
});
test('edits made during push remain dirty for a later sync', async () => {
  const f = fixture(); await f.cloud.sync(); f.edit(state('before push'));
  f.hook(input => { if (input.action === 'push') f.edit(state('during push')); });
  await f.cloud.sync(); assert.equal(f.cloud.config.dirty, true);
  assert.equal(f.remote().transactions[0].note, 'before push');
  f.hook(null); await f.cloud.sync(); assert.equal(f.remote().transactions[0].note, 'during push');
});
test('disconnect removes credentials without deleting either ledger', async () => {
  const f = fixture(state('keep')); await f.cloud.sync(); f.cloud.disconnect();
  assert.equal(f.storage.getItem('fly-ledger-cloud-v1'), null);
  assert.equal(f.remote().transactions[0].note, 'keep'); assert.equal(f.local().transactions[0].note, 'keep');
});
