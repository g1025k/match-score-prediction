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
let selectedMatchId = null;
let countdownInterval = null;

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

  // 選択中の試合が無効なら再選択（最初の未確定試合、なければ最後）
  if (!selectedMatchId || !matches.find(m => m.id === selectedMatchId)) {
    const upcoming = matches.find(m => !m.is_final);
    selectedMatchId = upcoming ? upcoming.id : matches[matches.length - 1].id;
  }

  const confirmedMatches = matches.filter(m => m.is_final);
  const upcomingMatches = matches.filter(m => !m.is_final);

  const confirmedTabsHtml = confirmedMatches.length > 0 ? `
    <div class="match-tabs-wrapper">
      <div class="tabs-label">
        <span class="confirmed-label">✅ 確定スコア（${confirmedMatches.length}試合）</span>
      </div>
      <div class="match-tabs-row" id="match-tabs-row-confirmed">
        ${confirmedMatches.map(m => renderMatchTab(m)).join('')}
      </div>
    </div>
  ` : '';

  const upcomingTabsHtml = upcomingMatches.length > 0 ? `
    <div class="match-tabs-wrapper upcoming-tabs-wrapper">
      <div class="tabs-label">
        <span class="upcoming-label">⚾ 予想受付中</span>
      </div>
      <div class="match-tabs-row" id="match-tabs-row-upcoming">
        ${upcomingMatches.map(m => renderMatchTab(m)).join('')}
      </div>
    </div>
  ` : '';

  container.innerHTML = `
    ${confirmedTabsHtml}
    ${upcomingTabsHtml}
    <div id="match-detail">
      ${renderMatchDetail(selectedMatchId)}
    </div>
  `;

  startCountdownTimer();
}

// タブ1枚のHTML生成
function renderMatchTab(match) {
  const isActive = match.id === selectedMatchId;
  const date = new Date(match.match_datetime);
  const dateStr = formatTabDate(date);

  if (match.is_final && match.final_score_team1 !== null) {
    const t1code = getCountryCode(match.team1_emoji) || match.team1_name.slice(0, 2).toUpperCase();
    const t2code = getCountryCode(match.team2_emoji) || match.team2_name.slice(0, 2).toUpperCase();
    const opponentShort = match.team2_name.length > 5
      ? match.team2_name.slice(0, 4) + '…'
      : match.team2_name;
    return `
      <div class="match-tab confirmed${isActive ? ' active' : ''}" onclick="selectMatch('${match.id}')">
        <div class="tab-date">${escHtml(dateStr)}</div>
        <div class="tab-score">${escHtml(t1code)} ${match.final_score_team1}−${match.final_score_team2} ${escHtml(t2code)}</div>
        <div class="tab-sub">vs ${escHtml(opponentShort)}</div>
      </div>
    `;
  } else {
    const emoji = match.team2_emoji || '🏆';
    const opponentName = match.team2_name || '未定';
    return `
      <div class="match-tab upcoming${isActive ? ' active' : ''}" onclick="selectMatch('${match.id}')">
        <div class="tab-emoji">${escHtml(emoji)}</div>
        <div class="tab-date">${escHtml(dateStr)}</div>
        <div class="tab-sub">vs ${escHtml(opponentName)}</div>
      </div>
    `;
  }
}

// 試合詳細パネルのHTML生成
function renderMatchDetail(matchId) {
  const match = matches.find(m => m.id === matchId);
  if (!match) return '';

  const predictions = allPredictions[matchId] || [];
  const myName = localStorage.getItem('userName');
  const now = new Date();
  const deadline = match.deadline ? new Date(match.deadline) : null;
  const isDeadlinePassed = deadline ? now > deadline : false;

  // チームコード (フラグ絵文字→国コード)
  const t1code = getCountryCode(match.team1_emoji) || match.team1_name.slice(0, 2).toUpperCase();

  // カウントダウン
  let countdownHtml = '';
  if (deadline && !isDeadlinePassed) {
    const diffMs = deadline - now;
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    countdownHtml = `
      <div class="deadline-countdown" id="deadline-countdown">
        ⏰ 締め切りまであと <strong>${hours}時間${minutes}分</strong>
      </div>
    `;
  } else if (deadline && isDeadlinePassed) {
    countdownHtml = `<div class="deadline-passed">🔒 締め切り済み</div>`;
  }

  // スコア表示
  let scoreHtml = '';
  if (match.is_final && match.final_score_team1 !== null) {
    scoreHtml = `
      <div class="detail-score-area">
        <div class="score-box final-score">
          <span class="score-box-label">✅ 確定スコア</span>
          <span class="score-box-value">${match.final_score_team1} − ${match.final_score_team2}</span>
        </div>
      </div>
    `;
  } else if (match.live_score_team1 !== null) {
    scoreHtml = `
      <div class="detail-score-area">
        <div class="score-box live-score">
          <span class="score-box-label">🔴 途中スコア <span class="live-dot"></span></span>
          <span class="score-box-value">${match.live_score_team1} − ${match.live_score_team2}</span>
        </div>
      </div>
    `;
  }

  // 管理者コントロール
  let adminHtml = '';
  if (isAdmin) {
    adminHtml = `
      <div class="detail-admin-bar">
        <button class="btn btn-ghost btn-sm" onclick="openMatchForm('${match.id}')">✏️ 編集</button>
        <button class="btn btn-ghost btn-sm" onclick="openLiveScoreModal('${match.id}')">⚽ スコア</button>
        <button class="btn btn-ghost btn-sm" onclick="openDeadlineModal('${match.id}')">⏰ 締め切り</button>
        <button class="btn btn-ghost btn-sm" onclick="deleteMatch('${match.id}')">🗑️ 削除</button>
      </div>
    `;
  }

  // インライン予想フォーム
  let predFormHtml = '';
  if (!match.is_final && !isDeadlinePassed) {
    const savedName = myName || '';
    const existingPred = myName ? predictions.find(p => p.user_name === myName) : null;
    const s1 = existingPred ? existingPred.score_team1 : 0;
    const s2 = existingPred ? existingPred.score_team2 : 0;
    predFormHtml = `
      <div class="inline-pred-card">
        <div class="pred-form-title-row">
          <span class="pred-form-title-line"></span>
          <span class="pred-form-title-text">予想を登録</span>
          <span class="pred-form-title-line"></span>
        </div>
        <div class="pred-name-input-wrap">
          <input type="text" id="inline-pred-name" class="pred-name-input" placeholder="名前を入力してください" value="${escHtml(savedName)}"
            oninput="localStorage.setItem('userName', this.value)">
        </div>
        <div class="pred-score-row">
          <span class="pred-team-label">${escHtml(match.team1_emoji || '')} ${escHtml(match.team1_name)}</span>
          <input type="number" id="inline-score1" class="score-num-input" min="0" max="99" value="${s1}"
            oninput="if(this.value<0||this.value==='-')this.value=0">
          <span class="pred-dash">—</span>
          <input type="number" id="inline-score2" class="score-num-input" min="0" max="99" value="${s2}"
            oninput="if(this.value<0||this.value==='-')this.value=0">
          <span class="pred-team-label">${escHtml(match.team2_emoji || '')} ${escHtml(match.team2_name || '未定')}</span>
        </div>
        <button class="btn btn-register-pred" onclick="saveInlinePrediction('${matchId}')">
          予想を登録する
        </button>
      </div>
    `;
  }

  // 予想リスト
  const predictionsHtml = renderPredictionsList(match, predictions, myName);

  // 試合日時フォーマット
  const matchDate = new Date(match.match_datetime);
  const detailDateStr = formatDetailDate(matchDate);

  return `
    <div class="match-detail-wrapper">
      ${adminHtml}
      <div class="detail-header-card">
        <div class="detail-header-gradient-bar"></div>
        <div class="detail-header-inner">
          <div class="detail-team-block">
            <div class="detail-team-code">${escHtml(t1code)}</div>
            <div class="detail-team-name-lg">${escHtml(match.team1_name)}</div>
            ${match.tournament ? `<div class="detail-team-sub">${escHtml(match.tournament)}</div>` : ''}
          </div>
          <div class="detail-center-block">
            <div class="detail-match-time">${escHtml(detailDateStr)}</div>
            <div class="detail-vs">VS</div>
            ${match.sport ? `<div class="detail-sport">${escHtml(match.sport)}</div>` : ''}
            ${scoreHtml}
          </div>
          <div class="detail-team-block detail-team-right">
            <div class="detail-team-emoji-lg">${escHtml(match.team2_emoji || '🏆')}</div>
            <div class="detail-team-name-lg">${escHtml(match.team2_name || '未定')}</div>
            <div class="detail-team-sub">${escHtml(match.team2_name || '未定')}</div>
          </div>
        </div>
      </div>
      ${countdownHtml}
      ${predFormHtml}
      <div class="predictions-section-header">みんなの予想</div>
      <div class="predictions-inline-area">
        ${predictionsHtml}
      </div>
    </div>
  `;
}

function renderPredictionsList(match, predictions, myName) {
  if (predictions.length === 0) {
    return `<div class="no-predictions">まだ誰も予想していません<br>最初に予想してみよう！ ⚾</div>`;
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

// タブ選択
function selectMatch(matchId) {
  selectedMatchId = matchId;
  // タブ行を更新（確定・未確定それぞれ）
  const confirmedRow = document.getElementById('match-tabs-row-confirmed');
  if (confirmedRow) {
    confirmedRow.innerHTML = matches.filter(m => m.is_final).map(m => renderMatchTab(m)).join('');
  }
  const upcomingRow = document.getElementById('match-tabs-row-upcoming');
  if (upcomingRow) {
    upcomingRow.innerHTML = matches.filter(m => !m.is_final).map(m => renderMatchTab(m)).join('');
  }
  // 詳細エリアを更新
  const detailContainer = document.getElementById('match-detail');
  if (detailContainer) {
    detailContainer.innerHTML = renderMatchDetail(matchId);
    startCountdownTimer();
  }
}

// インライン予想の保存
async function saveInlinePrediction(matchId) {
  const nameInput = document.getElementById('inline-pred-name');
  const score1Input = document.getElementById('inline-score1');
  const score2Input = document.getElementById('inline-score2');
  if (!nameInput || !score1Input || !score2Input) return;

  const userName = nameInput.value.trim();
  const score_team1 = Math.max(0, parseInt(score1Input.value) || 0);
  const score_team2 = Math.max(0, parseInt(score2Input.value) || 0);

  if (!userName) {
    showToast('名前を入力してください', 'error');
    return;
  }
  if (isNaN(score_team1) || isNaN(score_team2)) {
    showToast('スコアを入力してください', 'error');
    return;
  }

  localStorage.setItem('userName', userName);

  const existing = (allPredictions[matchId] || []).find(p => p.user_name === userName);
  let error;
  if (existing) {
    ({ error } = await db.from('predictions')
      .update({ score_team1, score_team2 })
      .eq('id', existing.id));
  } else {
    ({ error } = await db.from('predictions').insert([{
      match_id: matchId,
      user_name: userName,
      score_team1,
      score_team2,
    }]));
  }

  if (error) {
    showToast('保存に失敗しました：' + error.message, 'error');
    return;
  }

  showToast('予想を登録しました！', 'success');
  await loadAllPredictions();
  selectMatch(matchId);
}

// カウントダウンタイマー
function startCountdownTimer() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  const match = matches.find(m => m.id === selectedMatchId);
  if (!match || !match.deadline) return;

  const deadline = new Date(match.deadline);
  countdownInterval = setInterval(() => {
    const now = new Date();
    if (now > deadline) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      const detailContainer = document.getElementById('match-detail');
      if (detailContainer) {
        detailContainer.innerHTML = renderMatchDetail(selectedMatchId);
      }
      return;
    }
    const diffMs = deadline - now;
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const countdownEl = document.getElementById('deadline-countdown');
    if (countdownEl) {
      countdownEl.innerHTML = `⏰ 締め切りまであと <strong>${hours}時間${minutes}分</strong>`;
    }
  }, 60000);
}

// フラグ絵文字から国コードを取得
function getCountryCode(emoji) {
  if (!emoji) return '';
  const chars = [...emoji];
  if (chars.length >= 2) {
    const cp0 = chars[0].codePointAt(0);
    const cp1 = chars[1].codePointAt(0);
    if (cp0 >= 0x1F1E6 && cp0 <= 0x1F1FF && cp1 >= 0x1F1E6 && cp1 <= 0x1F1FF) {
      return String.fromCodePoint(cp0 - 0x1F1E6 + 65) + String.fromCodePoint(cp1 - 0x1F1E6 + 65);
    }
  }
  return '';
}

// タブ用日付フォーマット "3/6(金)"
function formatTabDate(date) {
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const day = days[date.getDay()];
  return `${m}/${d}(${day})`;
}

// 詳細用日付フォーマット "3/15(日) 10:00〜"
function formatDetailDate(date) {
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const day = days[date.getDay()];
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${m}/${d}(${day}) ${h}:${min}〜`;
}

// ===== 管理者認証 =====
function handleAdminBtn() {
  if (isAdmin) {
    adminLogout();
  } else {
    openModal('admin-login-modal');
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
    ['form-team1-emoji','form-team1-name','form-team2-emoji','form-team2-name',
     'form-sport','form-tournament','form-deadline'].forEach(id => {
      document.getElementById(id).value = '';
    });
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

  selectedMatchId = null;
  showToast('試合を削除しました');
  await loadAll();
}

// ===== 予想 CRUD（モーダル編集用） =====
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

  const savedName = localStorage.getItem('userName');
  document.getElementById('pred-username').value = savedName || '';

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

  localStorage.setItem('userName', userName);

  let error;
  if (editingPredictionId) {
    ({ error } = await db.from('predictions')
      .update({ score_team1, score_team2 })
      .eq('id', editingPredictionId));
  } else {
    const existing = (allPredictions[predictionTargetMatchId] || [])
      .find(p => p.user_name === userName);

    if (existing) {
      ({ error } = await db.from('predictions')
        .update({ score_team1, score_team2 })
        .eq('id', existing.id));
    } else {
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
