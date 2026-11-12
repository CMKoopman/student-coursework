const test = require('node:test');
const assert = require('node:assert/strict');
const {Client,validateConfig}=require('../dist/cloud.js');
const config={supabaseUrl:'https://example.supabase.co',publishableKey:'sb_publishable_fixture_only'};
function storage(){const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
function response(status,data){return {ok:status>=200&&status<300,status,json:async()=>structuredClone(data)};}
function api(){
  let row={assessment_id:'science-a4',status:'not_started',mark:null,notes:'',due_date:null,topic_checks:[false],version:0};
  return async(url,options)=>{
    const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):null;
    if(path==='/auth/v1/token')return response(200,{access_token:'fixture-'+body.email,refresh_token:'fixture-refresh',expires_in:3600,user:{id:body.email,email:body.email}});
    if(!options.headers.Authorization)return response(401,{message:'Unauthorized'});
    if(path==='/rest/v1/study_progress')return response(200,[row]);
    if(path==='/rest/v1/rpc/save_study_progress'){
      if(body.p_expected_version!==row.version)return response(409,{code:'40001',message:'STUDY_CONFLICT'});
      row={...row,...body.p_patch,version:row.version+1};return response(200,[row]);
    }
    return response(200,{});
  };
}
test('configuration rejects secret and service-role keys',()=>{
  assert.equal(validateConfig({}),null);
  assert.throws(()=>validateConfig({...config,publishableKey:'sb_secret_private'}));
  const encoded=Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url');
  assert.throws(()=>validateConfig({...config,publishableKey:'header.'+encoded+'.signature'}));
  assert.throws(()=>validateConfig({...config,supabaseUrl:'http://example.supabase.co'}));
});
test('two client instances see shared changes and stale writes report a conflict',async()=>{
  const fetch=api(),a=new Client(config,{fetch,storage:storage()}),b=new Client(config,{fetch,storage:storage()});
  await a.signIn('tutor@example.test','fixture-pass');await b.signIn('student@example.test','fixture-pass');
  const old=(await b.load())[0];
  await a.save(old.assessment_id,0,{status:'completed'});
  assert.equal((await b.load())[0].status,'completed');
  await assert.rejects(b.save(old.assessment_id,old.version,{notes:'stale note'}),error=>error.conflict===true);
  const current=(await b.load())[0];await b.save(current.assessment_id,current.version,{notes:'reviewed note'});
  const saved=(await a.load())[0];assert.equal(saved.status,'completed');assert.equal(saved.notes,'reviewed note');
});
test('a failed network write is reported as unsaved',async()=>{
  const client=new Client(config,{storage:storage(),fetch:async()=>{throw new Error('offline');}});
  client.storeSession({access_token:'fixture',refresh_token:'fixture',expires_in:3600});
  await assert.rejects(client.save('science-a4',0,{status:'completed'}),/not been saved/);
});
test('an expired session refreshes before reading shared data',async()=>{
  const calls=[];
  const client=new Client(config,{storage:storage(),fetch:async(url,options)=>{
    calls.push({url,token:options.headers.Authorization});
    return url.includes('grant_type=refresh_token')?response(200,{access_token:'fresh-fixture',refresh_token:'next',expires_in:3600}):response(200,[{assessment_id:'science-a4'}]);
  }});
  client.storeSession({access_token:'expired-fixture',refresh_token:'refresh-fixture',expires_at:1});
  await client.load();assert.equal(calls.length,2);assert.equal(calls[1].token,'Bearer fresh-fixture');
});

const {LinkClient}=require('../dist/cloud.js');
test('private-link clients keep access out of URLs and call protected shared RPCs',async()=>{
 const requests=[];const accessKey='A'.repeat(43);
 const rows=Array.from({length:33},(_,i)=>({assessment_id:'fixture-'+i}));
 const client=new LinkClient(config,{storage:storage(),fetch:async(url,options)=>{
  const body=JSON.parse(options.body);requests.push({url,body});
  if(body.p_access_key!==accessKey)return response(403,{code:'42501',message:'Invalid link'});
  return response(200,url.endsWith('save_shared_study_progress')?[{assessment_id:'fixture-0',status:'completed'}]:rows);
 }});
 await client.signIn('',accessKey);assert.equal((await client.load()).length,33);
 await client.save('fixture-0',0,{status:'completed'});
 assert.ok(requests.every(r=>!r.url.includes(accessKey)));
 assert.equal(requests.at(-1).body.p_expected_version,0);
 await client.signOut();await assert.rejects(client.load(),/private workspace link/);
});
