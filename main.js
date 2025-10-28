/**
 * 出退勤打刻アプリ - フロントエンド
 * GAS Web App と連携
 */

// ==========================================
// 設定
// ==========================================

// GAS Web App URL (最新デプロイ)
const API_URL = 'https://script.google.com/macros/s/AKfycbwTFyV66i3TAj2BLIuZiYdqnLucvTjCLeNrZlZoa4gSm2ZlJrS2OxJN3bYd8twC7abJiw/exec';

// ==========================================
// DOM要素
// ==========================================

const userNameInput = document.getElementById('userName');
const clockInBtn = document.getElementById('clockInBtn');
const clockOutBtn = document.getElementById('clockOutBtn');
const completeBtn = document.getElementById('completeBtn');
const messageBox = document.getElementById('messageBox');
const loadingSpinner = document.getElementById('loadingSpinner');
const statusContent = document.getElementById('statusContent');
const weeklyHoursEl = document.getElementById('weeklyHours');
const monthlyHoursEl = document.getElementById('monthlyHours');

// ==========================================
// ユーティリティ関数
// ==========================================

// LocalStorage からユーザー情報を読み込み
function loadUserInfo() {
  const userName = localStorage.getItem('userName');
  if (userName) userNameInput.value = userName;
}

// LocalStorage にユーザー情報を保存
function saveUserInfo(userName) {
  localStorage.setItem('userName', userName);
}

// ローディング表示/非表示
function setLoading(isLoading) {
  if (isLoading) {
    loadingSpinner.classList.remove('hidden');
  } else {
    loadingSpinner.classList.add('hidden');
  }
}

// メッセージ表示
function showMessage(message, type = 'info') {
  messageBox.textContent = message;
  messageBox.className = `message-box message-${type}`;
  messageBox.classList.remove('hidden');

  // 5秒後に自動で消す
  setTimeout(() => {
    messageBox.classList.add('hidden');
  }, 5000);
}

// 時間フォーマット（分 → x時間y分）
function formatMinutes(minutes) {
  if (!minutes || minutes === 0) return '0時間0分';
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}時間${mins}分`;
}

// ==========================================
// API呼び出し
// ==========================================

/**
 * GAS Web App に POST リクエストを送信
 * ⚠️ Content-Type: text/plain で送ることでプリフライトを回避
 */
async function callAPI(action, additionalData = {}) {
  const userName = userNameInput.value.trim();

  if (!userName) {
    showMessage('氏名を入力してください', 'error');
    return null;
  }

  // API_URL チェック
  if (!API_URL || API_URL === 'YOUR_GAS_WEB_APP_URL_HERE') {
    showMessage('API_URL が未設定です。main.js の API_URL を設定してください。', 'error');
    return null;
  }

  saveUserInfo(userName);

  // 研修生IDは固定でuser01を使用
  const requestBody = {
    action,
    id: 'user01',
    name: userName,
    ...additionalData
  };

  try {
    setLoading(true);

    console.log('📤 リクエスト送信:', requestBody);

    // Content-Type: text/plain で送信（CORS プリフライト回避）
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: JSON.stringify(requestBody)
    });

    console.log('📥 レスポンスステータス:', response.status);

    const result = await response.json();
    console.log('📥 レスポンス内容:', result);

    if (result.ok) {
      return result;
    } else {
      showMessage(result.message || 'エラーが発生しました', 'error');
      console.error('❌ APIエラー:', result.message);
      return null;
    }
  } catch (error) {
    console.error('❌ API呼び出しエラー:', error);
    showMessage('サーバーとの通信に失敗しました: ' + error.message, 'error');
    return null;
  } finally {
    setLoading(false);
  }
}

// ==========================================
// ステータス取得
// ==========================================

async function fetchStatus() {
  console.log('📊 ステータス取得開始');
  const result = await callAPI('getstatus');
  if (!result) {
    console.log('❌ ステータス取得失敗');
    return;
  }

  const { data } = result;
  console.log('📊 取得したステータス:', data);

  // ステータス表示を更新
  updateStatusDisplay(data);

  // 勤務時間を更新
  weeklyHoursEl.textContent = formatMinutes(data.weeklyMinutes);
  monthlyHoursEl.textContent = formatMinutes(data.monthlyMinutes);
}

function updateStatusDisplay(data) {
  const { status, clockInTime, clockOutTime, workingTime, motivationMessage } = data;
  console.log('🔄 ステータス表示更新:', status);

  let html = '';

  switch (status) {
    case 'not_clocked_in':
      html = `
        <p class="status-label">未出勤</p>
        <p class="status-detail">まだ出勤していません</p>
        ${motivationMessage ? `<p class="motivation">${motivationMessage}</p>` : ''}
      `;
      clockInBtn.disabled = false;
      clockOutBtn.disabled = true;
      completeBtn.disabled = true;
      break;

    case 'clocked_in':
      html = `
        <p class="status-label">出勤中</p>
        <p class="status-detail">🕐 出勤時刻: ${clockInTime}</p>
        <p class="status-detail">お疲れ様です！</p>
      `;
      clockInBtn.disabled = true;
      clockOutBtn.disabled = false;
      completeBtn.disabled = true;
      break;

    case 'clocked_out':
      html = `
        <p class="status-label">退勤済み</p>
        <p class="status-detail">🕐 出勤: ${clockInTime}</p>
        <p class="status-detail">🕐 退勤: ${clockOutTime}</p>
        <p class="status-detail">⏰ 勤務時間: ${workingTime}</p>
      `;
      clockInBtn.disabled = true;
      clockOutBtn.disabled = true;
      completeBtn.disabled = false;
      break;
  }

  statusContent.innerHTML = html;
}

// ==========================================
// イベントハンドラー
// ==========================================

// 出勤
clockInBtn.addEventListener('click', async () => {
  console.log('🌅 出勤ボタンクリック');
  const result = await callAPI('clockin');
  console.log('🌅 出勤結果:', result);
  if (result) {
    showMessage(result.message, 'success');
    await fetchStatus();
  }
});

// 退勤
clockOutBtn.addEventListener('click', async () => {
  const result = await callAPI('clockout');
  if (result) {
    showMessage(result.message, 'success');
    await fetchStatus();
  }
});

// 課題完了
completeBtn.addEventListener('click', async () => {
  const result = await callAPI('complete');
  if (result) {
    showMessage(result.message + ` (判定: ${result.data.judgment})`, 'success');
    await fetchStatus();
  }
});

// ユーザー情報変更時にステータスを再取得
userNameInput.addEventListener('change', fetchStatus);

// ==========================================
// 初期化
// ==========================================

window.addEventListener('DOMContentLoaded', () => {
  loadUserInfo();

  // ユーザー情報がある場合は初回ステータス取得
  if (userNameInput.value) {
    fetchStatus();
  }
});
