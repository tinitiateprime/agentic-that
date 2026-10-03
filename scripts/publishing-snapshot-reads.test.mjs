import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';

async function fixture() {
  const key='publishingReadFixture_'+Math.random();
  const document={accounts:[{id:'account-a',workspaceId:'a',platform:'x',enabled:true}],uploads:[{id:'upload-a',workspaceId:'a',accountId:'account-a',platform:'x',status:'queued',caption:'Test'}],jobs:[{id:'job-a',workspaceId:'a',accountId:'account-a',uploadId:'upload-a',state:'queued'}],submissions:[],schedules:[],activityLogs:[],companions:[],pairingChallenges:[],stagedUploads:[]};
  const f=globalThis[key]={document,reads:0,controls:0,writes:0};
  const source=await readFile('src/platform/server/publishing-central-store.js','utf8');
  const names=source.match(/import \{([^}]+)\} from "\.\/supabase-job-control\.js"/)[1].split(',').map(s=>s.trim()).filter(s=>/^\w+$/.test(s));
  const result=await build({entryPoints:['src/platform/server/publishing-central-store.js'],bundle:true,write:false,platform:'node',format:'esm',packages:'external',plugins:[{name:'read-fixture',setup(b){
    b.onResolve({filter:/^node-cron$/},()=>({path:'cron',namespace:'cron-fixture'}));
    b.onLoad({filter:/.*/,namespace:'cron-fixture'},()=>({contents:'export default {validate(){return false;}};'}));
    b.onResolve({filter:/database-document-store\.js$|publishing-normalized-store\.js$|supabase-job-control\.js$/},a=>({path:a.path,namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:`const f=globalThis[${JSON.stringify(key)}];\n`+(a.path.endsWith('database-document-store.js')?'export async function getDatabaseSql(){throw new Error("Unexpected SQL")}':a.path.endsWith('publishing-normalized-store.js')?`
      export async function initializePublishingDocument(){}
      export async function readPublishingDocument(k,initial,s){f.reads++;await new Promise(done=>setImmediate(done));const doc=structuredClone(f.document);for(const key of Object.keys(doc))if(Array.isArray(doc[key]))doc[key]=doc[key].filter(v=>v.workspaceId===s.workspaceId);return doc;}
      export async function mutatePublishingDocument(k,initial,operation){f.writes++;const {document,result}=await operation(structuredClone(f.document),{});f.document=document;return result;}
      export async function readPublishingMonitoringState(){throw new Error('Unexpected global monitoring read');}
    `:names.map(name=>`export async function ${name}(...args){${name==='supabasePublishingWorkspaceSnapshot'?`f.controls++;await new Promise(done=>setImmediate(done));return {accounts:[],companion:null,jobs:args[0]==='a'?[{id:'job-a',type:'publish',accountId:'account-a',status:'success',message:'Published',attemptCount:1,completedAt:'2026-10-02T00:00:00Z',updatedAt:'2026-10-02T00:00:00Z'}]:[]};`:name==='listSupabaseJobs'?`return [{id:'job-a',type:'publish',accountId:'account-a',status:'success',attemptCount:1}];`:name==='synchronizePublishingJobs'?'return [];':`throw new Error('Unexpected ${name}');`}}`).join('\n'))}));
  }}]});
  const mod=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
  return {mod,f,dispose:()=>delete globalThis[key]};
}

test('concurrent publishing views share a scoped read and show remote success without writes',async()=>{
 const {mod,f,dispose}=await fixture();
 try {
  const [snapshot,dashboard,uploads,accounts,other]=await Promise.all([mod.publishingWorkspaceSnapshot('a'),mod.publishingDashboard('a'),mod.listCentralUploads('a'),mod.listCentralAccounts('a'),mod.publishingWorkspaceSnapshot('b')]);
  assert.equal(f.reads,2);assert.equal(f.controls,2);assert.equal(f.writes,0);
  assert.equal(snapshot.uploads[0].status,'posted');assert.equal(dashboard.totals.posted,1);assert.equal(uploads[0].status,'posted');assert.equal(accounts[0].id,'account-a');
  assert.deepEqual(other.uploads,[]);assert.deepEqual(other.accounts,[]);
  snapshot.uploads[0].status='failed';assert.equal(uploads[0].status,'posted');
  assert.equal(f.document.uploads[0].status,'queued');
  await mod.publishingWorkspaceSnapshot('a');assert.equal(f.reads,3);
 }finally{dispose();}
});

test('queueing reconciles published jobs inside the mutation and never requeues them',async()=>{
 const {mod,f,dispose}=await fixture();
 try {
  const jobs=await mod.queueCentralUploads({workspaceId:'a'},['upload-a']);
  assert.deepEqual(jobs,[]);assert.equal(f.document.jobs[0].state,'published');assert.equal(f.document.uploads[0].status,'posted');assert.equal(f.writes,1);
 }finally{dispose();}
});
