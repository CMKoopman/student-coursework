(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudyCloud = api;
})(globalThis, function () {
  'use strict';
  function validateConfig(config) {
    const url = (config.supabaseUrl || '').replace(/\/$/,'');
    const key = config.publishableKey || '';
    if (!url && !key) return null;
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) throw new Error('The shared workspace address needs to be configured.');
    if (key.startsWith('sb_publishable_') && key.length > 20) return {url,key};
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
      if (payload.role === 'anon') return {url,key};
    } catch (_) { /* Invalid and secret keys are rejected below. */ }
    throw new Error('Use the public publishable key for this workspace. Administrator keys cannot be used in a website.');
  }
  class Client {
    constructor(config, options = {}) {
      const validated = validateConfig(config);
      if (!validated) throw new Error('Shared progress has not been configured.');
      this.url = validated.url; this.key = validated.key;
      this.fetch = options.fetch || globalThis.fetch.bind(globalThis);
      this.storage = options.storage || globalThis.localStorage;
      this.sessionKey = `studyboard-session:${new URL(this.url).hostname}`;
      this.session = null; this.refreshing = null;
      this.reloadSession();
    }
    reloadSession() {
      try { this.session = JSON.parse(this.storage.getItem(this.sessionKey) || 'null'); } catch (_) { this.session = null; }
    }
    storeSession(data) {
      this.session = {...data, expires_at: data.expires_at || Math.floor(Date.now()/1000) + data.expires_in};
      this.storage.setItem(this.sessionKey,JSON.stringify(this.session));
    }
    clearSession() { this.session = null; this.storage.removeItem(this.sessionKey); }
    async raw(path, options = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(),15000);
      let response;
      try {
        response = await this.fetch(this.url+path, {method:options.method || 'GET',headers:{apikey:this.key,'Content-Type':'application/json',...(options.token ? {Authorization:`Bearer ${options.token}`} : {})},body:options.body === undefined ? undefined : JSON.stringify(options.body),signal:controller.signal,cache:'no-store'});
      } catch (_) { throw new Error('Could not connect. Your changes have not been saved. Check your connection and try again.'); }
      finally { clearTimeout(timeout); }
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(data?.message || data?.msg || data?.error_description || 'The shared workspace could not be reached.');
        error.status = response.status; error.code = data?.code;
        if (error.code === '40001' || error.message.includes('STUDY_CONFLICT')) error.conflict = true;
        throw error;
      }
      return data;
    }
    async signIn(email,password) {
      const session = await this.raw('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});
      this.storeSession(session);
      return session;
    }
    async refresh() {
      if (this.refreshing) return this.refreshing;
      if (!this.session?.refresh_token) throw new Error('Sign in to open shared progress.');
      this.refreshing = (async () => {
        try {
          const session = await this.raw('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:this.session.refresh_token}});
          this.storeSession(session); return session.access_token;
        } catch(error) {
          if (error.status === 400 || error.status === 401) this.clearSession();
          throw error;
        } finally { this.refreshing = null; }
      })();
      return this.refreshing;
    }
    async token() {
      if (!this.session) throw new Error('Sign in to open shared progress.');
      if (!this.session.expires_at || this.session.expires_at < Date.now()/1000+60) return this.refresh();
      return this.session.access_token;
    }
    async request(path,options = {}) {
      let token = await this.token();
      try { return await this.raw(path,{...options,token}); }
      catch(error) {
        if (error.status !== 401) throw error;
        token = await this.refresh();
        return this.raw(path,{...options,token});
      }
    }
    async load() {
      const rows = await this.request('/rest/v1/study_progress?select=assessment_id,status,mark,due_date,notes,topic_checks,version,updated_at&order=assessment_id');
      if (!rows?.length) throw new Error('This account does not have access to the tracker yet. Ask your tutor to add it.');
      return rows;
    }
    async save(id,version,patch) {
      const rows = await this.request('/rest/v1/rpc/save_study_progress',{method:'POST',body:{p_assessment_id:id,p_expected_version:version,p_patch:patch}});
      if (!Array.isArray(rows) || rows.length !== 1) throw new Error('The save could not be confirmed. Refresh and check your progress.');
      return rows[0];
    }
    async restore(rows) {
      return this.request('/rest/v1/rpc/restore_study_backup',{method:'POST',body:{p_rows:rows}});
    }
    async signOut() {
      try { await this.request('/auth/v1/logout',{method:'POST'}); }
      finally { this.clearSession(); }
    }
  }
  class LinkClient extends Client {
    constructor(config, options = {}) {
      super(config,options);
      this.sessionKey = `studyboard-link:${new URL(this.url).hostname}`;
      this.reloadSession();
    }
    async signIn(_email,accessKey) {
      accessKey=accessKey.trim();
      if(accessKey.startsWith('https://') || accessKey.startsWith('http://')){
        try{accessKey=new URLSearchParams(new URL(accessKey).hash.slice(1)).get('access') || '';}catch(_){accessKey='';}
      }
      if(!/^[A-Za-z0-9_-]{43}$/.test(accessKey))throw new Error('Open the private workspace link, or paste its complete access key.');
      const rows=await this.raw('/rest/v1/rpc/load_shared_study_progress',{method:'POST',body:{p_access_key:accessKey}});
      if(!Array.isArray(rows)||rows.length!==33)throw new Error('The workspace could not be opened.');
      this.session={accessKey,user:{id:'shared-workspace'}};
      this.storage.setItem(this.sessionKey,JSON.stringify(this.session));
      return this.session;
    }
    accessKey(){if(!this.session?.accessKey)throw new Error('Open your private workspace link to see shared progress.');return this.session.accessKey;}
    async linkRequest(name,body={}){
      try{return await this.raw('/rest/v1/rpc/'+name,{method:'POST',body:{...body,p_access_key:this.accessKey()}});}
      catch(error){if(error.code==='42501')this.clearSession();throw error;}
    }
    async load(){return this.linkRequest('load_shared_study_progress');}
    async save(id,version,patch){
      const rows=await this.linkRequest('save_shared_study_progress',{p_assessment_id:id,p_expected_version:version,p_patch:patch});
      if(!Array.isArray(rows)||rows.length!==1)throw new Error('The save could not be confirmed. Refresh and check your progress.');
      return rows[0];
    }
    async restore(rows){return this.linkRequest('restore_shared_study_backup',{p_rows:rows});}
    async signOut(){this.clearSession();}
  }
  return {validateConfig,Client,LinkClient};
});
