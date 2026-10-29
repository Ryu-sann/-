/* UI controller. Game state lives in game.js; recurrence and weeks in tasks.js;
   persistence in storage.js; all illustrations in art.js. */
'use strict';
const { REGIONS, WEAPONS, replay, currentEncounter, forgeCost, weaponName, preview, localDay, hitValues, bossPhase, PHASES, MILESTONES, nextMilestone } = EmberGame;
const { addDays, dayDiff, energyFor, recurrence, weekStart, weekDays, rollGoals, skipOccurrence, stopSeries } = EmberTasks;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const uid = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
const today = () => localDay();
const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];
const VIEWS = ['today', 'week', 'adventure', 'equipment', 'camp'];
const loaded = EmberStorage.load();
let state = loaded.state, game = replay(state), view = 'today', filter = 'today';
let focus = null, focusTimer, toastTimer, confirmCallback, lastDay = today();
let animationQueue = [], animating = false, animationTimer, barTimer, soundTimer, audioCtx, lastResultSession = null;
let selectedWeapon = game.equipped, lastForge = null;
if (!state.goals) state.goals = [];

/* ---------- basics ---------- */
function save() {
  try { EmberStorage.save(state); return true; }
  catch (error) { toast('保存できませんでした。記録タブからJSONバックアップを書き出してください。'); return false; }
}
function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 5000);
}
function fillIcons(scope = document) {
  scope.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
}
const fast = () => state.settings.reduced || matchMedia('(prefers-reduced-motion: reduce)').matches;
const shortDay = day => { const [, m, d] = day.split('-').map(Number); return m + '/' + d; };
const weekdayOf = day => WEEKDAY[new Date(day + 'T12:00').getDay()];

/* ---------- task helpers ---------- */
const done = task => task.importedDone || game.done.has(task.id);
function superseded(task) {
  return task.repeat !== 'none' && state.tasks.some(other => other.seriesId === task.seriesId && other.occurrence > task.occurrence);
}
const live = t => !t.deleted && !done(t) && !superseded(t) && !t.skipped;
function activeTasks() { return state.tasks.filter(live); }
const isToday = t => (!!t.scheduled && t.scheduled <= today()) || (!!t.due && t.due <= today());
function sorted(tasks) {
  return [...tasks].sort((a, b) => {
    const ad = a.due || '9999', bd = b.due || '9999';
    return (ad < today() ? -1 : 0) - (bd < today() ? -1 : 0) || b.priority - a.priority || ad.localeCompare(bd) || a.createdAt - b.createdAt;
  });
}
function primaryTask() { return activeTasks().find(t => t.id === state.main[today()]) || null; }
function doneTodayIds() { return new Set(game.results.filter(r => r.day === today()).map(r => r.taskId)); }
const repeatLabel = t => t.repeat === 'daily' ? '毎日' : t.repeat === 'weekly' ? '毎週 ' + weekdayOf(t.occurrence || t.scheduled || today()) : '';
function currentGoals() { const w = weekStart(today()); return state.goals.filter(g => !g.deleted && g.week === w); }
const goalCount = g => game.goalCounts[g.id] || 0;
function goalDoneToday(g) { return game.results.some(r => r.day === today() && state.tasks.find(t => t.id === r.taskId)?.goalId === g.id); }
function goalOf(task) { return task.goalId ? currentGoals().find(g => g.id === task.goalId) || null : null; }
function refreshRecurrence() {
  const a = recurrence(state, today(), uid), b = rollGoals(state, today(), uid, done);
  if (a || b) save();
}
function clearAnimation() {
  clearTimeout(animationTimer); clearTimeout(soundTimer); clearTimeout(barTimer);
  animationQueue = []; animating = false;
}
function navigate(next) {
  if (!VIEWS.includes(next)) return;
  clearAnimation(); view = next; render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ---------- render ---------- */
function render() {
  game = replay(state);
  state.region = Math.min(state.region, game.unlocked);
  document.body.classList.toggle('reduced', state.settings.reduced);
  $('headerStats').innerHTML = `<span>Lv.${game.level}</span>
    <span class="gold" title="鉄片">${icon('hammer', 14)}${game.iron}</span>
    <span class="orange" title="熾火">${icon('fire', 14)}${game.ember}</span>
    <button class="iconbtn" data-action="mute" aria-label="${state.settings.mute ? '音をオンにする' : '音をミュートする'}">${icon('volume', 15)}${state.settings.mute ? '<span class="off">OFF</span>' : ''}</button>`;
  renderToday(); renderWeek(); renderAdventure(); renderEquipment(); renderCamp();
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + view));
  document.querySelectorAll('[data-action=nav]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  fillIcons();
}
function sceneBlock(displayGame = game) {
  const i = state.region, r = REGIONS[i], e = currentEncounter(displayGame, i);
  const isFight = ['combat', 'boss'].includes(e.kind), phase = e.kind === 'boss' ? bossPhase(e.hp, e.maxHp) : -1;
  return `<div class="scene ${phase >= 0 ? 'boss-phase-' + phase : ''}" id="battleScene">
    ${sceneArt(i, displayGame.equipped, displayGame.tiers[displayGame.equipped], displayGame)}
    <div class="scenetop"><span class="scene-tag">${r.sub} ${esc(r.name)}</span><span>${e.kind === 'repeat' ? '踏破済み' : esc(e.name) + ' ' + (e.index + 1) + '/4'}</span></div>
    <div class="scene-caption"><div class="boss-row"><span>${esc(e.enemy || '素材を集める')}${phase >= 0 ? `<em class="phase">${PHASES[phase]}</em>` : ''}</span><span id="sceneHp">${isFight ? e.hp + ' / ' + e.maxHp : e.kind === 'cache' ? '次の任務で回収' : ''}</span></div>
      <div class="bar ${isFight ? '' : 'muted-bar'}"><span id="sceneBar" style="width:${isFight ? e.hp / e.maxHp * 100 : 100}%"></span></div></div>
    <div id="animationMessage" class="animation-message hidden" aria-live="polite"></div><div id="damageNumber" class="damage-number"></div>
  </div>`;
}
function tagsFor(t) {
  const complete = done(t), goal = goalOf(t), tags = [`<span>${t.minutes}分</span>`];
  if (t.repeat !== 'none') tags.push(`<span>${repeatLabel(t)}</span>`);
  if (goal) tags.push(`<span class="gold">週目標 ${goalCount(goal)}/${goal.target}</span>`);
  if (t.due) tags.push(`<span class="${t.due < today() && !complete ? 'orange' : ''}">${t.due < today() && !complete ? '期限超過 ' : '締切 '}${shortDay(t.due)}</span>`);
  if (t.project) tags.push(`<span>${esc(t.project)}</span>`);
  if (t.skipped) tags.push('<span>今回はスキップ</span>');
  else if (superseded(t) && !complete) tags.push('<span>過去の回</span>');
  else if (complete && t.importedDone) tags.push('<span>旧版で達成</span>');
  if (!complete && t.scheduled && t.scheduled > today()) tags.push(`<span>${shortDay(t.scheduled)}（${weekdayOf(t.scheduled)}）予定</span>`);
  return tags.join('');
}
function forecastLine(task) {
  const f = preview(state, task, today());
  if (!f) return '';
  let what;
  if (f.repeat) what = '踏破した道で素材を集める';
  else what = f.segments.map(x => x.kind === 'cache' ? '資材を回収' : `${x.enemy}に${x.damage}${x.broke ? '・撃破' : ''}`).join(' → ') || '次の遭遇へ';
  if (f.victory) what += ' → 地域踏破';
  else if (f.phaseShift) what += `（${PHASES[f.phaseShift]}）`;
  return `<p class="forecast">${icon(f.willForge ? 'hammer' : 'sword', 14)}<span>${esc(what)}<br><span class="muted">鉄片+${f.iron}${f.ember ? ' 熾火+' + f.ember : ''} EXP+${f.xp}${f.willForge ? ' · 鍛造できる' : ' · 鍛造まで鉄片' + f.needIron + (f.needEmber ? '・熾火' + f.needEmber : '')}</span></span></p>`;
}
function mainCard(task) {
  return `<article class="main-task"><div class="between"><span class="main-label">${icon('target', 13)}今日の主目標</span><button class="iconbtn" data-action="menu" data-id="${esc(task.id)}" aria-label="主目標の操作">${icon('more', 18)}</button></div>
    <h2>${esc(task.title)}</h2><div class="meta">${tagsFor(task)}</div>
    ${task.step ? `<p class="stepbox">${esc(task.step)}</p>` : ''}
    ${forecastLine(task)}
    <div class="main-actions"><button class="primary" data-action="start" data-id="${esc(task.id)}">${icon('arrow', 16)}${task.firstStart ? '続ける' : '取りかかる'}</button><button class="secondary" data-action="complete" data-id="${esc(task.id)}">${icon('check', 16)}完了</button></div></article>`;
}
function progressCard() {
  const ids = doneTodayIds(), todays = activeTasks().filter(isToday), total = ids.size + todays.length;
  const goals = currentGoals(), goalsDone = goals.filter(g => goalCount(g) >= g.target).length;
  const mainDone = game.results.some(r => r.day === today() && r.main);
  return `<div class="progress-card"><div class="between"><strong>今日 ${ids.size} / ${total} 完了</strong><span class="tiny muted">${mainDone ? '主目標 ✓' : state.main[today()] ? '主目標 未完' : '主目標 未設定'}${goals.length ? ` · 週目標 ${goalsDone}/${goals.length}` : ''}</span></div>
    <div class="bar exp"><span style="width:${total ? ids.size / total * 100 : 0}%"></span></div></div>`;
}
function segmentSummary(r) {
  if (r.repeat) return '踏破した道で素材を集めた。';
  return (r.segments || []).map(x => x.kind === 'cache' ? '資材を回収' : `${esc(x.enemy)}に${x.damage}${x.broke ? '（撃破）' : ''}`).join(' → ');
}
function resultTitle(r) {
  if (r.victory) return '烽火が灯り、次の地域が解放された。';
  if (r.overflow && r.broken?.length) return '余剰ダメージで、さらに先へ。';
  if (r.phaseShift) return `${r.enemy}：${PHASES[r.phaseShift]}`;
  if (r.broken?.length) return r.broken.at(-1) + 'を撃破した。';
  if (r.cache) return '鍛造資材を回収した。';
  if (r.repeat) return '素材を持ち帰った。';
  return 'その一撃は、確かに残った。';
}
function compactResult(r) {
  return `<article class="inline-result"><div class="between"><h3>${esc(resultTitle(r))}</h3><button class="ghost" data-action="undo" data-id="${esc(r.taskId)}">${icon('undo', 13)}取消</button></div>
    <p class="source">${segmentSummary(r)}</p><p class="gains">鉄片 +${r.iron}${r.ember ? ' · 熾火 +' + r.ember : ''} · EXP +${r.xp}${r.goalDone ? ' · 週目標達成' : ''}</p></article>`;
}
function taskRow(t, main) {
  const complete = done(t), past = (superseded(t) && !complete) || t.skipped, result = complete && game.results.find(r => r.taskId === t.id);
  const check = complete ? (result ? `data-action="undo" aria-label="${esc(t.title)}の完了を取り消す"` : 'disabled aria-label="達成済み"')
    : past ? 'disabled aria-label="対象外"' : `data-action="complete" aria-label="${esc(t.title)}を完了"`;
  return `<article class="task-row ${complete ? 'done' : ''} ${past ? 'past' : ''} ${main ? 'is-main' : ''}"><button class="checkbtn" data-id="${esc(t.id)}" ${check}>${complete ? icon('check', 13) : ''}</button>
    <button class="body" ${live(t) ? `data-action="start" data-id="${esc(t.id)}"` : 'tabindex="-1"'}><span class="t">${main ? icon('target', 12) + ' ' : ''}${esc(t.title)}</span><span class="meta">${tagsFor(t)}</span></button>
    <button class="iconbtn" data-action="menu" data-id="${esc(t.id)}" aria-label="${esc(t.title)}の操作">${icon('more', 18)}</button></article>`;
}
function goalSuggestions() {
  const open = currentGoals().filter(g => goalCount(g) < g.target && !goalDoneToday(g) && !activeTasks().some(t => t.goalId === g.id && isToday(t)));
  if (!open.length) return '';
  return `<div class="goal-suggest"><span class="tiny muted">週の目標から今日へ</span>${open.map(g => `<button class="chip" data-action="assign-goal" data-id="${esc(g.id)}">${icon('plus', 12)}${esc(g.title)} <small>${goalCount(g)}/${g.target}</small></button>`).join('')}</div>`;
}
function renderToday() {
  const main = primaryTask(), liveTasks = activeTasks();
  const recentResult = game.results.find(r => r.eventId === lastResultSession);
  const closed = state.daily[today()] && !state.daily[today()].reopened ? state.daily[today()] : null;
  let mainHtml = '';
  if (closed) mainHtml = `<div class="main-task quiet"><span class="main-label">${icon('camp', 13)}今日の遠征は終了</span><p class="condition">${closed.tomorrow ? '明日の一歩：' + esc(closed.tomorrow) : '任務を進めれば、いつでも再開できます。'}</p></div>`;
  else if (main) mainHtml = mainCard(main);
  else {
    const candidate = sorted(liveTasks.filter(isToday))[0];
    mainHtml = candidate
      ? `<div class="main-task quiet"><span class="main-label">${icon('target', 13)}主目標を一つ選ぶ（追加素材は1日1回）</span><h2>${esc(candidate.title)}</h2><button class="secondary full" data-action="main" data-id="${esc(candidate.id)}">これを主目標にする</button></div>`
      : `<div class="main-task quiet"><span class="main-label">${icon('target', 13)}${game.results.length || state.migrated ? '今日の任務はまだありません' : '最初の一歩'}</span><h2>${game.results.length || state.migrated ? '次にやることを一つ。' : '今から行う、小さな用事を。'}</h2><button class="primary full" data-action="add">${icon('plus', 16)}任務を追加</button></div>`;
  }
  const ids = doneTodayIds(), mainId = closed ? null : main?.id;
  let tasks;
  if (filter === 'today') tasks = [...sorted(liveTasks.filter(t => isToday(t) && t.id !== mainId)), ...state.tasks.filter(t => !t.deleted && ids.has(t.id))];
  else if (filter === 'later') tasks = sorted(liveTasks.filter(t => !isToday(t)));
  else if (filter === 'done') tasks = state.tasks.filter(t => !t.deleted && done(t)).sort((a, b) => (game.results.find(r => r.taskId === b.id)?.at || 0) - (game.results.find(r => r.taskId === a.id)?.at || 0)).slice(0, 40);
  else tasks = sorted(state.tasks.filter(t => !t.deleted));
  const empty = { today: '今日の任務はすべて片付きました。', later: '予定している任務はありません。', done: 'まだ完了した任務はありません。', all: '任務はまだありません。' }[filter];
  $('page-today').innerHTML = `<div class="home-grid"><div class="visual-col">${sceneBlock()}</div>
    <div class="action-col">${progressCard()}
      ${recentResult && !closed ? compactResult(recentResult) : ''}
      ${mainHtml}
      <section class="task-section"><div class="section-head"><div class="segmented" role="tablist">${[['today','今日'],['later','予定'],['done','完了'],['all','すべて']].map(([id, label]) => `<button class="${filter === id ? 'active' : ''}" role="tab" aria-selected="${filter === id}" data-action="filter" data-filter="${id}">${label}</button>`).join('')}</div><button class="ghost gold" data-action="add">${icon('plus', 14)}追加</button></div>
        ${tasks.length ? tasks.map(t => taskRow(t, filter === 'all' && t.id === state.main[today()])).join('') : `<div class="empty">${empty}</div>`}
        ${filter === 'today' ? goalSuggestions() : ''}
      </section>
      <div class="end-link"><button class="ghost" data-action="end-day">${icon('camp', 15)}${closed ? '今日のまとめを見る' : '今日の遠征を終える'}</button></div>
    </div></div>`;
}

/* ---------- week ---------- */
function weeklyStatus(t) {
  // t is the latest occurrence in its series.
  const w = weekStart(today()), days = weekDays(today());
  const anchor = t.occurrence || t.scheduled || today();
  let occ = anchor;
  if (anchor < w) occ = addDays(anchor, Math.ceil(dayDiff(w, anchor) / 7) * 7);
  const thisWeek = days.includes(occ), existing = anchor >= w ? t : null;
  return { occ, thisWeek, existing };
}
function weeklyRow(t) {
  const st = weeklyStatus(t), x = st.existing;
  let status, button = '';
  if (x && done(x)) status = '<span class="ok">✓ 今週は達成</span>';
  else if (x && x.skipped) status = '今週はスキップ';
  else if (x && x.scheduled && x.scheduled <= today()) status = '今日の任務に入っています';
  else if (!st.thisWeek) status = '今週はなし';
  else {
    status = `${shortDay(x?.scheduled || st.occ)}（${weekdayOf(x?.scheduled || st.occ)}）予定`;
    button = `<button class="secondary small" data-action="assign-weekly" data-id="${esc(t.id)}">今日やる</button>`;
  }
  return `<div class="goal-row ${x && done(x) ? 'done' : ''}"><div class="body"><h3>${esc(t.title)}</h3><p class="tiny muted">毎週 ${weekdayOf(t.occurrence || t.scheduled)}曜 · ${t.minutes}分 · ${status}</p></div>${button}<button class="iconbtn" data-action="menu" data-id="${esc((x || t).id)}" aria-label="${esc(t.title)}の操作">${icon('more', 18)}</button></div>`;
}
function goalRow(g) {
  const n = goalCount(g), complete = n >= g.target, assigned = activeTasks().some(t => t.goalId === g.id && isToday(t));
  const pips = Array.from({ length: g.target }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
  const action = complete ? '<span class="ok tiny">✓ 達成</span>'
    : assigned ? '<span class="tiny muted">今日に割当済み</span>'
      : goalDoneToday(g) ? '<span class="ok tiny">今日 ✓</span>'
      : `<button class="secondary small" data-action="assign-goal" data-id="${esc(g.id)}">今日やる</button>`;
  return `<div class="goal-row ${complete ? 'done' : ''}"><div class="body"><h3>${esc(g.title)}</h3><div class="pips">${pips}<span class="tiny muted">${g.target === 1 ? '今週中に' : `週${g.target}回 · ${n}/${g.target}`}${g.weekly ? ' · 毎週' : ''}</span></div></div>${action}<button class="iconbtn" data-action="goal-menu" data-id="${esc(g.id)}" aria-label="${esc(g.title)}の操作">${icon('more', 18)}</button></div>`;
}
function latestOfSeries() {
  const latest = new Map();
  for (const t of state.tasks) {
    const old = latest.get(t.seriesId);
    if (!old || (t.occurrence || t.scheduled) > (old.occurrence || old.scheduled)) latest.set(t.seriesId, t);
  }
  return [...latest.values()];
}
function renderWeek() {
  const days = weekDays(today()), goals = currentGoals(), results = allResults();
  const weekly = latestOfSeries().filter(t => t.repeat === 'weekly' && !t.deleted);
  const counts = days.map(d => results.filter(r => r.day === d).length), total = counts.reduce((a, b) => a + b, 0);
  const goalsDone = goals.filter(g => goalCount(g) >= g.target).length;
  $('page-week').innerHTML = `<div class="page-title"><h1>今週</h1><p>${shortDay(days[0])}（月）– ${shortDay(days[6])}（日） · 完了 ${total} 件${goals.length ? ` · 目標 ${goalsDone}/${goals.length}` : ''}</p></div>
    <div class="week-strip">${days.map((d, i) => `<div class="${d === today() ? 'today' : d < today() ? 'past' : ''}"><small>${WEEKDAY[(i + 1) % 7]}</small><b>${Number(d.slice(8))}</b><span>${counts[i] ? counts[i] : '·'}</span></div>`).join('')}</div>
    <div class="week-grid"><section class="panel"><div class="section-head"><h2>週の目標</h2><button class="ghost gold" data-action="add-goal">${icon('plus', 14)}目標を追加</button></div>
      ${goals.length ? goals.map(goalRow).join('') : '<div class="empty">「今週中にレポートを出す」「週3回 運動する」などを登録し、<br>「今日やる」で今日の任務に割り当てます。</div>'}</section>
    <section class="panel"><div class="section-head"><h2>毎週の任務</h2><button class="ghost gold" data-action="add-weekly">${icon('plus', 14)}追加</button></div>
      ${weekly.length ? weekly.map(weeklyRow).join('') : '<div class="empty">繰り返しを「毎週」にした任務がここに並びます。</div>'}</section></div>`;
}
function assignGoal(id) {
  const g = currentGoals().find(x => x.id === id); if (!g) return;
  if (goalCount(g) >= g.target) { toast('この目標は今週達成済みです。'); return; }
  const linked = activeTasks().filter(t => t.goalId === g.id);
  if (linked.some(isToday)) { toast('すでに今日の任務に入っています。'); return; }
  let task = linked[0];
  if (task) task.scheduled = today();
  else {
    const tid = uid();
    task = { id: tid, seriesId: tid, title: g.title, minutes: g.minutes || 25, energy: energyFor(g.minutes || 25), autoEnergy: true, repeat: 'none',
      condition: '', step: '', due: '', scheduled: today(), occurrence: today(), priority: 2, project: '', goalId: g.id,
      createdAt: Date.now(), firstStart: null, importedDone: false, deleted: false };
    state.tasks.push(task);
  }
  if (!state.main[today()]) state.main[today()] = task.id;
  save(); render(); toast(`「${g.title}」を今日の任務に入れました。`);
}
function assignWeekly(id) {
  const t = state.tasks.find(x => x.id === id); if (!t) return;
  const st = weeklyStatus(t);
  if (st.existing) { if (!live(st.existing)) return; st.existing.scheduled = today(); }
  else if (st.thisWeek) {
    const shift = dayDiff(st.occ, t.occurrence || t.scheduled);
    state.tasks.push({ ...t, id: uid(), occurrence: st.occ, scheduled: today(), due: t.due ? addDays(t.due, shift) : '',
      createdAt: Date.now(), firstStart: null, importedDone: false, deleted: false, skipped: false });
  } else return;
  save(); render(); toast(`「${t.title}」を今日の任務に入れました。`);
}
function openGoal(id) {
  const form = $('goalForm'), g = state.goals.find(x => x.id === id); form.reset();
  form.elements.namedItem('id').value = g?.id || '';
  if (g) { form.elements.namedItem('title').value = g.title; form.elements.namedItem('target').value = g.target; form.elements.namedItem('minutes').value = g.minutes || 25; form.elements.namedItem('weekly').checked = g.weekly; }
  $('goalDialogTitle').textContent = g ? '週の目標を編集' : '週の目標を追加';
  fillIcons($('goalDialog')); $('goalDialog').showModal();
}
$('goalForm').addEventListener('submit', event => {
  event.preventDefault();
  const f = event.target.elements, title = f.namedItem('title').value.trim(); if (!title) return;
  const patch = { title: title.slice(0, 100), target: Math.min(7, Math.max(1, Number(f.namedItem('target').value) || 1)), minutes: Number(f.namedItem('minutes').value) || 25, weekly: f.namedItem('weekly').checked };
  const g = state.goals.find(x => x.id === f.namedItem('id').value);
  if (g) { Object.assign(g, patch); state.tasks.filter(t => t.goalId === g.id && live(t)).forEach(t => { t.title = patch.title; }); }
  else { const id = uid(); state.goals.push({ ...patch, id, seriesId: id, week: weekStart(today()), createdAt: Date.now(), deleted: false }); }
  save(); $('goalDialog').close(); render(); toast(g ? '目標を更新しました。' : '週の目標を追加しました。「今日やる」で今日に割り当てます。');
});

/* ---------- adventure ---------- */
function roadmap(region) {
  return `<div class="roadmap">${REGIONS[region].encounters.map((e, i) => `<div class="roadstop ${i < game.stages[region] ? 'done' : i === game.stages[region] ? 'active' : ''}"><span>${i < game.stages[region] ? icon('check', 12) : i + 1}</span>${e.name}</div>`).join('')}</div>`;
}
function renderAdventure() {
  const i = state.region, r = REGIONS[i], e = currentEncounter(game, i);
  $('page-adventure').innerHTML = `<div class="page-title"><h1>冒険</h1><p>${r.sub} ${r.name} — ${r.goal}</p></div>
    <div class="panel">${roadmap(i)}
      <div class="encounter-list">${r.encounters.map((x, n) => {
        const hp = game.health[i][n], status = n < game.stages[i] ? (x.kind === 'cache' ? '回収済み' : '撃破') : x.kind === 'cache' ? '鉄片+2・熾火+1' : `HP ${hp} / ${x.hp}${x.kind === 'boss' ? ' · ' + PHASES[bossPhase(hp, x.hp)] : ''}`;
        return `<div class="encounter-row ${n === game.stages[i] ? 'current' : ''}"><div><h3>${x.name} · ${x.enemy}${x.kind === 'boss' ? ' <span class="tag">ボス</span>' : ''}</h3><p class="tiny muted">${status}</p>${n === game.stages[i] && x.hp ? `<div class="bar"><span style="width:${hp / x.hp * 100}%"></span></div>` : ''}</div><span class="tiny ${n === game.stages[i] ? 'gold' : 'muted'}">${n < game.stages[i] ? '突破' : n === game.stages[i] ? '対峙中' : 'この先'}</span></div>`;
      }).join('')}</div>
      <p class="tiny muted">敵を倒して余ったダメージは次の遭遇へ持ち越します。ボスはHP 2/3・1/3で構えが変わります。</p>
    </div>
    <h2 class="sub-head">進み方</h2>
    <div class="route-options"><button class="route ${state.route === 'story' ? 'active' : ''}" data-action="route" data-route="story">${icon('sword', 20)}<div><strong>突破を目指す</strong><p>攻撃100%</p></div></button><button class="route ${state.route === 'materials' ? 'active' : ''}" data-action="route" data-route="materials">${icon('hammer', 20)}<div><strong>素材を集める</strong><p>鉄片2倍・攻撃70%</p></div></button></div>
    <h2 class="sub-head">地域</h2>
    <div class="region-grid">${REGIONS.map((x, n) => `<button class="region-card ${i === n ? 'selected' : ''}" data-action="region" data-region="${n}" ${n > game.unlocked || n === i ? 'disabled' : ''}><span class="tiny gold">${x.sub}${n > game.unlocked ? ' · 未解放' : game.cleared[n] ? ' · 踏破' : ''}</span><strong>${x.name}</strong><span class="tiny muted">${n === i ? '現在の遠征先' : n > game.unlocked ? '前の地域を踏破で解放' : game.cleared[n] ? '再探索（素材集め）' : 'この地へ向かう'}</span></button>`).join('')}</div>`;
}

/* ---------- equipment ---------- */
function portraitSvg(family, tier, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 215 280" role="img" aria-label="${esc(weaponName(family, Math.max(0, tier)))}を装備した灰の旅人">${knight(family, Math.max(0, tier), true)}</svg>`;
}
function renderEquipment() {
  const id = selectedWeapon, family = WEAPONS.find(w => w.id === id), tier = game.tiers[id], owned = tier >= 0;
  const cost = forgeCost(tier), can = game.iron >= cost.iron && game.ember >= cost.ember;
  const equipped = game.equipped === id, targetTier = tier + 1, targetName = weaponName(id, targetTier);
  const next = nextMilestone(Math.max(0, tier)), reachedNext = MILESTONES.find(m => m.tier === targetTier);
  $('page-equipment').innerHTML = `<div class="page-title"><h1>装備</h1><p>大剣と双剣は、同じ強化段階なら総ダメージが同じ。節目の段階で見た目が変わります。</p></div>
    <div class="equipment-grid"><div class="portrait ${lastForge?.weapon === game.equipped ? 'after-forge' : ''}">${portraitSvg(game.equipped, game.tiers[game.equipped], 'fullbody')}
      <p class="tiny muted">《${esc(weaponName(game.equipped, game.tiers[game.equipped]))}》${game.titles.length ? ' · ' + esc(game.titles.at(-1)) : ''}</p>
      <div class="statrow"><div><b>${game.level}</b>レベル</div><div><b>${game.attack}</b>攻撃力</div><div><b>+${game.tiers[game.equipped]}</b>強化</div></div>
      <div class="bar exp" style="margin-top:14px"><span style="width:${game.xp % 50 / 50 * 100}%"></span></div><p class="tiny muted" style="text-align:right">EXP ${game.xp % 50} / 50</p></div>
    <div><div class="segmented wide">${WEAPONS.map(w => `<button class="${w.id === id ? 'active' : ''}" data-action="select-weapon" data-weapon="${w.id}">${w.name} ${game.tiers[w.id] < 0 ? '· 未鍛造' : '+' + game.tiers[w.id]}${w.id === game.equipped ? ' · 装備中' : ''}</button>`).join('')}</div>
      <article class="panel weapon-panel"><div class="forge-preview"><div class="preview-person">${portraitSvg(id, Math.max(0, tier))}<small>${owned ? '現在' : '未鍛造'}</small><strong>${owned ? esc(weaponName(id, tier)) : '—'}</strong></div><span class="muted">${icon('arrow', 20)}</span><div class="preview-person after">${portraitSvg(id, targetTier)}<small>鍛造後${reachedNext ? ' · 見た目が変わる' : ''}</small><strong>${esc(targetName)}</strong></div></div>
      ${reachedNext ? `<p class="tiny gold center">次の強化で「${reachedNext.label}」</p>` : ''}
      <div class="costrow"><span>鉄片 ${game.iron} / ${cost.iron}</span><span>熾火 ${game.ember} / ${cost.ember}</span></div>
      <button class="${can ? 'primary' : 'secondary'} full" data-action="forge" data-weapon="${id}" ${can ? '' : 'disabled'}>${icon('hammer', 15)}${can ? owned ? '強化して装備する' : '鍛造して装備する' : '鉄片あと ' + Math.max(0, cost.iron - game.iron) + (cost.ember > game.ember ? ' · 熾火あと ' + (cost.ember - game.ember) : '')}</button>
      ${owned && !equipped ? `<button class="secondary full" style="margin-top:10px" data-action="equip" data-weapon="${id}">今の段階で装備する</button>` : ''}
      ${lastForge?.weapon === id ? `<p class="tiny gold center" style="margin-top:12px">《${esc(lastForge.name)}》を鍛造しました。</p>` : ''}</article>
      <section class="panel milestones"><h2>見た目の節目</h2>${MILESTONES.map(m => `<div class="milestone ${Math.max(0, tier) >= m.tier ? 'reached' : next && m.tier === next.tier ? 'next' : ''}"><span>+${m.tier}</span>${m.label}${next && m.tier === next.tier ? `<small>あと${m.tier - Math.max(0, tier)}回</small>` : ''}</div>`).join('')}</section>
    </div></div>`;
}

/* ---------- camp / records ---------- */
function allResults() { return [...(state.legacyResults || []), ...game.results]; }
function resultsForDay(day) { return allResults().filter(r => r.day === day); }
function dayAchievements(day) {
  const results = resultsForDay(day), crafts = game.craftResults.filter(r => r.day === day);
  return [
    ...results.flatMap(r => r.victory ? [REGIONS[r.region].name + 'を踏破'] : r.broken ? r.broken.map(e => e + 'を撃破') : r.breakthrough ? [r.encounter + 'を突破'] : []),
    ...results.filter(r => r.goalDone).map(r => '週目標「' + r.goalDone + '」を達成'),
    ...crafts.map(c => '《' + c.name + '》を鍛造')
  ];
}
function renderCamp() {
  const records = allResults(), since = addDays(today(), -6);
  const recent = records.filter(r => r.day >= since && r.day <= today());
  const mainDays = Object.keys(state.main).filter(d => d >= since && d <= today());
  const completedMainDays = new Set(records.filter(r => r.main).map(r => r.day));
  const rate = mainDays.length ? Math.round(mainDays.filter(d => completedMainDays.has(d)).length / mainDays.length * 100) : 0;
  const started = state.tasks.filter(t => t.firstStart && localDay(new Date(t.firstStart)) >= since);
  const latency = started.length ? Math.round(started.reduce((n, t) => n + Math.max(0, t.firstStart - t.createdAt), 0) / started.length / 60000) : 0;
  const days = Object.keys(state.daily).sort().reverse(), archived = state.tasks.filter(t => t.deleted);
  $('page-camp').innerHTML = `<div class="page-title"><h1>記録</h1><p>休む日に失うものはありません。</p></div>
    <div class="camp-grid"><div>
      <section class="panel"><h2>直近7日</h2><div class="metrics"><div class="metric"><b>${recent.length}</b>完了した任務</div><div class="metric"><b>${rate}%</b>主目標の達成率</div><div class="metric"><b>${started.length}</b>取りかかった任務</div><div class="metric"><b>${latency}分</b>登録から着手まで</div></div></section>
      <section class="panel"><div class="section-head"><h2>日ごとのまとめ</h2><button class="secondary small" data-action="end-day">${state.daily[today()] ? '今日のまとめ' : '今日を終える'}</button></div>${days.slice(0, 5).map(d => `<div class="daily-record"><h3>${shortDay(d)}（${weekdayOf(d)}）</h3><p>${resultsForDay(d).map(r => esc(r.title)).join('、') || '休息の日。'}${state.daily[d].tomorrow ? '<br>次の一歩：' + esc(state.daily[d].tomorrow) : ''}${state.daily[d].note ? '<br>' + esc(state.daily[d].note) : ''}</p></div>`).join('') || '<p class="tiny muted">一日の終わりに「今日の遠征を終える」と、ここに残ります。</p>'}</section>
      ${game.projects.length ? `<section class="panel"><h2>プロジェクト</h2>${game.projects.map(p => `<div class="daily-record"><div class="between"><h3>${esc(p.name)}</h3><span class="tiny muted">${p.done} / ${p.total}</span></div><div class="bar exp"><span style="width:${p.done / p.total * 100}%"></span></div></div>`).join('')}</section>` : ''}
      <details class="panel"><summary>旅の記録（${records.length}件）</summary><div class="history">${[...records].reverse().slice(0, 60).map(r => `<div><span class="gold">${esc(r.day)}${r.main ? ' · 主目標' : ''}</span> ${esc(r.title)}<br><span class="muted">鉄片 +${r.iron || 0} / EXP +${r.xp || 0}${r.victory ? ' / 地域踏破' : ''}</span></div>`).join('') || '<p class="tiny muted">最初の任務が、この記録の始まりになる。</p>'}${(state.legacyLogs || []).map(l => '<div><span class="muted">旧版の記録</span><br>' + esc(l) + '</div>').join('')}</div></details>
    </div><div>
      <section class="panel"><h2>設定とバックアップ</h2><div class="setting"><label for="soundSetting">音を有効にする</label><input id="soundSetting" type="checkbox" ${state.settings.mute ? '' : 'checked'}></div><div class="setting"><label for="volumeSetting">音量</label><input id="volumeSetting" type="range" min="0" max="1" step="0.05" value="${state.settings.volume}"></div><div class="setting"><label for="motionSetting">動きを抑える</label><input id="motionSetting" type="checkbox" ${state.settings.reduced ? 'checked' : ''}></div><p class="tiny muted" style="margin:14px 0">このブラウザに自動保存。別端末へはJSONで移します（同期なし）。</p><div class="flex"><button class="secondary" data-action="export">${icon('download', 14)}書き出し</button><button class="secondary" data-action="import">${icon('upload', 14)}復元</button></div></section>
      ${archived.length ? `<details class="panel"><summary>保管した任務（${archived.length}件）</summary>${archived.map(t => `<div class="between" style="margin:10px 0"><span class="tiny">${esc(t.title)}</span><button class="ghost" data-action="restore-task" data-id="${esc(t.id)}">戻す</button></div>`).join('')}</details>` : ''}
      <details class="panel"><summary>使い心地の振り返り（任意）</summary><form id="feedbackForm"><label class="field" for="rewardRating">報酬を見る楽しさ</label><select id="rewardRating" name="reward">${[1,2,3,4,5].map(n => `<option value="${n}" ${n === 3 ? 'selected' : ''}>${n}${n === 1 ? ' · あまり感じない' : n === 5 ? ' · 次も見たい' : ''}</option>`).join('')}</select><label class="field" for="entryRating">入力の手間</label><select id="entryRating" name="entry">${[1,2,3,4,5].map(n => `<option value="${n}" ${n === 3 ? 'selected' : ''}>${n}${n === 1 ? ' · とても簡単' : n === 5 ? ' · 面倒' : ''}</option>`).join('')}</select><label class="field" for="feedbackNote">重要な任務は進みましたか？</label><textarea id="feedbackNote" name="note" maxlength="1000"></textarea><button class="secondary" style="margin-top:14px" type="submit">振り返りを残す</button></form>${(state.feedback || []).slice(-3).reverse().map(f => `<p class="tiny muted" style="margin-top:16px">${esc(f.day)} · 楽しさ ${esc(f.reward)}/5 · 手間 ${esc(f.entry)}/5<br>${esc(f.note)}</p>`).join('')}</details>
    </div></div>`;
}

/* ---------- action menu ---------- */
function openMenu(title, items) {
  $('menuTitle').textContent = title;
  $('menuItems').innerHTML = items.map(x => `<button class="menu-item ${x.danger ? 'danger' : ''}" data-action="${x.action}" data-id="${esc(x.id)}">${icon(x.icon, 17)}<span>${x.label}${x.desc ? `<small>${x.desc}</small>` : ''}</span></button>`).join('');
  $('menuDialog').showModal();
}
function taskMenu(t) {
  const items = [], repeating = t.repeat !== 'none';
  if (live(t)) {
    items.push({ action: 'start', icon: 'arrow', label: '取りかかる', desc: '最初の一歩だけを表示' });
    if (state.main[today()] !== t.id) items.push({ action: 'main', icon: 'target', label: '今日の主目標にする' });
    else items.push({ action: 'unmain', icon: 'target', label: '主目標から外す' });
    if (!isToday(t)) items.push({ action: 'assign-today', icon: 'sun', label: '今日やる' });
    items.push({ action: 'edit', icon: 'edit', label: '編集' });
    if (repeating) {
      items.push({ action: 'skip', icon: 'skip', label: '今回だけスキップ', desc: '次の回は予定どおり作られます' });
      items.push({ action: 'stop-repeat', icon: 'stop', label: '今後の繰り返しを停止', desc: '今回の分は残し、次の回を作りません' });
    }
  }
  if (t.skipped) items.push({ action: 'unskip', icon: 'undo', label: 'スキップを取り消す' });
  if (done(t) && game.results.some(r => r.taskId === t.id)) items.push({ action: 'undo', icon: 'undo', label: '完了を取り消す', desc: '素材・突破・鍛造を再計算します' });
  items.push({ action: 'archive', icon: 'archive', label: '保管する', desc: repeating && !superseded(t) ? '一覧から外し、繰り返しも終えます（記録タブから戻せます）' : '一覧から外します（記録タブから戻せます）', danger: true });
  openMenu(t.title, items.map(x => ({ ...x, id: t.id })));
}
function goalMenu(g) {
  openMenu(g.title, [
    { action: 'assign-goal', icon: 'sun', label: '今日やる', id: g.id },
    { action: 'edit-goal', icon: 'edit', label: '編集', id: g.id },
    { action: 'archive-goal', icon: 'archive', label: '目標を外す', desc: g.weekly ? '今週分を外し、来週以降も作りません' : '今週の目標から外します', danger: true, id: g.id }
  ]);
}

/* ---------- task dialog ---------- */
function openTask(id, preset = {}) {
  const form = $('taskForm'); form.reset();
  form.elements.namedItem('id').value = id || '';
  form.elements.namedItem('scheduled').value = today();
  const goalSelect = form.elements.namedItem('goalId');
  goalSelect.innerHTML = '<option value="">なし</option>' + currentGoals().map(g => `<option value="${esc(g.id)}">${esc(g.title)}（${g.target === 1 ? '今週中' : '週' + g.target + '回'}）</option>`).join('');
  $('taskDetails').open = false;
  const task = state.tasks.find(t => t.id === id);
  if (task) {
    for (const name of ['id','title','minutes','repeat','condition','step','due','scheduled','priority','project','goalId']) {
      const input = form.elements.namedItem(name);
      if (name === 'minutes' && ![...input.options].some(o => o.value === String(task.minutes))) input.add(new Option(task.minutes + '分', task.minutes));
      if (name === 'goalId' && task.goalId && ![...input.options].some(o => o.value === task.goalId)) input.add(new Option('（先週以前の目標）', task.goalId));
      input.value = task[name] ?? '';
    }
    form.elements.namedItem('energy').value = task.autoEnergy ? 'auto' : task.energy;
    $('taskDetails').open = true;
  }
  for (const [k, v] of Object.entries(preset)) form.elements.namedItem(k).value = v;
  $('taskDialogTitle').textContent = id ? '任務を編集' : '任務を追加';
  updateRewardHint(); fillIcons($('taskDialog')); $('taskDialog').showModal();
}
function updateRewardHint() {
  const f = $('taskForm'), minutes = Number(f.elements.namedItem('minutes').value);
  const mode = f.elements.namedItem('energy').value, energy = mode === 'auto' ? energyFor(minutes) : Number(mode);
  $('autoReward').textContent = `報酬：行動力 ${energy}${mode !== 'auto' ? '（手動）' : '（目安時間から自動）'}`;
}
function templateTask(name) {
  const f = $('taskForm');
  const templates = {
    study: { title: '勉強を25分進める', minutes: 25, step: '教材を開き、最初の問題に取りかかる', condition: '25分取り組み、今回進めた範囲を記録する' },
    laundry: { title: '洗濯をする', minutes: 10, step: '洗濯物を集める', condition: '洗濯物を洗濯機に入れ、運転を始める' },
    mail: { title: '必要なメールに返信する', minutes: 5, step: '返信するメールを1通開く', condition: '返信文を見直して、送信する' }
  };
  const t = templates[name]; if (!t) return;
  for (const k of ['title','minutes','step','condition']) f.elements.namedItem(k).value = t[k];
  f.elements.namedItem('energy').value = 'auto'; updateRewardHint();
}
$('taskForm').addEventListener('change', updateRewardHint);
$('taskForm').addEventListener('submit', event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  data.title = data.title.trim(); if (!data.title) return;
  const minutes = Math.max(1, Math.min(240, Number(data.minutes) || 25));
  const patch = { title: data.title, minutes, energy: data.energy === 'auto' ? energyFor(minutes) : Number(data.energy),
    autoEnergy: data.energy === 'auto', repeat: data.repeat, condition: data.condition.trim(), step: data.step.trim(),
    due: data.due, scheduled: data.scheduled, priority: Number(data.priority), project: data.project.trim(), goalId: data.goalId || '' };
  let task = state.tasks.find(t => t.id === data.id);
  if (task) {
    Object.assign(task, patch);
    if (!done(task)) task.occurrence = task.scheduled || task.occurrence;
  } else {
    const id = uid();
    task = { ...patch, id, seriesId: id, occurrence: data.scheduled || today(), createdAt: Date.now(), firstStart: null, importedDone: false, deleted: false };
    state.tasks.push(task);
    if (!state.main[today()] && task.scheduled === today()) state.main[today()] = id;
  }
  save(); $('taskDialog').close(); render(); toast('任務を保存しました。');
});

/* ---------- focus ---------- */
function startTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task || !live(task)) return;
  if (!task.firstStart) task.firstStart = Date.now();
  if (state.daily[today()]) state.daily[today()].reopened = true;
  focus = { taskId: id, remaining: task.minutes * 60000, running: false, endAt: 0, showTimer: true };
  save(); renderFocus(); $('focusOverlay').classList.add('visible');
  setOutsideInert(true);
  $('focusOverlay').querySelector('[data-action=complete]')?.focus();
  clearInterval(focusTimer); focusTimer = setInterval(updateTimer, 500);
}
function setOutsideInert(value) {
  for (const selector of ['main', 'header', 'nav']) document.querySelector(selector).inert = value;
}
function leaveFocus() {
  focus = null; clearInterval(focusTimer);
  $('focusOverlay').classList.remove('visible'); setOutsideInert(false); render();
}
function remaining() { return focus?.running ? Math.max(0, focus.endAt - Date.now()) : focus?.remaining || 0; }
function renderFocus() {
  const task = state.tasks.find(t => t.id === focus?.taskId); if (!task) return;
  $('focusInner').innerHTML = `<span class="tiny gold">今は、この一歩だけ。</span><h2 id="focusTitle">${esc(task.title)}</h2><div class="first-step">${esc(task.step || '必要な資料や道具を開き、最初の一つに取りかかる。')}</div>${task.condition ? '<p>完了条件：' + esc(task.condition) + '</p>' : ''}
    <div class="${focus.showTimer ? '' : 'hidden'}"><div class="timer" id="timerText"></div><button class="secondary" data-action="timer">${focus.running ? '一時停止' : 'タイマーを始める'}</button></div>
    <button class="ghost" data-action="toggle-timer">${focus.showTimer ? 'タイマーを隠す' : 'タイマーを表示'}</button>
    <button class="primary" data-action="complete" data-id="${esc(task.id)}">${icon('check', 16)}今回の工程を完了する</button><p class="focus-note" id="timerNote">時間切れだけでは完了しません。課題全体が未完成でも、この工程を果たせば達成です。</p>`;
  updateTimer();
}
function updateTimer() {
  if (!focus || !$('timerText')) return;
  const seconds = Math.ceil(remaining() / 1000);
  $('timerText').textContent = String(Math.floor(seconds / 60)).padStart(2,'0') + ':' + String(seconds % 60).padStart(2,'0');
  if (seconds === 0 && focus.running) {
    focus.running = false; focus.remaining = 0;
    $('timerNote').textContent = '区切りの時間です。今回の成果を確かめてから、完了してください。';
  }
}

/* ---------- complete / animation ---------- */
function completeTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task || !live(task)) return;
  const event = { id: uid(), type: 'complete', taskId: id, title: task.title, energy: task.energy,
    main: state.main[today()] === id, day: today(), at: Date.now(), region: state.region, route: state.route };
  state.events.push(event); lastResultSession = event.id;
  save(); // Persist before any presentation or animation.
  if (focus) leaveFocus(); else render();
  const result = game.results.find(r => r.eventId === event.id);
  if (view === 'today') window.scrollTo({ top: 0, behavior: fast() ? 'instant' : 'smooth' });
  if (result?.goalDone) toast(`週の目標「${result.goalDone}」を達成！ 鉄片+3・熾火+1`);
  if (result && view === 'today') { animationQueue.push(result); if (!animating) playNext(); }
}
function playNext() {
  if (!animationQueue.length) { animating = false; return; }
  animating = true;
  const r = animationQueue.shift();
  if (view !== 'today' || state.region !== r.region) { playNext(); return; }
  const steps = r.segments.length ? r.segments : [{ kind: r.repeat ? 'repeat' : 'none' }];
  let index = 0;
  const step = () => {
    if (view !== 'today' || !$('battleScene')) { playNext(); return; }
    if (index >= steps.length) {
      $('battleScene').outerHTML = sceneBlock();
      if (r.victory) toast(REGIONS[r.region].name + 'を踏破。次の地域が解放されました。');
      playNext(); return;
    }
    const seg = steps[index], first = index === 0;
    const frame = { ...game, stages: [...game.stages], health: game.health.map(a => [...a]), tiers: { ...game.tiers }, cleared: [...game.cleared], equipped: r.weapon };
    frame.tiers[r.weapon] = r.tier;
    if (seg.index !== undefined) { frame.stages[r.region] = seg.index; frame.health[r.region][seg.index] = seg.beforeHp; frame.cleared[r.region] = false; }
    $('battleScene').outerHTML = sceneBlock(frame);
    const scene = $('battleScene'), message = $('animationMessage'), number = $('damageNumber');
    const strike = seg.damage > 0;
    if (strike) scene.classList.add('striking');
    if (strike && r.weapon === 'dual') scene.classList.add('dual');
    message.classList.remove('hidden');
    message.textContent = seg.kind === 'cache' ? '鍛造資材を回収した。'
      : seg.kind === 'repeat' ? '踏破した道で、素材を集めた。'
        : !strike ? 'その行動を、次の一撃に。'
          : !first ? `余剰 ${seg.damage} が${seg.enemy}へ` + (seg.broke ? ' — 撃破' : '')
            : r.victory && seg.broke && index === steps.length - 1 ? '闇に、道を開いた。'
              : seg.broke ? seg.enemy + 'を撃破。'
                : seg.phaseAfter > seg.phaseBefore ? `${seg.enemy}：${PHASES[seg.phaseAfter]}`
                  : r.weapon === 'dual' ? '三つの刃が、闇を裂く。' : 'その行動を、一撃に。';
    number.textContent = strike ? (r.weapon === 'dual' ? hitValues(seg.damage, 'dual').join(' + ') : seg.damage) : '';
    sound(r.victory && index === steps.length - 1 ? 'victory' : seg.kind === 'cache' ? 'forge' : 'strike', r.region);
    if (r.weapon === 'dual' && strike) soundTimer = setTimeout(() => sound('strike', r.region), 270);
    if (strike) barTimer = setTimeout(() => {
      const bar = $('sceneBar'), hp = $('sceneHp');
      if (bar && seg.maxHp) bar.style.width = seg.afterHp / seg.maxHp * 100 + '%';
      if (hp && seg.maxHp) hp.textContent = seg.afterHp + ' / ' + seg.maxHp;
    }, fast() ? 0 : 650);
    index++;
    clearTimeout(animationTimer);
    animationTimer = setTimeout(step, fast() ? 150 : seg.kind === 'cache' ? 1200 : 1800);
  };
  step();
}
function sound(kind, region = state.region) {
  if (state.settings.mute) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume();
    const now = audioCtx.currentTime, notes = kind === 'victory' ? [110,146.83,220] : kind === 'forge' ? [294,147,73] : [85,68,56];
    notes.forEach((hz, index) => {
      const oscillator = audioCtx.createOscillator(), gain = audioCtx.createGain(), t = now + index * .1;
      oscillator.type = kind === 'strike' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(hz * (1 + region * .12), t);
      oscillator.frequency.exponentialRampToValueAtTime(hz * .6, t + .3);
      gain.gain.setValueAtTime(.0001, t); gain.gain.exponentialRampToValueAtTime(Math.max(.0001, state.settings.volume * .25), t + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, t + .75);
      oscillator.connect(gain); gain.connect(audioCtx.destination); oscillator.start(t); oscillator.stop(t + .8);
    });
  } catch (error) { /* Audio is optional. */ }
}
function confirmAction(title, message, callback) {
  $('confirmTitle').textContent = title; $('confirmText').textContent = message;
  confirmCallback = callback; $('confirmDialog').showModal();
}
function undoTask(id) {
  const event = state.events.find(e => e.type === 'complete' && e.taskId === id);
  if (!event) return;
  confirmAction('完了を取り消しますか？', '素材・経験値・突破を再計算します。素材が足りなくなった鍛造も取り消されます。', () => {
    state.events = state.events.filter(e => e.id !== event.id);
    clearAnimation(); lastResultSession = null;
    const invalid = new Set(replay(state).invalid);
    state.events = state.events.filter(e => !invalid.has(e.id));
    save(); render(); toast(invalid.size ? '完了を取り消し、成立しなくなった鍛造も戻しました。' : '完了と、その成果を取り消しました。');
  });
}
function forge(id) {
  if (!WEAPONS.some(w => w.id === id)) return;
  const cost = forgeCost(game.tiers[id]);
  if (game.iron < cost.iron || game.ember < cost.ember) return;
  const tier = game.tiers[id] + 1, milestone = MILESTONES.find(m => m.tier === tier);
  state.events.push({ id: uid(), type: 'forge', weapon: id, targetTier: tier, day: today(), at: Date.now() });
  lastForge = { weapon: id, name: weaponName(id, tier) }; selectedWeapon = id;
  save(); render(); sound('forge'); toast('《' + lastForge.name + '》を鍛造。' + (milestone ? milestone.label + '。' : ''));
}

/* ---------- end of day ---------- */
function openEndDay() {
  const day = today(), existing = state.daily[day], results = resultsForDay(day), achievements = dayAchievements(day);
  $('endSummary').innerHTML = `<div class="summary-part"><h3>現実で進めたこと · ${results.length}件</h3>${results.length ? '<ul>' + results.map(r => '<li>' + esc(r.title) + (r.main ? '（主目標）' : '') + '</li>').join('') + '</ul>' : '<p class="tiny muted">今日は休息の日。装備や成長は失われません。</p>'}</div>
    <div class="summary-part"><h3>冒険の成果</h3>${achievements.length ? '<ul>' + achievements.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul>' : '<p class="tiny muted">' + (results.length ? '次の突破に向けた一撃と素材が残りました。' : '焚き火は、まだ消えていない。') + '</p>'}<p class="tiny gold" style="margin-top:8px">鉄片 +${results.reduce((n, r) => n + (r.iron || 0), 0)} / EXP +${results.reduce((n, r) => n + (r.xp || 0), 0)}</p></div>`;
  $('endForm').reset(); $('tomorrowStep').value = existing?.tomorrow || ''; $('dayNote').value = existing?.note || '';
  $('endDialog').showModal(); fillIcons($('endDialog'));
}
$('endForm').addEventListener('submit', event => {
  event.preventDefault();
  const form = new FormData(event.target), day = today(), tomorrow = String(form.get('tomorrow') || '').trim();
  const record = { ...state.daily[day], tomorrow, note: String(form.get('note') || '').trim(), closedAt: Date.now(), reopened: false };
  if (tomorrow && form.get('plan')) {
    const nextDay = addDays(day, 1); let task = state.tasks.find(t => t.id === record.tomorrowTaskId);
    if (task && !done(task)) { task.title = tomorrow; task.step = tomorrow; task.scheduled = nextDay; task.deleted = false; }
    else if (!task) {
      const id = uid(); task = { id, seriesId: id, title: tomorrow, step: tomorrow, condition: '', minutes: 25, energy: 2, autoEnergy: true, repeat: 'none', occurrence: nextDay, scheduled: nextDay, due: '', priority: 2, project: '', createdAt: Date.now(), firstStart: null, importedDone: false, deleted: false };
      state.tasks.push(task); record.tomorrowTaskId = id;
    }
    if (task && !done(task)) state.main[nextDay] = task.id;
  }
  state.daily[day] = record;
  save(); $('endDialog').close(); clearAnimation(); lastResultSession = null; render();
  toast('今日の遠征を終えました。お疲れさまでした。');
});

/* ---------- backup ---------- */
function exportSave() {
  EmberStorage.download('emberquest-save-' + today() + '.json', EmberStorage.serialize(state), 'application/json');
  toast('JSONバックアップを書き出しました。');
}
$('importFile').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) { toast('20MB以下のJSONバックアップを選んでください。'); return; }
  try {
    const next = EmberStorage.parse(await file.text());
    confirmAction('バックアップから復元しますか？', next.tasks.filter(t => !t.deleted).length + '件の任務を読み込み、現在の進捗を置き換えます。必要なら先にJSONを書き出してください。', () => {
      clearAnimation(); state = next; if (!state.goals) state.goals = []; lastResultSession = null; lastForge = null; game = replay(state); refreshRecurrence(); game = replay(state); selectedWeapon = game.equipped;
      save(); render(); toast('任務・装備・遠征の記録を復元しました。');
    });
  } catch (error) { toast('復元できません：' + error.message); }
});
$('confirmNo').onclick = () => { confirmCallback = null; $('confirmDialog').close(); };
$('confirmYes').onclick = () => { const callback = confirmCallback; confirmCallback = null; $('confirmDialog').close(); callback?.(); };
$('confirmDialog').addEventListener('cancel', () => { confirmCallback = null; });

/* ---------- events ---------- */
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  if (button.closest('#menuDialog')) $('menuDialog').close();
  const action = button.dataset.action, id = button.dataset.id, task = state.tasks.find(t => t.id === id), goal = state.goals.find(g => g.id === id);
  switch (action) {
    case 'nav': navigate(button.dataset.view); break;
    case 'add': openTask(); break;
    case 'add-weekly': openTask(null, { repeat: 'weekly' }); break;
    case 'edit': openTask(id); break;
    case 'menu': if (task) taskMenu(task); break;
    case 'close-menu': $('menuDialog').close(); break;
    case 'template': templateTask(button.dataset.template); break;
    case 'close-task': $('taskDialog').close(); break;
    case 'close-goal': $('goalDialog').close(); break;
    case 'main':
      if (task && live(task)) { state.main[today()] = id; task.scheduled = today(); if (state.daily[today()]) state.daily[today()].reopened = true; save(); render(); toast('今日の主目標にしました。'); }
      break;
    case 'unmain': delete state.main[today()]; save(); render(); break;
    case 'assign-today': if (task && live(task)) { task.scheduled = today(); save(); render(); toast('今日の任務に入れました。'); } break;
    case 'skip':
      if (task && live(task)) { skipOccurrence(task); if (state.main[today()] === id) delete state.main[today()]; save(); render(); toast('今回だけスキップしました。次の回は予定どおり作られます。'); }
      break;
    case 'unskip': if (task) { task.skipped = false; save(); render(); } break;
    case 'stop-repeat':
      if (task) confirmAction('今後の繰り返しを停止しますか？', `「${task.title}」の次の回を作らなくなります。今回の分は残ります。`, () => { stopSeries(state, task.seriesId); save(); render(); toast('繰り返しを停止しました。今回の分は残っています。'); });
      break;
    case 'start': startTask(id); break;
    case 'leave-focus': leaveFocus(); break;
    case 'toggle-timer': if (focus) { focus.showTimer = !focus.showTimer; renderFocus(); } break;
    case 'timer':
      if (!focus) break;
      if (focus.running) { focus.remaining = remaining(); focus.running = false; }
      else { if (focus.remaining <= 0) focus.remaining = (state.tasks.find(t => t.id === focus.taskId)?.minutes || 25) * 60000; focus.endAt = Date.now() + focus.remaining; focus.running = true; }
      renderFocus(); break;
    case 'complete': completeTask(id); break;
    case 'undo': undoTask(id); break;
    case 'archive':
      if (task) { task.deleted = true; if (state.main[today()] === id) delete state.main[today()]; save(); render(); toast('保管しました。記録タブから戻せます。'); }
      break;
    case 'restore-task': if (task) { task.deleted = false; refreshRecurrence(); save(); render(); } break;
    case 'filter': filter = button.dataset.filter; renderToday(); fillIcons($('page-today')); break;
    case 'add-goal': openGoal(); break;
    case 'edit-goal': openGoal(id); break;
    case 'goal-menu': if (goal) goalMenu(goal); break;
    case 'assign-goal': assignGoal(id); break;
    case 'assign-weekly': assignWeekly(id); break;
    case 'archive-goal': if (goal) { goal.deleted = true; save(); render(); toast('目標を外しました。'); } break;
    case 'route': state.route = button.dataset.route; save(); render(); break;
    case 'region':
      if (Number(button.dataset.region) <= game.unlocked) { clearAnimation(); state.region = Number(button.dataset.region); save(); render(); sound('victory'); toast(REGIONS[state.region].name + 'へ向かいます。'); }
      break;
    case 'select-weapon': selectedWeapon = button.dataset.weapon; renderEquipment(); fillIcons($('page-equipment')); break;
    case 'forge': forge(button.dataset.weapon); break;
    case 'equip':
      if (game.tiers[button.dataset.weapon] >= 0) { state.events.push({ id: uid(), type: 'equip', weapon: button.dataset.weapon, day: today(), at: Date.now() }); save(); render(); sound('forge'); toast('装備を変更しました。'); }
      break;
    case 'mute': state.settings.mute = !state.settings.mute; save(); render(); if (!state.settings.mute) sound('forge'); break;
    case 'end-day': openEndDay(); break;
    case 'close-end': $('endDialog').close(); break;
    case 'export': exportSave(); break;
    case 'import': $('importFile').click(); break;
  }
});
document.addEventListener('change', event => {
  if (event.target.id === 'soundSetting') { state.settings.mute = !event.target.checked; save(); render(); sound('forge'); }
  if (event.target.id === 'volumeSetting') { state.settings.volume = Number(event.target.value); save(); sound('forge'); }
  if (event.target.id === 'motionSetting') { state.settings.reduced = event.target.checked; clearAnimation(); save(); render(); }
});
document.addEventListener('submit', event => {
  if (event.target.id !== 'feedbackForm') return;
  event.preventDefault(); const data = new FormData(event.target);
  state.feedback.push({ day: today(), reward: Number(data.get('reward')), entry: Number(data.get('entry')), note: String(data.get('note') || '').slice(0,1000) });
  save(); render(); toast('振り返りを残しました。');
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && focus) leaveFocus();
  if (event.key === 'Tab' && focus) {
    const controls = [...$('focusOverlay').querySelectorAll('button:not(:disabled)')].filter(b => b.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
function refreshDay() {
  if (today() !== lastDay) {
    lastDay = today(); refreshRecurrence();
    if (!focus) render();
  }
}
setInterval(refreshDay, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateTimer(); refreshDay(); } });
refreshRecurrence(); render();
if (loaded.notice) toast(loaded.notice);
