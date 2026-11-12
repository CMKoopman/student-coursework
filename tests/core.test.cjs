const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../dist/core.js');
const sandbox = {window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../dist/data.js'),'utf8'),sandbox);
const course = JSON.parse(JSON.stringify(sandbox.window.COURSE));
const tasks = C.flatten(course), rows = () => tasks.map(C.blank);

test('the supplied outline has 33 assessments and both Science finals',()=>{
  assert.equal(tasks.length,33);
  assert.deepEqual(course.map(s=>s.tasks.length),[6,7,6,7,7]);
  assert.equal(course.find(s=>s.id==='science').reportedAverage,69);
  assert.equal(tasks.filter(t=>t.subjectId==='science'&&t.type==='exam').length,2);
  assert.equal(new Set(tasks.map(t=>t.id)).size,33);
  const sql=fs.readFileSync(require.resolve('../supabase/schema.sql'),'utf8');
  for(const task of tasks) assert.ok(sql.includes(`('${task.id}', ${task.topics.length}, '`));
});
test('zero marks stay zero and only finished assessments count towards completion',()=>{
  const list=rows();list[0].mark=0;list[0].status='completed';list[1].status='in_progress';
  const state=C.validateRows(list,tasks);
  assert.equal(state[list[0].assessment_id].mark,0);
  assert.deepEqual(C.summary(tasks,state),{total:33,completed:1,working:1,remaining:32,unstarted:31,percent:3});
});
test('backup validation rejects missing, duplicate, unknown and malformed records',()=>{
  assert.throws(()=>C.validateRows(rows().slice(1),tasks));
  let bad=rows();bad[1]=bad[0];assert.throws(()=>C.validateRows(bad,tasks),/duplicate/);
  bad=rows();bad[0].assessment_id='__proto__';assert.throws(()=>C.validateRows(bad,tasks),/Unknown/);
  for(const value of [-1,101,Infinity,'69']){bad=rows();bad[0].mark=value;assert.throws(()=>C.validateRows(bad,tasks),/Marks/);}
  bad=rows();bad[0].topic_checks=['true'];assert.throws(()=>C.validateRows(bad,tasks),/checklist/);
  bad=rows();bad[0].notes='x'.repeat(4001);assert.throws(()=>C.validateRows(bad,tasks),/4,000/);
});
test('dates reject impossible days and accept a leap day',()=>{
  assert.equal(C.validDate('2026-02-29'),false);assert.equal(C.validDate('2028-02-29'),true);
  assert.equal(C.validDate('2026-11-31'),false);assert.equal(C.validDate('2026-11-12'),true);
  assert.equal(C.validDate('12/11/2026'),false);
});
test('topic search and subject/status filters compose correctly',()=>{
  const task=tasks.find(t=>t.id==='science-a6'),row=C.blank(task);
  assert.equal(C.matches(task,row,'science','not_started','NEBULAE'),true);
  assert.equal(C.matches(task,row,'maths','all','nebulae'),false);
  assert.equal(C.matches(task,row,'all','completed','nebulae'),false);
});
test('changed-field patches preserve unrelated fields and escape HTML notes',()=>{
  const before=C.blank(tasks[0]),after={...before,status:'completed'};
  assert.deepEqual(C.diff(before,after),{status:'completed'});
  assert.equal(C.escape('<script>"&\''),'&lt;script&gt;&quot;&amp;&#39;');
});
