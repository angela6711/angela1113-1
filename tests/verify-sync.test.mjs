import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySync } from '../scripts/verify-sync.mjs';

function fixture() {
  let version = 4;
  let state = { started: true, startMonth: '2026-11', budget: 54321, transactions: [{ id: 'existing', note: '保留原帳目', amount: 100 }], recurring: [], settlements: [] };
  const original = structuredClone(state), calls = [];
  let hook;
  const call = async (action, input = {}) => {
    calls.push({ action, ...structuredClone(input) });
    const interception = hook?.(action, input);
    if (interception) return interception;
    if (action === 'pull') return { ok: true, version, state: structuredClone(state) };
    if (input.expectedVersion !== version) return { ok: false, code: 'CONFLICT' };
    state = structuredClone(input.state); version++;
    return { ok: true, version };
  };
  return { call, original, calls, state: () => state, hook: fn => { hook = fn; }, concurrentEdit: () => { state.transactions.push({ id: 'other-device', amount: 500 }); version++; } };
}

test('read-only verification never writes to the ledger', async () => {
  const f = fixture(); const result = await verifySync(f.call);
  assert.equal(result.read, true); assert.equal(result.write, false);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.state(), f.original);
});
test('write/read-back verification cleans its metadata and preserves every original field', async () => {
  const f = fixture(); const result = await verifySync(f.call, { write: true });
  assert.equal(result.write, true); assert.equal(result.readBack, true); assert.equal(result.cleaned, true);
  assert.deepEqual(f.state(), f.original);
  assert(f.calls.some(c => c.action === 'push' && Object.keys(c.state).some(key => key.startsWith('__sync_verify_'))));
});
test('cleanup handles concurrent edits by re-reading instead of restoring an old snapshot', async () => {
  const f = fixture(); let injected = false;
  f.hook((action, input) => { if (action === 'push' && !Object.keys(input.state).some(key => key.startsWith('__sync_verify_')) && !injected) { injected = true; f.concurrentEdit(); return { ok: false, code: 'CONFLICT' }; } });
  const result = await verifySync(f.call, { write: true });
  assert.equal(result.cleaned, true); assert.equal(f.state().transactions.length, 2);
  assert.equal(f.state().transactions[1].id, 'other-device');
  assert(!Object.keys(f.state()).some(key => key.startsWith('__sync_verify_')));
});
test('a lost successful-write response still triggers cleanup and reports failure', async () => {
  const f = fixture(); let lost = false;
  const call = async (action, input) => { const result = await f.call(action, input); if (action === 'push' && !lost) { lost = true; throw Error('response lost'); } return result; };
  await assert.rejects(() => verifySync(call, { write: true }), /response lost/);
  assert.deepEqual(f.state(), f.original);
});
test('invalid snapshots cannot be mistaken for a passing read', async () => {
  await assert.rejects(() => verifySync(async () => ({ ok: true, version: 0, state: {} })), /格式無效/);
});
