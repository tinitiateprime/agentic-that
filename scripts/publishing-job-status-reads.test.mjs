import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

async function fixture() {
 const key='jobStatusFixture_'+Math.random();
 const row={id:'job-a',workspace_id:'workspace-a',job_type:'publish',status:'success',attempt_count:1,final_action_started_at:'2026-10-02T00:00:00Z',payload:{privateMedia:{parts:['large private payload']}}};
 const f=globalThis[key]={calls:[],row};
 const result=await build({entryPoints:['src/platform/server/supabase-job-control.js'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'sql-fixture',setup(b){
 b.onResolve({filter:/database-document-store\.js$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`const f=globalThis[${JSON.stringify(key)}];
 function sql(parts,...values){
   if(!parts.raw)return {columns:parts};
   const query=parts.reduce((text,part,i)=>text+part+(i<values.length?(values[i]?.columns?.join(',')||'$param'):''),'');
   f.calls.push({query,values});
   const row=structuredClone(f.row);
   if(!query.includes('SELECT * FROM public.jobs'))delete row.payload;
   return Promise.resolve(query.includes('AS minimum_version')?[{minimum_version:'2.1.29',companion:null,login_required:0,accounts:[],jobs:[row]}]:[row]);
 }
 export async function getDatabaseSql(){return sql;}` }));
 }}]});
 const mod=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 return {f,mod,dispose:()=>delete globalThis[key]};
}

test('publishing status reads omit media payload while ordinary job reads preserve it',async()=>{
 const {f,mod,dispose}=await fixture();
 try{
  const [status]=await mod.listSupabaseJobs('workspace-a',{type:'publish',includePayload:false});
  assert.deepEqual(status.payload,{});assert.equal(status.status,'success');assert.equal(status.finalActionStartedAt,f.row.final_action_started_at);
  assert.ok(!/\bpayload\b/.test(f.calls[0].query));assert.ok(f.calls[0].values.includes('workspace-a'));
  const [full]=await mod.listSupabaseJobs('workspace-a',{type:'publish'});
  assert.deepEqual(full.payload,f.row.payload);
 }finally{dispose();}
});

test('workspace dashboard status query omits payload but retains final-action evidence',async()=>{
 const {f,mod,dispose}=await fixture();
 try{
  const snapshot=await mod.supabasePublishingWorkspaceSnapshot('workspace-a');
  assert.equal(snapshot.jobs[0].finalActionStartedAt,f.row.final_action_started_at);
  assert.deepEqual(snapshot.jobs[0].payload,{});
  assert.ok(!/\bpayload\b/.test(f.calls[0].query));
  assert.ok(f.calls[0].values.filter(v=>typeof v==='string').every(v=>v==='workspace-a'));
 }finally{dispose();}
});
