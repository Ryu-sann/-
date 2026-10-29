/* UI controller. Game state lives in game.js; recurrence in tasks.js;
   persistence in storage.js; all illustrations in art.js. */
'use strict';
const { REGIONS, WEAPONS, replay, currentEncounter, forgeCost, weaponName, artWeapon, preview, localDay } = EmberGame;
const { addDays, energyFor, recurrence } = EmberTasks;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const uid = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
const today = () => localDay();
const loaded = EmberStorage.load();
let state = loaded.state, game = replay(state), view = 'tasks', filter = 'today', showAll = false;
let focus = null, focusTimer, toastTimer, confirmCallback, lastDay = today();
let animationQueue = [], animating = false, animationTimer, soundTimer, audioCtx, lastResultSession = null;
let selectedWeapon = game.equipped, lastForge = null;

function save() {
  try { EmberStorage.save(state); return true; }
  catch (error) { toast('保存できませんでした。拠点からJSONバックアップを書き出してください。'); return false; }
}
function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 5500);
}
function fillIcons(scope = document) {
  scope.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
}
const done = task => task.importedDone || game.done.has(task.id);
function superseded(task) {
  return task.repeat !== 'none' && state.tasks.some(other => other.seriesId === task.seriesId && other.occurrence > task.occurrence);
}
function activeTasks() { return state.tasks.filter(t => !t.deleted && !done(t) && !superseded(t)); }
function sorted(tasks) {
  return [...tasks].sort((a, b) => {
    const ad = a.due || '9999', bd = b.due || '9999';
    return (ad < today() ? -1 : 0) - (bd < today() ? -1 : 0) || b.priority - a.priority || ad.localeCompare(bd) || a.createdAt - b.createdAt;
  });
}
function primaryTask() { return activeTasks().find(t => t.id === state.main[today()]) || null; }
function refreshRecurrence() {
  if (recurrence(state, today(), uid)) save();
}
function clearAnimation() {
  clearTimeout(animationTimer); clearTimeout(soundTimer);
  animationQueue = []; animating = false;
}
function navigate(next) {
  if (!['tasks', 'adventure', 'equipment', 'camp'].includes(next)) return;
  clearAnimation(); view = next; render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function render() {
  game = replay(state);
  state.region = Math.min(state.region, game.unlocked);
  document.body.classList.toggle('reduced', state.settings.reduced);
  $('headerStats').innerHTML = `<span>Lv. ${game.level}<span class="header-title">　灰の旅人</span></span>
    <span class="gold">${icon('hammer', 14)} ${game.iron}<span class="iron-label"> 鉄片</span></span>
    <button class="iconbtn" data-action="mute" aria-label="${state.settings.mute ? '音をオンにする' : '音をミュートする'}">${icon('volume', 15)}${state.settings.mute ? '<span style="font-size:9px;margin-left:4px">OFF</span>' : ''}</button>`;
  renderHome(); renderAdventure(); renderEquipment(); renderCamp();
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + view));
  document.querySelectorAll('[data-action=nav]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  fillIcons();
}
function sceneBlock(displayGame = game) {
  const i = state.region, r = REGIONS[i], e = currentEncounter(displayGame, i);
  const isFight = ['combat', 'boss'].includes(e.kind);
  const caption = e.kind === 'repeat' ? '烽火は、この地に残る。' : e.kind === 'cache' ? '廃営地に、鍛造の手がかり。' : e.kind === 'boss' ? 'この一撃が、門を開く。' : '闇の向こうへ、踏み出せ。';
  return `<div class="scene" id="battleScene">
    ${sceneArt(i, artWeapon(displayGame.equipped, displayGame.tiers[displayGame.equipped]), displayGame)}
    <div class="scenetop"><span class="scene-tag">${esc(e.name)}</span><span>${e.kind === 'repeat' ? '踏破済み' : e.index + 1 + ' / 4'}</span></div>
    <div class="scene-caption"><div class="boss-row"><span>${esc(e.enemy || r.name + 'を踏破')}</span><span>${isFight ? e.hp + ' / ' + e.maxHp + ' HP' : e.kind === 'cache' ? '次の任務で回収' : '再探索できる'}</span></div>
      <div class="bar ${isFight ? '' : 'muted-bar'}"><span style="width:${isFight ? e.hp / e.maxHp * 100 : 100}%"></span></div><h2>${caption}</h2></div>
    <div id="animationMessage" class="animation-message hidden" aria-live="polite"></div><div id="damageNumber" class="damage-number"></div>
  </div>`;
}
function mainCard(task) {
  return `<article class="main-task"><div class="between"><span class="main-label">${icon('target', 13)}今日の主目標</span><div><button class="iconbtn" data-action="edit" data-id="${esc(task.id)}" aria-label="主目標を編集">${icon('edit', 15)}</button><button class="ghost" data-action="unmain">変更</button></div></div>
    <h2>${esc(task.title)}</h2><div class="tagrow"><span class="tag">${icon('clock', 12)}${task.minutes}分</span>${task.due ? `<span class="tag ${task.due < today() ? 'urgent' : ''}">${task.due < today() ? '期限超過 ' : ''}${esc(task.due)}</span>` : ''}${task.repeat !== 'none' ? `<span class="tag">${task.repeat === 'daily' ? '毎日' : '毎週'}</span>` : ''}</div>
    <div class="stepbox"><span class="caption">次の一歩</span>${esc(task.step || '必要な資料や道具を開き、最初の一つに取りかかる。')}</div>
    ${task.condition ? `<p class="condition">今回の完了条件：${esc(task.condition)}</p>` : ''}
    <button class="primary full" data-action="start" data-id="${esc(task.id)}">${icon('arrow', 16)}${task.firstStart ? '続きに取りかかる' : '取りかかる'}</button></article>`;
}
function rewardForecast(task) {
  const forecast = preview(state, task, today());
  if (!forecast) return '';
  const change = forecast.willForge ? `この任務で、《${forecast.target}》を鍛造できる。`
    : forecast.victory ? 'この任務で、番人を突破し、新しい景色へ。'
      : forecast.breakthrough ? `${forecast.encounter}を突破し、${forecast.next}へ進む。`
        : forecast.kind === 'repeat' ? '踏破した道から、次の鍛造の素材を持ち帰る。'
          : `${forecast.enemy}に ${forecast.damage} ダメージ。次の一撃を刻む。`;
  return `<div class="reward-preview"><span class="icon">${icon(forecast.willForge ? 'hammer' : 'sword', 20)}</span><div>
    <div class="headline">${esc(change)}</div><p>鉄片 +${forecast.iron}${forecast.ember ? ' ・ 熾火 +' + forecast.ember : ''} ・ EXP +${forecast.xp}${!forecast.willForge ? '<br>鍛造まで、鉄片あと ' + forecast.needIron + ' 個' + (forecast.needEmber ? '・熾火あと ' + forecast.needEmber + ' 個' : '') : ''}</p></div></div>`;
}
function onboardingPreview() {
  const target = weaponName(game.equipped, game.tiers[game.equipped] + 1), cost = forgeCost(game.tiers[game.equipped]);
  return `<div class="first-preview">${portraitSvg(game.equipped, game.tiers[game.equipped] + 1)}<div><h3>次の姿を、先に見る。</h3><p>《${target}》<br>鉄片 ${game.iron} / ${cost.iron}。次の主目標でも、確実に近づく。</p><button class="ghost gold" data-action="nav" data-view="equipment">鍛造後の姿を見る →</button></div></div>`;
}
function renderHome() {
  const r = REGIONS[state.region], main = primaryTask(), live = activeTasks();
  const eligible = sorted(live.filter(t => t.scheduled && t.scheduled <= today()));
  const recentResult = game.results.find(r => r.eventId === lastResultSession);
  const closed = state.daily[today()] && !state.daily[today()].reopened ? state.daily[today()] : null;
  let mainHtml;
  if (closed) mainHtml = `<div class="main-task"><span class="main-label">今日は、ここまで。</span><h2>果たした一歩を、ここに残す。</h2><p class="condition">${closed.tomorrow ? '明日の一歩：' + esc(closed.tomorrow) : '焚き火は、あなたの次の出発を待っている。'}</p><button class="primary full" data-action="end-day">今日の成果を見る</button></div>`;
  else if (main) mainHtml = mainCard(main);
  else if (eligible.length) {
    const candidate = eligible[0];
    mainHtml = `<div class="main-task"><span class="main-label">今日、果たすことを一つ。</span><h2>${esc(candidate.title)}</h2><p class="condition">今日できる成果を主目標に。追加素材は1日1回です。</p><button class="primary full" data-action="main" data-id="${esc(candidate.id)}">${icon('target', 16)}これを今日の主目標にする</button></div>`;
  } else {
    mainHtml = `<div class="main-task"><span class="main-label">${game.results.length || state.migrated ? '焚き火は、まだ消えていない。' : '最初の一歩'}</span><h2>${game.results.length || state.migrated ? '今日の歩みは、ここに残る。' : '今から行う、小さな用事を。'}</h2><p class="condition">${game.results.length || state.migrated ? '休む日にも、装備や成長は失われません。' : '名前と目安時間だけで登録できます。実際に終えたら、最初の敵を突破。'}</p><button class="primary full" data-action="add">${icon('plus', 16)}任務を追加</button></div>`;
  }
  let tasks = state.tasks.filter(t => !t.deleted && t.id !== (closed ? null : main?.id));
  tasks = tasks.filter(t => filter === 'done' ? done(t) : filter === 'all' ? true : done(t) || superseded(t) ? false
    : filter === 'overdue' ? !!t.due && t.due < today()
      : filter === 'later' ? !t.scheduled || t.scheduled > today()
        : !!t.scheduled && t.scheduled <= today());
  tasks = sorted(tasks);
  const limit = filter === 'today' && !showAll ? Math.max(0, 3 - (main && !closed ? 1 : 0)) : tasks.length;
  const count = game.results.filter(r => r.day === today()).length;
  $('page-tasks').innerHTML = `<div class="chapterbar"><div><div class="chapter-label">${r.sub} · ${game.cleared[state.region] ? '烽火が灯った地' : '現在の遠征'}</div><h1>${r.name}</h1><p class="goal">${r.goal}</p></div><span class="chapterindex">0${state.region + 1}</span></div>
    <div class="home-grid"><div class="visual-col">${sceneBlock()}<p class="intro-copy">${game.cleared[state.region] ? '果たした行動が、世界に残った。次の地域へ進むか、この地で剣を鍛えるか。' : '現実で果たした行動が、この剣の力になる。<br>次の任務が、道の先にある景色を変える。'}</p></div>
    <div class="action-col">${mainHtml}${main && !closed ? rewardForecast(main) : ''}
      ${recentResult && !closed ? compactResult(recentResult) : ''}
      ${game.results.length === 1 && !state.migrated && !closed ? onboardingPreview() : ''}
      <div class="task-section"><div class="section-head"><h2>そのほかの任務</h2><button class="ghost" data-action="add">${icon('plus', 14)}任務を追加</button></div>
        <div class="filters">${[['today','今日'],['overdue','期限超過'],['later','後で'],['done','完了'],['all','すべて']].map(([id, label]) => `<button class="filter ${filter === id ? 'active' : ''}" data-action="filter" data-filter="${id}">${label}</button>`).join('')}</div>
        ${tasks.length ? tasks.slice(0, limit).map(taskRow).join('') : '<div class="empty">この区分の任務はありません。<br>予定した工程まで進めば、達成です。</div>'}
        ${tasks.length > limit ? `<button class="ghost" data-action="show-all">ほか ${tasks.length - limit} 件を表示</button>` : ''}
      </div><div class="end-link"><span>今日 ${count} 件を達成</span><button class="ghost gold" data-action="end-day">${icon('camp', 15)}${closed ? '今日の成果を見る' : '本日の遠征を終える'}</button></div>
    </div></div>`;
}
function taskRow(t) {
  const complete = done(t), past = superseded(t) && !complete, result = game.results.find(r => r.taskId === t.id);
  return `<article class="task-row ${complete || past ? 'done' : ''}"><button class="checkbtn" data-action="complete" data-id="${esc(t.id)}" ${complete || past ? 'disabled' : ''} aria-label="${esc(t.title)}を完了">${complete ? icon('check', 13) : ''}</button>
    <div class="body"><h3>${esc(t.title)}</h3><div class="meta"><span>${t.minutes}分</span>${t.repeat !== 'none' ? '<span>' + (t.repeat === 'daily' ? '毎日' : '毎週') + '</span>' : ''}${t.due ? `<span class="${t.due < today() && !complete ? 'orange' : ''}">${t.due < today() && !complete ? '期限超過 ' : ''}${esc(t.due)}</span>` : ''}${t.project ? '<span>' + esc(t.project) + '</span>' : ''}${past ? '<span>過去の回・未実施</span>' : complete ? '<span>' + (t.importedDone ? '旧版で達成' : '達成済み') + '</span>' : ''}</div></div>
    <div class="task-options">${!complete && !past ? `<button class="iconbtn" data-action="main" data-id="${esc(t.id)}" aria-label="${esc(t.title)}を主目標にする">${icon('target', 15)}</button><button class="iconbtn" data-action="start" data-id="${esc(t.id)}" aria-label="${esc(t.title)}に取りかかる">${icon('arrow', 15)}</button>` : result ? `<button class="iconbtn" data-action="undo" data-id="${esc(t.id)}" aria-label="${esc(t.title)}の完了を取り消す">${icon('undo', 15)}</button>` : ''}
    ${!past ? `<button class="iconbtn" data-action="edit" data-id="${esc(t.id)}" aria-label="${esc(t.title)}を編集">${icon('edit', 15)}</button>` : ''}<button class="iconbtn" data-action="archive" data-id="${esc(t.id)}" aria-label="${esc(t.title)}を保管">${icon('close', 15)}</button></div></article>`;
}
function resultTitle(r) {
  return r.victory ? '門の向こうに、新しい景色。' : r.cache ? '鍛造資材を回収した。' : r.breakthrough ? r.encounter + 'を突破した。' : r.repeat ? '踏破した道から、鍛造の糧を。' : 'その一撃は、確かに残った。';
}
function compactResult(r) {
  return `<article class="inline-result"><div class="between"><span class="tiny gold">直前の成果</span><button class="ghost" data-action="undo" data-id="${esc(r.taskId)}">${icon('undo', 13)}取消</button></div><h3>${resultTitle(r)}</h3><div class="gains"><span>鉄片 +${r.iron}</span>${r.ember ? '<span>熾火 +' + r.ember + '</span>' : ''}<span>EXP +${r.xp}</span></div><p class="source">${r.damage ? esc(r.enemy) + 'に ' + r.damage + ' ダメージ。' : ''}${r.victory ? '烽火が灯り、次の地域が解放された。' : r.breakthrough ? '次は、' + esc(r.next) + '。' : ''}<br>達成：${esc(r.title)}</p></article>`;
}
function roadmap(region) {
  return `<div class="roadmap">${REGIONS[region].encounters.map((e, i) => `<div class="roadstop ${i < game.stages[region] ? 'done' : i === game.stages[region] ? 'active' : ''}"><span>${i < game.stages[region] ? icon('check', 12) : i + 1}</span>${e.name}</div>`).join('')}</div>`;
}
function renderAdventure() {
  const i = state.region, r = REGIONS[i], e = currentEncounter(game, i), result = game.results.at(-1);
  $('page-adventure').innerHTML = `<div class="wide-title"><h1>次の対峙へ。</h1><p>街道から城門まで、遭遇を一つずつ突破する。敵を倒せば、次の出来事へ進む。</p></div>
    <div class="panel"><div class="between"><h2 class="serif" style="font-weight:400;font-size:22px">${r.name}</h2><span class="tiny gold">${game.cleared[i] ? '踏破済み' : '現在地：' + e.name}</span></div>${roadmap(i)}
      <div class="encounter-list">${r.encounters.map((x, n) => `<div class="encounter-row"><div><h3>${x.name} · ${x.enemy}</h3><p class="tiny muted">${n < game.stages[i] ? x.kind === 'cache' ? '資材を回収済み' : '撃破済み' : x.kind === 'cache' ? '次の任務で鉄片2個・熾火1個を追加回収' : 'HP ' + game.health[i][n] + ' / ' + x.hp}</p></div><span class="tiny ${n === game.stages[i] ? 'gold' : 'muted'}">${n < game.stages[i] ? '突破' : n === game.stages[i] ? '対峙中' : 'この先'}</span></div>`).join('')}</div>
    </div><div class="route-options"><button class="route ${state.route === 'story' ? 'active' : ''}" data-action="route" data-route="story">${icon('sword', 21)}<div><strong>突破を目指す</strong><p>攻撃を優先。敵を倒し、物語を進める。</p></div></button><button class="route ${state.route === 'materials' ? 'active' : ''}" data-action="route" data-route="materials">${icon('hammer', 21)}<div><strong>素材を集める</strong><p>基本の鉄片を2倍獲得。攻撃は70%。好きな剣を育てる道。</p></div></button></div>
    <div class="region-grid">${REGIONS.map((x, n) => `<article class="panel region-card ${i === n ? 'selected' : ''}"><span class="tiny gold">${x.sub} ${n > game.unlocked ? '・未解放' : game.cleared[n] ? '・踏破' : ''}</span><h2>${x.name}</h2><p>${x.goal}</p><button class="secondary" data-action="region" data-region="${n}" ${n > game.unlocked || n === i ? 'disabled' : ''}>${n === i ? '現在の遠征先' : n > game.unlocked ? '前の地域を踏破すると解放' : game.cleared[n] ? '再探索へ' : 'この地へ向かう'}</button></article>`).join('')}</div>
    <p class="tiny muted">踏破後は、同じ敵を復活させずに素材を集めます。経験値は半分。日々の任務には、毎回確定の成果が残ります。</p>
    ${result ? `<div style="max-width:650px;margin-top:25px">${compactResult(result)}</div>` : ''}`;
}
function portraitSvg(family, tier, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 215 280" role="img" aria-label="${esc(weaponName(family, Math.max(0, tier)))}を装備した灰の旅人">${knight(artWeapon(family, Math.max(0, tier)), true)}${tier > 1 ? `<path d="m60 112 20-7m52 0 21 10M85 158l23 8 22-9" fill="none" stroke="${tier > 3 ? '#e8b477' : '#b99b6e'}" stroke-width="2" opacity=".8"/>` : ''}</svg>`;
}
function renderEquipment() {
  const id = selectedWeapon, family = WEAPONS.find(w => w.id === id), tier = game.tiers[id], owned = tier >= 0;
  const cost = forgeCost(tier), can = game.iron >= cost.iron && game.ember >= cost.ember;
  const equipped = game.equipped === id, targetTier = tier + 1, targetName = weaponName(id, targetTier);
  $('page-equipment').innerHTML = `<div class="wide-title"><h1>自分の剣を、育てる。</h1><p>大剣も、双剣も。同じ強化段階なら総ダメージは同じ。好きな一振りを、何度でも鍛え続ける。</p></div>
    <div class="equipment-grid"><div><div class="portrait ${lastForge?.weapon === game.equipped ? 'after-forge' : ''}">${portraitSvg(game.equipped, game.tiers[game.equipped], 'fullbody')}<div class="name">灰の旅人</div><p class="tiny muted">${game.titles.at(-1) || '焚き火を絶やさぬ者'}</p><div class="statrow"><div><b>${game.level}</b>レベル</div><div><b>${game.attack}</b>行動力1の総攻撃力</div><div><b>+${game.tiers[game.equipped]}</b>武器の強化</div></div><div class="bar exp" style="margin-top:20px"><span style="width:${game.xp % 50 / 50 * 100}%"></span></div><p class="tiny muted" style="margin-top:7px;text-align:right">${game.xp % 50} / 50 EXP</p></div>
      <p class="tiny muted" style="margin-top:15px">装備中：《${weaponName(game.equipped, game.tiers[game.equipped])}》<br>攻撃力 = 16 ＋ レベル × 2 ＋ 強化段階 × 5</p></div>
    <div><div class="weapon-selector">${WEAPONS.map(w => `<button class="weapon-select ${w.id === id ? 'active' : ''}" data-action="select-weapon" data-weapon="${w.id}">${w.name}<span>${game.tiers[w.id] < 0 ? '未鍛造' : '+' + game.tiers[w.id]} · ${w.id === game.equipped ? '装備中' : '比較・プレビュー'}</span></button>`).join('')}</div>
      <article class="panel weapon-panel"><div class="between"><span class="tiny gold">${family.name} · ${family.hits === 1 ? '重い一撃' : '三連撃'}</span><span class="tiny muted">鉄片 ${game.iron} / 熾火 ${game.ember}</span></div><h2>《${owned ? weaponName(id, tier) : family.names[0]}》</h2><p class="description">${family.description}<br>${owned ? '同じ武器を強化すると、形・金属の輝き・攻撃力が変わる。' : '別系統の武器も低い素材コストで試せる。'}</p>
      <div class="forge-preview"><div class="preview-person">${portraitSvg(id, Math.max(0, tier))}<small>${owned ? '現在' : '基本の姿'}</small><strong>${owned ? weaponName(id, tier) : '未鍛造'}</strong></div><span class="muted">${icon('arrow', 20)}</span><div class="preview-person after">${portraitSvg(id, targetTier)}<small>鍛造後</small><strong>${targetName}</strong></div></div>
      <div class="costrow"><span>鉄片 ${game.iron} / ${cost.iron}</span><span>熾火 ${game.ember} / ${cost.ember}</span></div>
      <button class="${can ? 'primary' : 'secondary'} full" style="width:100%" data-action="forge" data-weapon="${id}" ${can ? '' : 'disabled'}>${icon('hammer', 15)}${can ? owned ? '強化して装備する' : '鍛造して装備する' : '素材を集める · 鉄片あと ' + Math.max(0, cost.iron - game.iron) + (cost.ember > game.ember ? ' / 熾火あと ' + (cost.ember - game.ember) : '')}</button>
      ${owned && !equipped ? `<button class="secondary" style="width:100%;margin-top:12px" data-action="equip" data-weapon="${id}">今の段階で装備する</button>` : owned ? '<p class="tiny muted" style="margin-top:13px;text-align:center">現在、装備中</p>' : ''}
      ${lastForge?.weapon === id ? `<p class="tiny gold" style="margin-top:16px">《${lastForge.name}》を鍛造。次の任務から、この姿で進む。</p>` : ''}</article>
    </div></div>`;
}
function allResults() { return [...(state.legacyResults || []), ...game.results]; }
function resultsForDay(day) { return allResults().filter(r => r.day === day); }
function dayAchievements(day) {
  const results = resultsForDay(day), crafts = game.craftResults.filter(r => r.day === day);
  return [
    ...results.filter(r => r.breakthrough).map(r => r.victory ? REGIONS[r.region].name + 'を踏破' : r.encounter + 'を突破'),
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
  $('page-camp').innerHTML = `<div class="wide-title"><h1>焚き火は、まだ消えていない。</h1><p>今日の成果を確かめ、明日の一歩を残す。休む日に失うものはありません。</p></div>
    <div class="camp-grid"><div><section class="panel camp-card"><div class="section-head"><h2>本日の遠征</h2><button class="secondary" data-action="end-day">${state.daily[today()] ? '今日の成果を見る' : '今日はここまで'}</button></div><p class="tiny muted">主目標：${completedMainDays.has(today()) ? '達成' : state.main[today()] ? 'まだ途中' : '未設定'}<br>現実で果たしたこと：${resultsForDay(today()).length} 件</p>${days.slice(0, 7).map(d => `<div class="daily-record"><h3>${d} · 遠征終了</h3><p>${resultsForDay(d).map(r => esc(r.title)).join('、') || '今日は休息の日。'}${state.daily[d].tomorrow ? '<br>次の一歩：' + esc(state.daily[d].tomorrow) : ''}${state.daily[d].note ? '<br>' + esc(state.daily[d].note) : ''}</p></div>`).join('')}</section>
      <section class="panel camp-card"><h2>世界に残った歩み</h2>${[[game.stages[0] > 0, '最初の街道を突破した'],[Math.max(game.tiers.great, game.tiers.dual) > 0, '鍛冶師が拠点に戻った'],[game.cleared[0], '灰の城門の烽火が灯った'],[game.cleared[1], '聖堂の鐘が再び響いた'],[game.cleared[2], '断崖に夜明けが戻った']].map(([yes, label]) => `<div class="camp-state ${yes ? '' : 'muted'}">${icon(yes ? 'fire' : 'camp', 17)}${label}${yes ? '' : ' · この先'}</div>`).join('')}</section>
      <section class="panel camp-card"><h2>プロジェクトの工程</h2>${game.projects.length ? game.projects.map(p => `<div class="daily-record"><div class="between"><h3>${esc(p.name)}</h3><span class="tiny muted">${p.done} / ${p.total}</span></div><div class="bar exp" style="margin:12px 0"><span style="width:${p.done / p.total * 100}%"></span></div><p class="tiny gold">${p.done === p.total ? '称号：《' + esc(p.name) + 'を果たす者》' : '予定した工程を、一つずつ。'}</p></div>`).join('') : '<p class="tiny muted">任務の詳細に同じプロジェクト名を付けると、工程をまとめて確認できます。素材報酬は各工程で獲得し、親プロジェクトでは重複付与しません。</p>'}</section>
      <section class="panel camp-card"><h2>直近7日の現実の歩み</h2><div class="metrics"><div class="metric"><b>${recent.length}</b>達成した任務</div><div class="metric"><b>${rate}%</b>主目標達成率 · ${mainDays.length}日分</div><div class="metric"><b>${started.length}</b>取りかかった任務</div><div class="metric"><b>${latency}分</b>登録から初回着手までの平均</div></div><p class="tiny muted" style="margin-top:13px">最初の地域は、1日3件ほどの任務で約1週間を仮の目安に調整しています。利用量で前後します。実際の効果は、重要な任務が進んだかで確かめてください。</p></section>
    </div><div><section class="panel camp-card"><h2>設定とバックアップ</h2><div class="setting"><label for="soundSetting">音を有効にする<small>金属音・一撃と連撃・地域ごとの残響</small></label><input id="soundSetting" type="checkbox" ${state.settings.mute ? '' : 'checked'}></div><div class="setting"><label for="volumeSetting">音量</label><input id="volumeSetting" type="range" min="0" max="1" step="0.05" value="${state.settings.volume}"></div><div class="setting"><label for="motionSetting">動きを抑える<small>揺れと点滅を止め、演出を短縮</small></label><input id="motionSetting" type="checkbox" ${state.settings.reduced ? 'checked' : ''}></div><p class="tiny muted" style="margin:18px 0 14px">このブラウザに自動保存されます。別端末へ移る場合は、JSONを書き出して復元してください。同期機能はありません。</p><div class="flex" style="flex-wrap:wrap"><button class="secondary" data-action="export">${icon('download', 14)}書き出し</button><button class="secondary" data-action="import">${icon('upload', 14)}復元</button></div><p class="tiny muted" style="margin-top:13px">任務の内容もバックアップに含まれます。ダウンロードしたJSONは、ご自身で保管してください。</p></section>
      <section class="panel camp-card"><h2>旅の記録</h2><div class="history">${[...records].reverse().slice(0, 40).map(r => `<div><span class="gold">${esc(r.day)} · ${r.main ? '主目標達成' : '任務達成'}${r.breakthrough ? ' · ' + esc(r.encounter) + '突破' : ''}</span><br>${esc(r.title)}<br><span class="muted">鉄片 +${r.iron || 0} / EXP +${r.xp || 0}${r.victory ? ' / 地域踏破' : ''}</span></div>`).join('') || '<p class="tiny muted">最初の任務が、この記録の始まりになる。</p>'}${(state.legacyLogs || []).map(l => '<div><span class="muted">旧版の記録</span><br>' + esc(l) + '</div>').join('')}</div></section>
      <section class="panel camp-card"><h2>1週間の使い心地</h2><p class="tiny muted">任意の振り返り。回答はこのブラウザに残ります。</p><form id="feedbackForm"><label class="field" for="rewardRating">報酬を見る楽しさ</label><select id="rewardRating" name="reward">${[1,2,3,4,5].map(n => `<option value="${n}" ${n === 3 ? 'selected' : ''}>${n}${n === 1 ? ' · あまり感じない' : n === 5 ? ' · 次も見たい' : ''}</option>`).join('')}</select><label class="field" for="entryRating">入力の手間</label><select id="entryRating" name="entry">${[1,2,3,4,5].map(n => `<option value="${n}" ${n === 3 ? 'selected' : ''}>${n}${n === 1 ? ' · とても簡単' : n === 5 ? ' · 面倒' : ''}</option>`).join('')}</select><label class="field" for="feedbackNote">重要な任務は進みましたか？</label><textarea id="feedbackNote" name="note" maxlength="1000"></textarea><button class="secondary" style="margin-top:14px" type="submit">振り返りを残す</button></form>${(state.feedback || []).slice(-3).reverse().map(f => `<p class="tiny muted" style="margin-top:16px">${esc(f.day)} · 楽しさ ${esc(f.reward)}/5 · 手間 ${esc(f.entry)}/5<br>${esc(f.note)}</p>`).join('')}</section>
      ${archived.length ? `<section class="panel camp-card"><h2>保管した任務</h2>${archived.map(t => `<div class="between" style="margin:12px 0"><span class="tiny">${esc(t.title)}</span><button class="ghost" data-action="restore-task" data-id="${esc(t.id)}">戻す</button></div>`).join('')}</section>` : ''}
    </div></div>`;
}
function openTask(id) {
  const form = $('taskForm'); form.reset();
  form.elements.namedItem('id').value = id || '';
  form.elements.namedItem('scheduled').value = today();
  $('taskDetails').open = false;
  const task = state.tasks.find(t => t.id === id);
  if (task) {
    for (const name of ['id','title','minutes','repeat','condition','step','due','scheduled','priority','project']) {
      const input = form.elements.namedItem(name);
      if (name === 'minutes' && ![...input.options].some(o => o.value === String(task.minutes))) input.add(new Option(task.minutes + '分', task.minutes));
      input.value = task[name] ?? '';
    }
    form.elements.namedItem('energy').value = task.autoEnergy ? 'auto' : task.energy;
    $('taskDetails').open = true;
  }
  $('taskDialogTitle').textContent = id ? '任務を編集' : '任務を記す';
  updateRewardHint(); fillIcons($('taskDialog')); $('taskDialog').showModal();
}
function updateRewardHint() {
  const f = $('taskForm'), minutes = Number(f.elements.namedItem('minutes').value);
  const mode = f.elements.namedItem('energy').value, energy = mode === 'auto' ? energyFor(minutes) : Number(mode);
  $('autoReward').textContent = `行動力 ${energy} を自動提案${mode !== 'auto' ? '（手動で変更中）' : ''}。詳細から変更できます。`;
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
    due: data.due, scheduled: data.scheduled, priority: Number(data.priority), project: data.project.trim() };
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
  save(); $('taskDialog').close(); render(); toast('任務を記録しました。');
});
function startTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task || done(task) || superseded(task)) return;
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
  $('focusInner').innerHTML = `<span class="tiny gold">今は、この一歩だけ。</span><h2 id="focusTitle">${esc(task.title)}</h2><div class="first-step">${esc(task.step || '必要な資料や道具を開き、最初の一つに取りかかる。')}</div>${task.condition ? '<p>今回の完了条件：' + esc(task.condition) + '</p>' : ''}
    <button class="ghost" data-action="toggle-timer">${icon('clock', 14)}${focus.showTimer ? 'タイマーを隠す' : 'タイマーを表示'}</button><div class="${focus.showTimer ? '' : 'hidden'}"><div class="timer" id="timerText"></div><button class="secondary" data-action="timer">${focus.running ? '一時停止' : '集中タイマーを始める'}</button></div>
    <p class="focus-note" id="timerNote">時間だけでは完了しません。予定した工程まで進めてください。</p><button class="primary" data-action="complete" data-id="${esc(task.id)}">${icon('check', 16)}今回の工程を完了する</button><p class="focus-note">課題全体が未完成でも、この工程を果たせば達成です。</p>`;
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
function completeTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task || done(task) || superseded(task)) return;
  const event = { id: uid(), type: 'complete', taskId: id, title: task.title, energy: task.energy,
    main: state.main[today()] === id, day: today(), at: Date.now(), region: state.region, route: state.route };
  state.events.push(event); lastResultSession = event.id;
  save(); // Persist before any presentation or animation.
  if (focus) leaveFocus(); else render();
  const result = game.results.find(r => r.eventId === event.id);
  if (view === 'tasks') window.scrollTo({ top: 0, behavior: state.settings.reduced ? 'instant' : 'smooth' });
  if (result) { animationQueue.push(result); if (!animating) playNext(); }
}
function playNext() {
  if (!animationQueue.length) { animating = false; return; }
  animating = true;
  const r = animationQueue.shift();
  if (view !== 'tasks' || state.region !== r.region) { playNext(); return; }
  const frame = { ...game, stages: [...game.stages], health: game.health.map(a => [...a]), tiers: { ...game.tiers }, cleared: [...game.cleared], equipped: r.weapon };
  if (!r.repeat) { frame.stages[r.region] = r.encounterIndex; frame.health[r.region][r.encounterIndex] = r.beforeHp; frame.cleared[r.region] = false; }
  frame.tiers[r.weapon] = r.tier;
  $('battleScene').outerHTML = sceneBlock(frame);
  const scene = $('battleScene'), message = $('animationMessage'), number = $('damageNumber');
  scene.classList.remove('striking', 'dual'); void scene.offsetWidth;
  if (r.damage) scene.classList.add('striking');
  if (r.weapon === 'dual') scene.classList.add('dual');
  message.classList.remove('hidden');
  message.textContent = r.victory ? '闇に、道を開いた。' : r.cache ? '鍛造資材を見つけた。' : r.repeat ? '剣を育てる、次の素材。' : r.breakthrough ? r.encounter + 'を突破。' : r.weapon === 'dual' ? '三つの刃が、闇を裂く。' : 'その行動を、一撃に。';
  number.textContent = r.weapon === 'dual' ? r.hits.join(' + ') : r.damage || '';
  sound(r.victory ? 'victory' : r.cache ? 'forge' : 'strike', r.region);
  if (r.weapon === 'dual' && r.damage) soundTimer = setTimeout(() => sound('strike', r.region), 270);
  clearTimeout(animationTimer);
  animationTimer = setTimeout(() => {
    if (view === 'tasks' && state.region === r.region && $('battleScene')) $('battleScene').outerHTML = sceneBlock();
    if (r.victory) toast(REGIONS[r.region].name + 'を踏破。次の景色が解放されました。');
    playNext();
  }, state.settings.reduced || matchMedia('(prefers-reduced-motion: reduce)').matches ? 150 : 2500);
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
  confirmAction('完了を取り消しますか？', '素材・経験値・遭遇の突破を再計算します。後の戦闘結果も変わり、素材不足や前提不足になった強化は取り消されます。', () => {
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
  const tier = game.tiers[id] + 1;
  state.events.push({ id: uid(), type: 'forge', weapon: id, targetTier: tier, day: today(), at: Date.now() });
  lastForge = { weapon: id, name: weaponName(id, tier) }; selectedWeapon = id;
  save(); render(); sound('forge'); toast('《' + lastForge.name + '》を鍛造して装備しました。');
}
function openEndDay() {
  const day = today(), existing = state.daily[day], results = resultsForDay(day), achievements = dayAchievements(day);
  $('endSummary').innerHTML = `<div class="summary-part"><h3>主目標</h3><p class="tiny">${results.some(r => r.main) ? '達成' : state.main[day] ? 'まだ途中。続きは明日でも大丈夫です。' : '今日は設定なし'}</p></div>
    <div class="summary-part"><h3>現実で進めたこと</h3>${results.length ? '<ul>' + results.map(r => '<li>' + esc(r.title) + '</li>').join('') + '</ul>' : '<p class="tiny muted">今日は休息の日。装備や成長は失われません。</p>'}</div>
    <div class="summary-part"><h3>冒険の成果</h3>${achievements.length ? '<ul>' + achievements.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul>' : '<p class="tiny muted">' + (results.length ? '次の突破に向けた一撃と素材が残りました。' : '焚き火は、まだ消えていない。') + '</p>'}<p class="tiny gold" style="margin-top:10px">鉄片 +${results.reduce((n, r) => n + (r.iron || 0), 0)} / EXP +${results.reduce((n, r) => n + (r.xp || 0), 0)}</p></div>`;
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
  toast('本日の遠征終了。今日の歩みと、明日の一歩を残しました。');
});
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
      clearAnimation(); state = next; lastResultSession = null; lastForge = null; refreshRecurrence(); game = replay(state); selectedWeapon = game.equipped;
      save(); render(); toast('任務・装備・遠征の記録を復元しました。');
    });
  } catch (error) { toast('復元できません：' + error.message); }
});
$('confirmNo').onclick = () => { confirmCallback = null; $('confirmDialog').close(); };
$('confirmYes').onclick = () => { const callback = confirmCallback; confirmCallback = null; $('confirmDialog').close(); callback?.(); };
$('confirmDialog').addEventListener('cancel', () => { confirmCallback = null; });

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action, id = button.dataset.id, task = state.tasks.find(t => t.id === id);
  switch (action) {
    case 'nav': navigate(button.dataset.view); break;
    case 'add': openTask(); break;
    case 'edit': openTask(id); break;
    case 'template': templateTask(button.dataset.template); break;
    case 'close-task': $('taskDialog').close(); break;
    case 'main':
      if (task && !done(task) && !superseded(task)) { state.main[today()] = id; task.scheduled = today(); if (state.daily[today()]) state.daily[today()].reopened = true; save(); render(); toast('今日の主目標に選びました。'); }
      break;
    case 'unmain': delete state.main[today()]; save(); render(); break;
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
      if (task) { task.deleted = true; if (state.main[today()] === id) delete state.main[today()]; save(); render(); toast(task.repeat === 'none' ? '任務を保管しました。拠点から戻せます。' : '任務を保管し、今後の繰り返しを止めました。'); }
      break;
    case 'restore-task': if (task) { task.deleted = false; refreshRecurrence(); save(); render(); } break;
    case 'filter': filter = button.dataset.filter; showAll = false; renderHome(); break;
    case 'show-all': showAll = true; renderHome(); break;
    case 'route': state.route = button.dataset.route; save(); render(); break;
    case 'region':
      if (Number(button.dataset.region) <= game.unlocked) { clearAnimation(); state.region = Number(button.dataset.region); save(); render(); sound('victory'); toast(REGIONS[state.region].name + 'を次の進路に選びました。'); }
      break;
    case 'select-weapon': selectedWeapon = button.dataset.weapon; renderEquipment(); break;
    case 'forge': forge(button.dataset.weapon); break;
    case 'equip':
      if (game.tiers[button.dataset.weapon] >= 0) { state.events.push({ id: uid(), type: 'equip', weapon: button.dataset.weapon, day: today(), at: Date.now() }); save(); render(); sound('forge'); toast('装備を変更しました。次の一撃から反映されます。'); }
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
