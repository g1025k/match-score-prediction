// =============================================
// スコア予想サイト - メインアプリケーション
// =============================================

// Supabase 初期化
const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== アプリ状態 =====
let isAdmin = false;
let matches = [];
let allPredictions = {}; // { matchId: [predictions] }

// 各モーダルで使う対象 ID
let editingMatchId = null;
let editingPredictionId = null;
let predictionTargetMatchId = null;
let liveScoreTargetMatchId = null;
let deadlineTargetMatchId = null;

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', async () => {
  // セッションストレージから管理者状態を復元
  isAdmin = sessionStorage.getItem('isAdmin') === 'true';
  updateAdminUI();

  await loadAll();
  setupRealtime();
});

// ===== データ読み込み =====
async function loadAll() {
  await Promise.all([loadMatches(), loadAllPredictions()]);
  renderMatches();
}

async function loadMatches() {
  const { data, error } = await db
    .from('matches')
    .select('*')
    .order('match_datetime', { ascending: true });

  if (error) {
    console.error('matches 取得エラー:', error);
    showToast('データの読み込みに失敗しました', 'error');
    return;
  }
  matches = data || [];
}

async function loadAllPredictions() {
  if (matches.length === 0) {
    allPredictions = {};
    return;
  }
  const ids = matches.map(m => m.id);
  const { data, error } = await db
    .from('predictions')
    .select('*')
    .in('match_id', ids)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('predictions 取得エラー:', error);
    return;
  }

  allPredictions = {};
  (data || []).forEach(p => {
    if (!allPredictions[p.match_id]) allPredictions[p.match_id] = [];
    allPredictions[p.match_id].push(p);
  });
}

// ===== リアルタイム購読 =====
function setupRealtime() {
  db.channel('realtime-all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, async () => {
      await loadAll();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'predictions' }, async () => {
      await loadAllPredictions();
      renderMatches();
    })
    .subscribe();
}

// ===== レンダリング =====
function renderMatches() {
  const container = document.getElementById('matches-grid');

  if (matches.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏟️</div>
        <p>${isAdmin ? '「試合を追加」ボタンから試合を登録してください' : 'まだ試合が登録されていません'}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = matches
    .map(match => renderMatchCard(match, allPredictions[match.id] || []))
    .join('');
}

function renderMatchCard(match, predictions) {
  const myName = localStorage.getItem('userName');
  const now = new Date();
  const deadline = match.deadline ? new Date(match.deadline) : null;
  const isDeadlinePassed = deadline ? now > deadline : false;

  // --- スコア表示 ---
  let scoreHtml = '';
  if (match.is_final && match.final_score_team1 !== null) {
    scoreHtml = `
      <div class="score-area">
        <div class="score-box final-score">
          <span class="score-box-label">✅ 確定スコア</span>
          <span class="score-box-value">${match.final_score_team1} − ${match.final_score_team2}</span>
        </div>
      </div>
    `;
  } else if (match.live_score_team1 !== null) {
    scoreHtml = `
      <div class="score-area">
        <div class="score-box live-score">
          <span class="score-box-label">🔴 途中スコア <span class="live-dot"></span></span>
          <span class="score-box-value">${match.live_score_team1} − ${match.live_score_team2}</span>
        </div>
      </div>
    `;
  }

  // --- 締め切りステータス ---
  let deadlineHtml = '';
  if (deadline) {
    if (isDeadlinePassed) {
      deadlineHtml = `<div class="deadline-area"><span class="deadline-chip closed">🔒 締め切り済み（${formatDateTime(deadline)}）</span></div>`;
    } else {
      deadlineHtml = `<div class="deadline-area"><span class="deadline-chip open">⏰ 締め切り：${formatDateTime(deadline)}</span></div>`;
    }
  }

  // --- 予想ボタン ---
  let predictBtnHtml = '';
  if (!match.is_final && !isDeadlinePassed) {
    predictBtnHtml = `
      <div class="predict-btn-area">
        <button class="btn btn-primary" onclick="openPredictionModal('${match.id}')">
          📝 スコアを予想する
        </button>
      </div>
    `;
  }

  // --- 管理者コントロール ---
  let adminHtml = '';
  if (isAdmin) {
    adminHtml = `
      <div class="admin-actions">
        <button class="btn btn-ghost btn-sm" title="試合を編集" onclick="openMatchForm('${match.id}')">✏️</button>
        <button class="btn btn-ghost btn-sm" title="スコア入力" onclick="openLiveScoreModal('${match.id}')">⚽</button>
        <button class="btn btn-ghost btn-sm" title="締め切り設定" onclick="openDeadlineModal('${match.id}')">⏰</button>
        <button class="btn btn-ghost btn-sm" title="削除" onclick="deleteMatch('${match.id}')">🗑️</button>
      </div>
    `;
  }

  // --- 予想リスト ---
  const predictionsHtml = renderPredictionsList(match, predictions, myName);

  return `
    <div class="match-card" id="match-card-${match.id}">
      <div class="card-header">
        <div class="card-meta">
          <span class="sport-badge">${escHtml(match.sport)}</span>
          ${match.tournament ? `<span class="tournament-badge">${escHtml(match.tournament)}</span>` : ''}
        </div>
        ${adminHtml}
      </div>
      <div class="card-body">
        <div class="teams-display">
          <div class="team-block">
            <div class="team-emoji">${escHtml(match.team1_emoji) || '🏠'}</div>
            <div class="team-name">${escHtml(match.team1_name)}</div>
          </div>
          <div class="vs-text">VS</div>
          <div class="team-block">
            <div class="team-emoji">${escHtml(match.team2_emoji) || '🚩'}</div>
            <div class="team-name">${escHtml(match.team2_name)}</div>
          </div>
        </div>

        <div class="match-info-bar">
          <span class="info-item">📅 ${formatDateTime(new Date(match.match_datetime))}</span>
        </div>

        ${scoreHtml}
        ${deadlineHtml}
        ${predictBtnHtml}

      </div>
      <button class="predictions-toggle" onclick="togglePredictions('${match.id}')" id="toggle-btn-${match.id}">
        💬 みんなの予想
        <span class="toggle-count">${predictions.length}件</span>
        <span class="toggle-arrow">▼</span>
      </button>
      <div class="predictions-section" id="predictions-${match.id}">
        ${predictionsHtml}
      </div>
    </div>
  `;
}

function renderPredictionsList(match, predictions, myName) {
  if (predictions.length === 0) {
    return '<div class="no-predictions">まだ予想がありません。最初に予想してみよう！</div>';
  }

  const now = new Date();
  const deadline = match.deadline ? new Date(match.deadline) : null;
  const isDeadlinePassed = deadline ? now > deadline : false;

  const items = predictions.map(pred => {
    // 当たり判定（確定後）
    const isWinner =
      match.is_final &&
      match.final_score_team1 !== null &&
      pred.score_team1 === match.final_score_team1 &&
      pred.score_team2 === match.final_score_team2;

    // 残念判定（途中スコアで外れ確定）
    const isEliminated =
      !match.is_final &&
      match.live_score_team1 !== null &&
      (match.live_score_team1 > pred.score_team1 ||
        match.live_score_team2 > pred.score_team2);

    // 確定後の外れ
    const isFinalWrong = match.is_final && match.final_score_team1 !== null && !isWinner;

    // 自分の予想
    const isMine = myName && pred.user_name === myName;

    // CSSクラス
    let cls = 'prediction-item';
    if (isWinner) cls += ' winner';
    else if (isEliminated) cls += ' eliminated';
    else if (isFinalWrong) cls += ' final-wrong';
    if (isMine) cls += ' mine';

    // ステータスアイコン
    let icon = '';
    if (isWinner) icon = '👑';
    else if (isEliminated) icon = '😢';
    else if (isFinalWrong) icon = '❌';

    // 編集ボタン（自分の予想かつ未確定かつ締め切り前）
    const canEdit = isMine && !match.is_final && !isDeadlinePassed;
    const editBtn = canEdit
      ? `<button class="btn btn-ghost btn-sm pred-edit-btn" title="編集" onclick="openPredictionModal('${match.id}', '${pred.id}')">✏️</button>`
      : '<span class="pred-edit-btn"></span>';

    // 時刻表示
    const createdStr = formatDateTimeShort(new Date(pred.created_at));
    const wasUpdated = pred.updated_at && pred.updated_at !== pred.created_at;
    const timeHtml = wasUpdated
      ? `<span class="pred-time">${createdStr}</span>
         <span class="pred-updated-time">✏️ 更新: ${formatDateTimeShort(new Date(pred.updated_at))}</span>`
      : `<span class="pred-time">${createdStr}</span>`;

    return `
      <div class="${cls}">
        <div class="pred-user-info">
          ${icon ? `<span class="pred-status-icon">${icon}</span>` : ''}
          <span class="pred-username">${escHtml(pred.user_name)}</span>
          ${isMine ? '<span class="mine-tag">あなた</span>' : ''}
        </div>
        <div class="pred-score-info">
          <span class="pred-score">${pred.score_team1} − ${pred.score_team2}</span>
          ${timeHtml}
        </div>
        ${editBtn}
      </div>
    `;
  });

  return `<div class="predictions-list">${items.join('')}</div>`;
}

// ===== 管理者認証 =====
function handleAdminBtn() {
  if (isAdmin) {
    adminLogout();
  } else {
    openModal('admin-login-modal');
    // エラーメッセージリセット
    document.getElementById('admin-login-error').classList.add('hidden');
    document.getElementById('admin-password-input').value = '';
    setTimeout(() => document.getElementById('admin-password-input').focus(), 150);
  }
}

function adminLogin() {
  const pw = document.getElementById('admin-password-input').value;
  if (pw === ADMIN_PASSWORD) {
    isAdmin = true;
    sessionStorage.setItem('isAdmin', 'true');
    closeModal('admin-login-modal');
    updateAdminUI();
    renderMatches();
    showToast('管理者としてログインしました', 'success');
  } else {
    document.getElementById('admin-login-error').classList.remove('hidden');
    document.getElementById('admin-password-input').select();
  }
}

function adminLogout() {
  isAdmin = false;
  sessionStorage.removeItem('isAdmin');
  updateAdminUI();
  renderMatches();
  showToast('ログアウトしました');
}

function updateAdminUI() {
  const badge = document.getElementById('admin-badge');
  const btn = document.getElementById('admin-btn');
  const toolbar = document.getElementById('admin-toolbar');

  if (isAdmin) {
    badge.classList.remove('hidden');
    btn.textContent = 'ログアウト';
    toolbar.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
    btn.textContent = '管理者ログイン';
    toolbar.classList.add('hidden');
  }
}

// ===== モーダル操作 =====
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function closeModalOnOverlay(event, id) {
  if (event.target.id === id) closeModal(id);
}

// ===== 予想トグル =====
function togglePredictions(matchId) {
  const section = document.getElementById(`predictions-${matchId}`);
  const btn = document.getElementById(`toggle-btn-${matchId}`);
  const isOpen = section.classList.contains('open');
  section.classList.toggle('open', !isOpen);
  btn.classList.toggle('active', !isOpen);
}

// ===== 試合 CRUD（管理者） =====
function openMatchForm(matchId = null) {
  editingMatchId = matchId;

  if (matchId) {
    document.getElementById('match-form-title').textContent = '試合を編集';
    const match = matches.find(m => m.id === matchId);
    if (match) {
      document.getElementById('form-team1-emoji').value = match.team1_emoji || '';
      document.getElementById('form-team1-name').value = match.team1_name;
      document.getElementById('form-team2-emoji').value = match.team2_emoji || '';
      document.getElementById('form-team2-name').value = match.team2_name;
      document.getElementById('form-sport').value = match.sport;
      document.getElementById('form-tournament').value = match.tournament || '';
      document.getElementById('form-match-datetime').value = toInputDatetime(new Date(match.match_datetime));
      document.getElementById('form-deadline').value = match.deadline
        ? toInputDatetime(new Date(match.deadline))
        : '';
    }
  } else {
    document.getElementById('match-form-title').textContent = '試合を追加';
    // フォームリセット
    ['form-team1-emoji','form-team1-name','form-team2-emoji','form-team2-name',
     'form-sport','form-tournament','form-deadline'].forEach(id => {
      document.getElementById(id).value = '';
    });
    // 試合日時デフォルト：明日の19時
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(19, 0, 0, 0);
    document.getElementById('form-match-datetime').value = toInputDatetime(tomorrow);
  }

  openModal('match-form-modal');
}

async function saveMatch() {
  const team1_name = document.getElementById('form-team1-name').value.trim();
  const team2_name = document.getElementById('form-team2-name').value.trim();
  const sport = document.getElementById('form-sport').value.trim();
  const match_datetime_val = document.getElementById('form-match-datetime').value;

  if (!team1_name || !team2_name || !sport || !match_datetime_val) {
    showToast('チーム名・スポーツ・試合日時は必須です', 'error');
    return;
  }

  const deadlineVal = document.getElementById('form-deadline').value;
  const payload = {
    team1_emoji: document.getElementById('form-team1-emoji').value.trim(),
    team1_name,
    team2_emoji: document.getElementById('form-team2-emoji').value.trim(),
    team2_name,
    sport,
    tournament: document.getElementById('form-tournament').value.trim() || null,
    match_datetime: new Date(match_datetime_val).toISOString(),
    deadline: deadlineVal ? new Date(deadlineVal).toISOString() : null,
  };

  let error;
  if (editingMatchId) {
    ({ error } = await db.from('matches').update(payload).eq('id', editingMatchId));
  } else {
    ({ error } = await db.from('matches').insert([payload]));
  }

  if (error) {
    showToast('保存に失敗しました：' + error.message, 'error');
    return;
  }

  closeModal('match-form-modal');
  showToast('試合を保存しました', 'success');
  await loadAll();
}

async function deleteMatch(matchId) {
  const match = matches.find(m => m.id === matchId);
  const label = match ? `${match.team1_name} vs ${match.team2_name}` : 'この試合';
  if (!confirm(`「${label}」を削除しますか？\n関連する予想もすべて削除されます。`)) return;

  const { error } = await db.from('matches').delete().eq('id', matchId);
  if (error) {
    showToast('削除に失敗しました：' + error.message, 'error');
    return;
  }

  showToast('試合を削除しました');
  await loadAll();
}

// ===== 予想 CRUD =====
async function openPredictionModal(matchId, predId = null) {
  predictionTargetMatchId = matchId;
  editingPredictionId = predId;

  const match = matches.find(m => m.id === matchId);
  document.getElementById('prediction-modal-title').textContent =
    predId ? '📝 予想を編集' : '📝 スコアを予想';
  document.getElementById('prediction-match-info').textContent =
    `${match.team1_emoji || ''} ${match.team1_name}  vs  ${match.team2_emoji || ''} ${match.team2_name}`;
  document.getElementById('pred-team1-label').textContent =
    `${match.team1_emoji || ''} ${match.team1_name}`;
  document.getElementById('pred-team2-label').textContent =
    `${match.team2_emoji || ''} ${match.team2_name}`;

  // 名前を localStorage から復元
  const savedName = localStorage.getItem('userName');
  document.getElementById('pred-username').value = savedName || '';

  // 既存予想を読み込み（編集時）
  if (predId) {
    const pred = (allPredictions[matchId] || []).find(p => p.id === predId);
    if (pred) {
      document.getElementById('pred-score-team1').value = pred.score_team1;
      document.getElementById('pred-score-team2').value = pred.score_team2;
    }
  } else {
    document.getElementById('pred-score-team1').value = 0;
    document.getElementById('pred-score-team2').value = 0;
  }

  openModal('prediction-modal');
}

async function savePrediction() {
  const userName = document.getElementById('pred-username').value.trim();
  const score_team1 = parseInt(document.getElementById('pred-score-team1').value);
  const score_team2 = parseInt(document.getElementById('pred-score-team2').value);

  if (!userName) {
    showToast('名前を入力してください', 'error');
    return;
  }
  if (isNaN(score_team1) || isNaN(score_team2)) {
    showToast('スコアを入力してください', 'error');
    return;
  }

  // 名前を localStorage に保存
  localStorage.setItem('userName', userName);

  let error;
  if (editingPredictionId) {
    // 既存予想を更新
    ({ error } = await db.from('predictions')
      .update({ score_team1, score_team2 })
      .eq('id', editingPredictionId));
  } else {
    // 同名ユーザーの同試合予想を確認
    const existing = (allPredictions[predictionTargetMatchId] || [])
      .find(p => p.user_name === userName);

    if (existing) {
      // 上書き更新
      ({ error } = await db.from('predictions')
        .update({ score_team1, score_team2 })
        .eq('id', existing.id));
    } else {
      // 新規登録
      ({ error } = await db.from('predictions').insert([{
        match_id: predictionTargetMatchId,
        user_name: userName,
        score_team1,
        score_team2,
      }]));
    }
  }

  if (error) {
    showToast('保存に失敗しました：' + error.message, 'error');
    return;
  }

  closeModal('prediction-modal');
  showToast('予想を登録しました！', 'success');
}

// ===== スコア入力（管理者） =====
function openLiveScoreModal(matchId) {
  liveScoreTargetMatchId = matchId;
  const match = matches.find(m => m.id === matchId);

  const emoji = match.sport === 'サッカー' ? '⚽' : '🏆';
  document.getElementById('livescore-modal-title').textContent = `${emoji} スコア入力`;
  document.getElementById('livescore-match-info').textContent =
    `${match.team1_emoji || ''} ${match.team1_name}  vs  ${match.team2_emoji || ''} ${match.team2_name}`;
  document.getElementById('live-team1-label').textContent =
    `${match.team1_emoji || ''} ${match.team1_name}`;
  document.getElementById('live-team2-label').textContent =
    `${match.team2_emoji || ''} ${match.team2_name}`;

  // 現在のスコアを表示
  const s1 = match.is_final
    ? match.final_score_team1
    : (match.live_score_team1 ?? 0);
  const s2 = match.is_final
    ? match.final_score_team2
    : (match.live_score_team2 ?? 0);
  document.getElementById('live-score-team1').value = s1;
  document.getElementById('live-score-team2').value = s2;

  openModal('livescore-modal');
}

async function saveLiveScore() {
  const s1 = parseInt(document.getElementById('live-score-team1').value);
  const s2 = parseInt(document.getElementById('live-score-team2').value);

  if (isNaN(s1) || isNaN(s2)) {
    showToast('スコアを入力してください', 'error');
    return;
  }

  const { error } = await db.from('matches').update({
    live_score_team1: s1,
    live_score_team2: s2,
    is_final: false,
  }).eq('id', liveScoreTargetMatchId);

  if (error) {
    showToast('保存に失敗しました：' + error.message, 'error');
    return;
  }

  closeModal('livescore-modal');
  showToast('途中スコアを保存しました', 'success');
}

async function confirmFinalScore() {
  const s1 = parseInt(document.getElementById('live-score-team1').value);
  const s2 = parseInt(document.getElementById('live-score-team2').value);

  if (isNaN(s1) || isNaN(s2)) {
    showToast('スコアを入力してください', 'error');
    return;
  }

  const match = matches.find(m => m.id === liveScoreTargetMatchId);
  const label = match ? `${match.team1_name} ${s1} − ${s2} ${match.team2_name}` : `${s1} − ${s2}`;
  if (!confirm(`「${label}」を確定スコアにしますか？`)) return;

  const { error } = await db.from('matches').update({
    final_score_team1: s1,
    final_score_team2: s2,
    live_score_team1: s1,
    live_score_team2: s2,
    is_final: true,
  }).eq('id', liveScoreTargetMatchId);

  if (error) {
    showToast('保存に失敗しました：' + error.message, 'error');
    return;
  }

  closeModal('livescore-modal');
  showToast('スコアを確定しました！', 'success');
}

// ===== 締め切り設定（管理者） =====
function openDeadlineModal(matchId) {
  deadlineTargetMatchId = matchId;
  const match = matches.find(m => m.id === matchId);

  document.getElementById('deadline-match-info').textContent =
    `${match.team1_emoji || ''} ${match.team1_name}  vs  ${match.team2_emoji || ''} ${match.team2_name}`;
  document.getElementById('deadline-input').value = match.deadline
    ? toInputDatetime(new Date(match.deadline))
    : '';

  openModal('deadline-modal');
}

async function saveDeadline() {
  const val = document.getElementById('deadline-input').value;
  const { error } = await db.from('matches').update({
    deadline: val ? new Date(val).toISOString() : null,
  }).eq('id', deadlineTargetMatchId);

  if (error) {
    showToast('保存に失敗しました：' + error.message, 'error');
    return;
  }

  closeModal('deadline-modal');
  showToast('締め切り時間を保存しました', 'success');
}

// ===== ユーティリティ =====

/**
 * HTML エスケープ（XSS対策）
 */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 日時を "YYYY/MM/DD HH:mm" 形式でフォーマット
 */
function formatDateTime(date) {
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 日時を短縮形式 "MM/DD HH:mm" でフォーマット
 */
function formatDateTimeShort(date) {
  return date.toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Date を <input type="datetime-local"> の値形式に変換（ローカル時間）
 */
function toInputDatetime(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * トースト通知を表示
 */
function showToast(message, type = 'default') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3000);
}
