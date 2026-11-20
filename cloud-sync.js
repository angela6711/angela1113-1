/* Public shared-ledger transport. The Google deployment permits anonymous read/write. */
(function (root) {
  'use strict';
  class LedgerCloud {
    constructor({ storage, getState, setState, notify = () => {}, request = fetch }) {
      Object.assign(this, { storage, getState, setState, notify, request });
      this.running = false;
      this.sequence = 0;
      this.status = 'disconnected';
      try { this.config = JSON.parse(storage.getItem('fly-ledger-cloud-v1') || 'null'); } catch { this.config = null; }
      if (this.config?.key) { delete this.config.key; this.save(); }
    }
    save() { this.storage.setItem('fly-ledger-cloud-v1', JSON.stringify(this.config)); }
    emit(status, message = '') { this.status = status; this.message = message; this.notify(status, message); }
    configure(url) {
      if (this.running) throw Error('同步中，請稍後再變更連線');
      const parsed = new URL(url);
      if (parsed.origin !== 'https://script.google.com' || !/^\/macros\/s\/[\w-]+\/exec$/.test(parsed.pathname) || parsed.search || parsed.hash) throw Error('請填入 Apps Script 的 /exec 部署網址');
      this.config = { url: parsed.href, version: null, dirty: false };
      this.save();
    }
    disconnect() {
      if (this.running) throw Error('同步中，請稍後再中斷連線');
      this.config = null;
      this.storage.removeItem('fly-ledger-cloud-v1');
      this.emit('disconnected');
    }
    changed() {
      this.sequence++;
      if (!this.config) return;
      this.config.dirty = true;
      this.save();
      if (this.status !== 'conflict') this.emit('pending');
    }
    async call(action, payload = {}) {
      const res = await this.request(this.config.url, {
        method: 'POST', redirect: 'follow', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, action }),
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw Error('Google 服務暫時無法使用（HTTP ' + res.status + '）');
      let result;
      try { result = await res.json(); } catch { throw Error('部署未回傳 JSON；請確認已部署為網頁應用程式，並允許任何人存取'); }
      if (!result.ok) {
        const error = Error(result.error || 'Google Sheets 存取失敗');
        error.code = result.code;
        throw error;
      }
      if (!Number.isSafeInteger(result.version) || result.version < 0) throw Error('雲端版本格式無效');
      return result;
    }
    async sync(resolution) {
      if (!this.config || this.running) return false;
      this.running = true;
      const before = this.sequence;
      let warning = '';
      this.emit('syncing');
      try {
        const remote = await this.call('pull');
        if (this.sequence !== before) { this.emit('pending'); return false; }
        const local = this.getState();
        const first = this.config.version === null;
        const conflict = remote.state && (first ? local.started : this.config.dirty && remote.version !== this.config.version);
        if (conflict && !['local', 'cloud'].includes(resolution)) {
          this.emit('conflict', '本機與試算表都有資料，請選擇要保留的版本。兩份資料都尚未被覆蓋。');
          return false;
        }
        if (resolution === 'cloud' || (!this.config.dirty && !first) || (first && remote.state && !local.started)) {
          if (remote.state) await this.setState(remote.state);
          else if (local.started) { this.config.dirty = true; this.save(); this.emit('conflict', '雲端帳本目前為空；請明確選擇上傳本機或中斷連線。'); return false; }
          this.config.version = remote.version;
          this.config.dirty = this.sequence !== before;
        } else {
          // Re-read before committing: another device may have changed the sheet after pull.
          const snapshot = structuredClone(local);
          const result = await this.call('push', { expectedVersion: remote.version, state: snapshot });
          warning = result.warning || '';
          this.config.version = result.version;
          this.config.dirty = this.sequence !== before;
        }
        this.config.lastSync = new Date().toISOString();
        this.save();
        this.emit(this.config.dirty ? 'pending' : 'synced', warning);
        return true;
      } catch (error) {
        this.emit(error.code === 'CONFLICT' ? 'conflict' : 'error', error.message);
        return false;
      } finally { this.running = false; }
    }
  }
  root.LedgerCloud = LedgerCloud;
})(globalThis);
