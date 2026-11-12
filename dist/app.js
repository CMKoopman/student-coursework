/* Browser-only interface; shared writes are authorised and versioned by PostgreSQL. */
(() => {
  'use strict';
  const C = window.StudyCore, course = window.COURSE, tasks = C.flatten(course);
  const byId = new Map(tasks.map(task => [task.id,task]));
  const config = window.STUDY_CONFIG || {}, PREVIEW_KEY = 'studyboard-preview:v1';
  const keyMode = config.accessMode === 'private_link';
  const fragmentAccess = new URLSearchParams(location.hash.slice(1)).get('access');
  if(fragmentAccess)history.replaceState(null,'',location.pathname+location.search);
  const $ = id => document.getElementById(id), esc = C.escape;
  let progress = Object.fromEntries(tasks.map(task => [task.id,C.blank(task)]));
  let subjectFilter = 'all', statusFilter = 'all', search = '', client = null;
  let shared = false, ready = false, syncing = false, syncError = '', configError = '';
  let modal = null, toastTimer = null, loadPromise = null, pendingBackup = null, restoreVersions = null;
  let sessionEpoch = 0, loggingOut = false;
  const saving = new Set();
  const paths = {
    all:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    history:'<path d="M3 8h18M5 20h14M7 8v9m5-9v9m5-9v9M3 5l9-3 9 3v3H3z"/>',
    maths:'<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h1m6 0h1m-8 4h1m6 0h1m-8 4h1m6 0h1"/>',
    science:'<path d="M9 3h6m-5 0v7l-6 9a1.5 1.5 0 0 0 1.3 2h13.4a1.5 1.5 0 0 0 1.3-2l-6-9V3M7 15h10"/>',
    english:'<path d="M12 5C9 3 5 3 2 4v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-3-1-7-1-10 1zm0 0v15"/>',
    afrikaans:'<path d="M3 20l7-17 7 17M6 14h8m3-4h5m-3-3v6m-3 5h6"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.all}</svg>`;
  function toast(message,error = false) {
    clearTimeout(toastTimer); $('toast').textContent = message;
    $('toast').classList.toggle('error',error); $('toast').hidden = false;
    toastTimer = setTimeout(() => {$('toast').hidden = true;},5500);
  }
  function blankAll() { return Object.fromEntries(tasks.map(task => [task.id,C.blank(task)])); }
  function loadPreview() {
    const saved = localStorage.getItem(PREVIEW_KEY);
    if (saved) progress = C.validateRows(JSON.parse(saved).progress,tasks);
    ready = true;
  }
  function persistPreview(next) {
    localStorage.setItem(PREVIEW_KEY,JSON.stringify({format:'studyboard-preview',version:1,progress:Object.values(next)}));
    progress = next;
  }
  function mergeRemote(rows) {
    const incoming = C.validateRows(rows,tasks);
    for (const task of tasks) if (!ready || incoming[task.id].version >= progress[task.id].version) progress[task.id] = incoming[task.id];
    ready = true;
  }
  function errorMessage(error) {
    if (error.message === 'Invalid login credentials') return 'That email or password is incorrect.';
    if (error.status === 401) return 'Your session expired. Please sign in again.';
    return error.message || 'Something went wrong. Please try again.';
  }
  function renderNav() {
    $('subject-nav').innerHTML = `<button class="nav-item ${subjectFilter === 'all'?'active':''}" data-subject="all" type="button" ${subjectFilter === 'all'?'aria-current="page"':''}>${icon('all')}<span>Overview</span><span class="nav-count">33</span></button>` + course.map(s => `<button class="nav-item ${subjectFilter === s.id?'active':''}" data-subject="${s.id}" type="button" ${subjectFilter === s.id?'aria-current="page"':''}><span class="nav-dot" style="background:${s.color}" aria-hidden="true"></span><span>${s.name}</span><span class="nav-count">${s.tasks.length}</span></button>`).join('');
  }
  function renderSummary() {
    const stat = C.summary(tasks,progress), value = v => ready ? v : '—';
    const stats = [
      ['Completed',value(stat.completed),'/ 33','Assessments finished','✓'],
      ['In progress',value(stat.working),'','Currently under way','◷'],
      ['Still to do',value(stat.remaining),'','Not yet completed','≡'],
      ['Science average',course.find(s=>s.id==='science').reportedAverage,'%','Reported current average',"<svg viewBox=\"0 0 20 20\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M5 15 15 5M5 5h10v10\"/></svg>"]
    ];
    $('summary').innerHTML = stats.map(([label,num,suffix,caption,symbol]) => `<article class="summary-card"><span class="stat-icon" aria-hidden="true">${symbol}</span><h2 class="summary-label">${label}</h2><div class="summary-number">${num}<small>${suffix}</small></div><p class="summary-caption">${caption}</p></article>`).join('');
    $('overall-description').textContent = ready ? `${stat.completed} of 33 assessments completed` : keyMode?'Open your private link to view progress':'Sign in to view shared progress';
    $('overall-bar').style.width = (ready ? stat.percent : 0)+'%';
    $('overall-percent').textContent = ready ? stat.percent+'%' : '—';
    $('overall-progress').setAttribute('aria-valuenow',ready ? stat.completed : 0);
    if (!ready) $('overall-progress').setAttribute('aria-valuetext','Sign in to view progress');
    else $('overall-progress').removeAttribute('aria-valuetext');
  }
  function dueMarkup(row) {
    if (!row.due_date) return '';
    const overdue = row.due_date < C.today() && row.status !== 'completed';
    const formatted = new Intl.DateTimeFormat('en-ZA',{day:'numeric',month:'short',timeZone:'Africa/Johannesburg'}).format(new Date(row.due_date+'T12:00:00Z'));
    return `<span class="due ${overdue?'overdue':''}">${overdue?'Overdue · ':''}${formatted}</span>`;
  }
  function taskMarkup(task) {
    const row = progress[task.id], status = ready ? row.status : 'not_started';
    const next = C.STATUSES[(C.STATUSES.indexOf(status)+1)%3];
    const statusText = ready ? C.LABELS[status] : keyMode?'Private':'Sign in';
    return `<div class="task-row ${status === 'completed'?'done':''}"><button class="status-button ${status}" data-cycle="${task.id}" type="button" aria-label="${esc(task.subjectName+': '+task.title+'. '+statusText+'. Click to mark '+C.LABELS[next].toLowerCase())}" title="Mark ${C.LABELS[next].toLowerCase()}" ${saving.has(task.id)?'disabled':''}>${status === 'completed'?'✓':status === 'in_progress'?'•':''}</button><button class="task-open" data-task="${task.id}" type="button" aria-label="Open ${esc(task.subjectName+': '+task.title)}"><span class="task-text"><span class="task-title">${task.title}${task.type !== 'assignment'?`<span class="type-tag ${task.type}">${task.type}</span>`:''}</span><span class="task-description">${esc(task.topics.join(' · '))}</span></span><span class="task-side"><span class="status-label ${status}">${statusText}</span>${ready?dueMarkup(row):''}</span><span class="row-chevron" aria-hidden="true">›</span></button></div>`;
  }
  function renderSubjects() {
    let count = 0;
    $('subject-grid').innerHTML = course.filter(s => subjectFilter === 'all' || s.id === subjectFilter).map(subject => {
      const subjectTasks = tasks.filter(t => t.subjectId === subject.id);
      const visible = subjectTasks.filter(t => C.matches(t,progress[t.id],subjectFilter,statusFilter,search));
      if (!visible.length) return '';
      count += visible.length;
      const stat = C.summary(subjectTasks,progress);
      return `<article class="subject-card" style="--subject-color:${subject.color}" aria-labelledby="heading-${subject.id}"><div class="subject-header"><div class="subject-title-line"><div class="subject-icon">${icon(subject.icon)}</div><div><h3 class="subject-name" id="heading-${subject.id}">${subject.name}</h3><span class="subject-meta">${subject.tasks.length} assessments</span></div><span class="subject-percent">${ready?stat.percent+'%':'—'}</span></div><div class="progress-track subject-progress" role="progressbar" aria-label="${subject.name} completion" aria-valuemin="0" aria-valuemax="${stat.total}" aria-valuenow="${ready?stat.completed:0}"><span style="width:${ready?stat.percent:0}%"></span></div><div class="subject-detail-line"><span>${ready?stat.completed+' of '+stat.total+' completed':'Sign in for progress'}</span>${subject.reportedAverage?`<span class="average-label">Current average ${subject.reportedAverage}%</span>`:`<span>${subject.tasks.filter(t=>t.type === 'exam').length} ${subject.id === 'afrikaans'?'eksamens':'exam'+(subject.tasks.filter(t=>t.type === 'exam').length === 1?'':'s')}</span>`}</div></div><div class="task-list">${visible.map(taskMarkup).join('')}</div></article>`;
    }).join('');
    $('subject-grid').hidden = count === 0; $('empty-state').hidden = count !== 0;
    $('visible-count').textContent = `${count} assessment${count === 1?'':'s'}`;
    $('list-title').textContent = subjectFilter === 'all' ? 'All subjects' : course.find(s=>s.id===subjectFilter).name;
    $('list-subtitle').textContent = subjectFilter === 'all' ? 'Your assessments, organised by subject.' : 'Click an assessment to see its topics and update progress.';
    $('empty-title').textContent = statusFilter === 'completed' && !search ? 'The first one is waiting.' : 'No assessments to show.';
    $('empty-description').textContent = statusFilter === 'completed' && !search ? 'Completed assessments will appear here.' : 'Try another status or search term.';
    $('status-filters').querySelectorAll('[data-filter]').forEach(button => {button.classList.toggle('active',button.dataset.filter===statusFilter);button.setAttribute('aria-pressed',String(button.dataset.filter===statusFilter));});
  }
  function renderConnection() {
    const node = $('sync-state'), banner = $('connection-banner');
    node.classList.toggle('error',Boolean(syncError || configError)); node.classList.toggle('loading',syncing);
    if (!shared) {
      node.textContent = 'Preview · this device only'; $('account-button').hidden = true;
      banner.hidden = false;
      banner.textContent = configError || 'This preview saves on this device. Shared progress will be available once setup is finished.';
      $('footer-mode').textContent = 'Preview · saved on this device';
    } else {
      $('account-button').hidden = false; $('account-button').textContent = client.session ? keyMode?'Sharing':'Account' : keyMode?'Open workspace':'Sign in';
      node.textContent = syncing ? 'Syncing…' : syncError ? 'Connection needs attention' : !client.session ? keyMode?'Shared · private link required':'Shared · sign-in required' : ready ? 'Shared · up to date' : 'Shared · not loaded';
      $('footer-mode').textContent = 'Shared workspace · Africa/Johannesburg';
      banner.hidden = ready && !syncError;
      if (syncError) banner.textContent = syncError;
      else if (!client.session) banner.innerHTML = keyMode?'Open your private workspace link to see and update shared progress.<button type="button" data-login>Open workspace</button>':'Sign in to see and update your shared progress.<button type="button" data-login>Sign in</button>';
      else if (!ready) banner.textContent = 'Opening your shared workspace…';
    }
    $('export-button').disabled = !ready; $('import-button').disabled = !ready;
  }
  function render() { renderNav(); renderSummary(); renderSubjects(); renderConnection(); }
  async function refresh(quiet = true) {
    if (!shared || !client.session || loggingOut) return;
    if (loadPromise) return loadPromise;
    const epoch = sessionEpoch;
    loadPromise = (async () => {
      syncing = true; renderConnection();
      try { const rows=await client.load();if(epoch!==sessionEpoch)return;mergeRemote(rows); syncError = ''; render(); if (!quiet) toast('Shared progress refreshed.'); }
      catch(error) { if(epoch!==sessionEpoch)return;syncError = errorMessage(error); if (!client.session) {ready=false;progress=blankAll();} render(); if (!quiet) toast(syncError,true); throw error; }
      finally { syncing = false; loadPromise = null; renderConnection(); }
    })();
    return loadPromise;
  }
  async function savePatch(id,patch,expectedVersion) {
    if (!ready || saving.has(id)) return null;
    const task = byId.get(id), before = progress[id], epoch = sessionEpoch;
    C.validateRow({...before,...patch},task);
    saving.add(id); renderSubjects();
    try {
      let saved;
      if (shared) saved = C.validateRow(await client.save(id,expectedVersion,patch),task);
      else {
        const disk = localStorage.getItem(PREVIEW_KEY);
        const latest = disk ? C.validateRows(JSON.parse(disk).progress,tasks) : progress;
        if (latest[id].version !== expectedVersion) {progress=latest;const error=new Error('This assessment changed in another tab.');error.conflict=true;throw error;}
        saved = {...latest[id],...patch,version:expectedVersion+1,updated_at:new Date().toISOString()};
        persistPreview({...latest,[id]:saved});
      }
      if(epoch!==sessionEpoch)throw new Error('Your session changed. Sign in again to see the saved progress.');
      progress[id] = saved; syncError = ''; render(); return saved;
    } finally {saving.delete(id);renderSubjects();}
  }
  function openAccount() {
    if (!shared) return;
    $('login-form').hidden = Boolean(client.session); $('signed-in-panel').hidden = !client.session;
    $('account-email').textContent = keyMode?'Private workspace access':client.session?.user?.email || '';
    $('login-error').textContent = '';
    if (!$('account-dialog').open) $('account-dialog').showModal();
  }
  function openTask(id) {
    if (!ready) {openAccount();return;}
    const task = byId.get(id), row = structuredClone(progress[id]);
    modal = {task,baseline:row};
    drawTask(row);
    $('task-dialog').showModal();
  }
  function drawTask(row,message = '') {
    const task = modal.task;
    $('task-dialog-content').innerHTML = `<form id="task-form" style="--subject-color:${task.color}"><div class="dialog-header"><div class="dialog-top"><span class="dialog-subject"><span class="nav-dot" style="background:${task.color}" aria-hidden="true"></span>${task.subjectName}</span><button type="button" class="icon-button close-dialog" aria-label="Close assessment">×</button></div><h2 id="task-dialog-title">${task.title}</h2><p class="muted">${task.type === 'exam'?'Exam':task.type === 'test'?'Test':'Assignment'} · ${task.topics.length} topic${task.topics.length === 1?'':'s'}</p></div><div class="dialog-body"><p id="task-message" class="form-message" role="alert" ${message?'':'hidden'}>${esc(message)}</p><div class="field-grid"><label class="field">Status<select id="task-status">${C.STATUSES.map(s=>`<option value="${s}" ${s===row.status?'selected':''}>${C.LABELS[s]}</option>`).join('')}</select></label><label class="field">Due date<input id="task-date" type="date" min="1900-01-01" max="2200-12-31" value="${row.due_date || ''}"></label><label class="field">Mark (%)<input id="task-mark" type="number" min="0" max="100" step="0.01" placeholder="Not marked yet" value="${row.mark ?? ''}"><span class="field-caption">Optional · does not change the reported Science average.</span></label><div class="field"><span>Last updated</span><span class="field-caption">${row.updated_at?esc(new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',dateStyle:'medium',timeStyle:'short'}).format(new Date(row.updated_at)))+' SAST':'No updates yet'}</span></div></div><div class="topics-heading"><strong>Topics to revise</strong><span id="topic-counter">${row.topic_checks.filter(Boolean).length} of ${task.topics.length} reviewed</span></div><p class="topics-help">Tick topics as you revise. Set the assessment status separately.</p><div class="topics-list">${task.topics.map((topic,index)=>`<label class="topic-check"><input type="checkbox" data-topic="${index}" ${row.topic_checks[index]?'checked':''}><span>${esc(topic)}</span></label>`).join('')}</div><label class="field">Notes<textarea id="task-notes" maxlength="4000" placeholder="Questions, reminders or feedback…">${esc(row.notes)}</textarea></label></div><div class="dialog-footer"><p>${shared?'Saved changes are shared with your tutor or student.':'Preview: changes stay on this device.'}</p><div class="dialog-footer-actions"><button type="button" class="button secondary close-dialog">Cancel</button><button id="task-save" type="submit" class="button primary">Save changes</button></div></div></form>`;
  }
  function readDraft() {
    return {...modal.baseline,status:$('task-status').value,due_date:$('task-date').value || null,mark:$('task-mark').value === ''?null:Number($('task-mark').value),notes:$('task-notes').value,topic_checks:[...$('task-form').querySelectorAll('[data-topic]')].map(input=>input.checked)};
  }
  async function submitTask(event) {
    event.preventDefault();
    const draft = readDraft(), baseline = modal.baseline, patch = C.diff(baseline,draft);
    if (!Object.keys(patch).length) {$('task-dialog').close();return;}
    $('task-save').disabled = true; $('task-save').textContent = 'Saving…';
    try {
      await savePatch(modal.task.id,patch,baseline.version);
      $('task-dialog').close(); toast(shared?'Progress saved and shared.':'Saved on this device.');
    } catch(error) {
      if (error.conflict) {
        try {
          if (shared) await refresh();
          const latest = structuredClone(progress[modal.task.id]);
          modal.baseline = latest;
          drawTask({...latest,...patch},'This assessment changed elsewhere. Your edits are still shown alongside the latest progress. Review them, then save again to apply your changes.');
        } catch(refreshError) {toast(errorMessage(refreshError),true);}
      } else {
        $('task-message').textContent = errorMessage(error); $('task-message').hidden = false;
      }
    } finally {if ($('task-save')) {$('task-save').disabled=false;$('task-save').textContent='Save changes';}}
  }
  async function cycle(id) {
    if (!ready) {openAccount();return;}
    const row = progress[id], next = C.STATUSES[(C.STATUSES.indexOf(row.status)+1)%3];
    try {await savePatch(id,{status:next},row.version);toast(C.LABELS[next]+(shared?' · shared':' · saved on this device'));}
    catch(error) {if(error.conflict){if(shared) await refresh().catch(()=>{});render();toast('Changed elsewhere. Latest progress loaded; try again.',true);}else toast(errorMessage(error),true);}
  }
  async function exportBackup() {
    if (!ready) return;
    if(shared){try{await refresh();}catch(error){toast(errorMessage(error),true);return;}}
    const backup = {format:'studyboard-backup',version:1,created_at:new Date().toISOString(),mode:shared?'shared':'preview',progress:Object.values(progress)};
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
    const link = document.createElement('a'); link.href=url;link.download=`studyboard-backup-${C.today()}.json`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast('Backup downloaded.');
  }
  async function chooseBackup(event) {
    const file = event.target.files[0]; event.target.value='';
    if (!file || !ready) return;
    try {
      if (file.size > 300000) throw new Error('This backup is too large. Choose a Studyboard JSON backup.');
      const backup = JSON.parse(await file.text());
      if (backup.format !== 'studyboard-backup' || backup.version !== 1) throw new Error('Choose a Studyboard backup file.');
      pendingBackup = C.validateRows(backup.progress,tasks);
      if (shared) await refresh();
      restoreVersions=Object.fromEntries(tasks.map(task=>[task.id,progress[task.id].version]));
      $('restore-error').textContent=''; $('restore-dialog').showModal();
    } catch(error) {pendingBackup=null;toast(errorMessage(error),true);}
  }
  async function restoreBackup() {
    if (!pendingBackup || !ready) return;
    $('confirm-restore').disabled = true; $('confirm-restore').textContent='Restoring…';
    try {
      const replacement = tasks.map(task=>({...pendingBackup[task.id],version:restoreVersions[task.id]}));
      if (shared) mergeRemote(await client.restore(replacement));
      else {
        const disk=localStorage.getItem(PREVIEW_KEY),latest=disk?C.validateRows(JSON.parse(disk).progress,tasks):progress;
        if(tasks.some(task=>latest[task.id].version!==restoreVersions[task.id])){const error=new Error('Progress changed in another tab.');error.conflict=true;throw error;}
        persistPreview(Object.fromEntries(replacement.map(row=>[row.assessment_id,{...row,version:row.version+1,updated_at:new Date().toISOString()}])));
      }
      pendingBackup=null;$('restore-dialog').close();render();toast(shared?'Backup restored and shared.':'Backup restored on this device.');
    } catch(error) {
      $('restore-error').textContent=error.conflict?'Progress changed elsewhere. Close this window, refresh, and select the backup again.':errorMessage(error);
    } finally {$('confirm-restore').disabled=false;$('confirm-restore').textContent='Restore this backup';}
  }
  async function login(event) {
    event.preventDefault();$('login-submit').disabled=true;$('login-submit').textContent='Signing in…';$('login-error').textContent='';
    try {
      await client.signIn($('login-email').value.trim(),$('login-password').value);
      sessionEpoch++;
      progress=blankAll();ready=false;
      await refresh();$('login-password').value='';$('account-dialog').close();toast('Shared workspace opened.');
    } catch(error) {$('login-error').textContent=errorMessage(error);renderConnection();}
    finally {$('login-submit').disabled=false;$('login-submit').textContent=keyMode?'Open workspace':'Sign in';}
  }
  async function logout() {
    sessionEpoch++;loggingOut=true;
    $('logout-button').disabled=true;
    try {await client.signOut();} catch(_) { /* Local logout still clears all visible progress. */ }
    finally {
      progress=blankAll();ready=false;syncError='';modal=null;loggingOut=false;
      $('task-dialog').close();$('account-dialog').close();$('restore-dialog').close();render();$('logout-button').disabled=false;toast(keyMode?'Workspace access forgotten on this device.':'Signed out on this device.');
    }
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.matches('.close-dialog')){button.closest('dialog').close();return;}
    if(button.dataset.subject){subjectFilter=button.dataset.subject;render();return;}
    if(button.dataset.filter){statusFilter=button.dataset.filter;renderSubjects();return;}
    if(button.dataset.task){openTask(button.dataset.task);return;}
    if(button.dataset.cycle){void cycle(button.dataset.cycle);return;}
    if(button.hasAttribute('data-login'))openAccount();
  });
  document.addEventListener('submit',event=>{if(event.target.id==='task-form')void submitTask(event);});
  $('search').addEventListener('input',event=>{search=event.target.value;renderSubjects();});
  $('clear-filters').addEventListener('click',()=>{search='';statusFilter='all';$('search').value='';renderSubjects();});
  $('account-button').addEventListener('click',openAccount);
  $('export-button').addEventListener('click',exportBackup);
  $('import-button').addEventListener('click',()=>{if(ready)$('import-file').click();});
  $('import-file').addEventListener('change',chooseBackup);
  $('confirm-restore').addEventListener('click',restoreBackup);
  $('login-form').addEventListener('submit',login);
  $('logout-button').addEventListener('click',logout);
  $('refresh-button').addEventListener('click',()=>{void refresh(false).catch(()=>{});});
  $('copy-link-button').addEventListener('click',async()=>{
    if(!client?.session?.accessKey)return;
    const link=location.origin+location.pathname+'#access='+client.session.accessKey;
    try{await navigator.clipboard.writeText(link);toast('Private workspace link copied.');}
    catch(_){$('workspace-link').hidden=false;$('workspace-link').value=link;$('workspace-link').focus();$('workspace-link').select();toast('Select and copy the private link.');}
  });
  $('task-dialog').addEventListener('change',event=>{if(event.target.hasAttribute('data-topic')){$('topic-counter').textContent=`${[...$('task-form').querySelectorAll('[data-topic]')].filter(i=>i.checked).length} of ${modal.task.topics.length} reviewed`;}});
  window.addEventListener('storage',event=>{
    if(!shared && event.key===PREVIEW_KEY){try{loadPreview();render();}catch(error){toast(errorMessage(error),true);}}
    if(shared && event.key===client.sessionKey){const oldId=client.session?.user?.id;client.reloadSession();if(client.session){if(client.session.user?.id!==oldId){sessionEpoch++;ready=false;progress=blankAll();}void refresh().catch(()=>{});}else{sessionEpoch++;ready=false;progress=blankAll();$('task-dialog').close();$('account-dialog').close();render();}}
  });
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refresh().catch(()=>{});});
  window.addEventListener('online',()=>{void refresh().catch(()=>{});});
  $('workspace-name').textContent=config.workspaceName || 'Coursework tracker';
  if(keyMode){
    $('login-email-field').hidden=true;$('login-email').required=false;
    $('login-password-label').textContent='Private link or access key';$('login-password').autocomplete='off';
    $('login-description').textContent='Open the private link shared with you, or paste it below.';
    $('account-title').textContent='Open your shared workspace.';$('login-submit').textContent='Open workspace';
    $('login-help').textContent='Your tutor can share the private workspace link with you.';
    $('access-panel-title').textContent='Your shared workspace.';
    $('access-panel-note').textContent='Anyone with the private link can view and edit this workspace. Changes normally appear within 10 seconds while the page is open.';
    $('copy-link-button').hidden=false;$('logout-button').textContent='Forget access on this device';
  }
  try {
    if(window.StudyCloud.validateConfig(config)){client=keyMode?new window.StudyCloud.LinkClient(config):new window.StudyCloud.Client(config);shared=true;}
    else loadPreview();
  } catch(error){configError=errorMessage(error);if(!shared){try{loadPreview();}catch(_){ready=true;}}}
  render();
  if(shared && keyMode && fragmentAccess){
    void(async()=>{try{await client.signIn('',fragmentAccess);sessionEpoch++;await refresh();}catch(error){syncError=errorMessage(error);render();}})();
  }else if(shared && client.session)void refresh().catch(()=>{});
  setInterval(()=>{if(document.visibilityState==='visible')void refresh().catch(()=>{});},10000);
})();
