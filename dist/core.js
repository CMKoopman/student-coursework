(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudyCore = api;
})(globalThis, function () {
  'use strict';
  const STATUSES = ['not_started', 'in_progress', 'completed'];
  const LABELS = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' };
  const FIELDS = ['status', 'mark', 'due_date', 'notes', 'topic_checks'];
  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function flatten(course) {
    return course.flatMap(subject => subject.tasks.map(task => ({...task, subjectId: subject.id, subjectName: subject.name, color: subject.color})));
  }
  function blank(task) {
    return {assessment_id: task.id, status: 'not_started', mark: null, due_date: null, notes: '', topic_checks: task.topics.map(() => false), version: 0, updated_at: null};
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '2200-12-31') return false;
    const date = new Date(value + 'T12:00:00Z');
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0,10) === value;
  }
  function validateRow(row, task) {
    if (!row || row.assessment_id !== task.id || !STATUSES.includes(row.status)) throw new Error('Invalid assessment status.');
    if (row.mark !== null && (typeof row.mark !== 'number' || !Number.isFinite(row.mark) || row.mark < 0 || row.mark > 100)) throw new Error('Marks must be between 0 and 100.');
    if (row.due_date !== null && (typeof row.due_date !== 'string' || !validDate(row.due_date))) throw new Error('Choose a valid due date.');
    if (typeof row.notes !== 'string' || row.notes.length > 4000) throw new Error('Notes can contain up to 4,000 characters.');
    if (!Array.isArray(row.topic_checks) || row.topic_checks.length !== task.topics.length || row.topic_checks.some(v => typeof v !== 'boolean')) throw new Error('The topic checklist does not match this assessment.');
    if (!Number.isInteger(row.version) || row.version < 0) throw new Error('Invalid progress version.');
    return {assessment_id: row.assessment_id, ...Object.fromEntries(FIELDS.map(key => [key, row[key]])), topic_checks: [...row.topic_checks], version: row.version, updated_at: row.updated_at || null};
  }
  function validateRows(rows, tasks) {
    if (!Array.isArray(rows) || rows.length !== tasks.length) throw new Error('The backup or workspace must contain all 33 assessments.');
    const result = {}, taskMap = new Map(tasks.map(t => [t.id,t]));
    for (const row of rows) {
      if (!row || !taskMap.has(row.assessment_id) || Object.hasOwn(result,row.assessment_id)) throw new Error('Unknown or duplicate assessment.');
      result[row.assessment_id] = validateRow(row, taskMap.get(row.assessment_id));
    }
    return result;
  }
  function diff(before, after) {
    return Object.fromEntries(FIELDS.filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map(key => [key,after[key]]));
  }
  function summary(tasks, progress) {
    const completed = tasks.filter(t => progress[t.id]?.status === 'completed').length;
    const working = tasks.filter(t => progress[t.id]?.status === 'in_progress').length;
    return {total: tasks.length, completed, working, remaining: tasks.length - completed, unstarted: tasks.length - completed - working, percent: tasks.length ? Math.round(completed/tasks.length*100) : 0};
  }
  function matches(task, progress, subject, filter, search) {
    return (subject === 'all' || subject === task.subjectId) && (filter === 'all' || filter === progress.status) && [task.title,task.subjectName,...task.topics].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  }
  function today() {
    const parts = new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(p => [p.type,p.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }
  return {STATUSES,LABELS,FIELDS,escape,flatten,blank,validDate,validateRow,validateRows,diff,summary,matches,today};
});
