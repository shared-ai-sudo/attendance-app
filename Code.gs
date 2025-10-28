/**
 * 出退勤打刻アプリ - Google Apps Script (Refactored, Full)
 *
 * ■ スプレッドシート構成（タブ名は厳密一致）
 *   - 研修生マスタ
 *   - 打刻記録
 *   - 課題完了記録
 *
 * ■ スクリプトプロパティ
 *   - SHEET_ID       : 対象スプレッドシートID
 *   - LINE_TOKEN     : Messaging API の「チャネルアクセストークン」
 *   - LINE_GROUP_ID  : 通知先グループID（例: C5a5b...）
 *
 *  ※ 互換のため LINE_ACCESS_TOKEN でも可（両方読みます）
 */

const TIMEZONE = 'Asia/Tokyo';

// ---- デフォルトアプリURL ----
const DEFAULT_APP_URL = 'https://shared-ai-sudo.github.io/attendance-app';

// ---- メッセージ雛形 ----
const MORNING_MESSAGES = [
  "今日も新しいことに挑戦しよう！",
  "小さな積み重ねが大きな成果に！",
  "今日も新しい一歩を踏み出そう！",
  "昨日より今日、今日より明日！",
  "継続は力なり！今日も頑張ろう！"
];
const EVENING_MESSAGES = [
  "お疲れ様！一歩ずつ確実に前進！",
  "今日もよく頑張りました！",
  "昨日より少し成長できたね！",
  "素晴らしい一日でした！",
  "また明日も頑張りましょう！"
];

// ---- シート名 ----
const SHEET_NAME_MASTER   = '研修生マスタ';
const SHEET_NAME_CLOCK    = '打刻記録';
const SHEET_NAME_COMPLETE = '課題完了記録';

// =======================
// 設定・共通ユーティリティ
// =======================

function getConfig() {
  const p = PropertiesService.getScriptProperties();
  const token = p.getProperty('LINE_TOKEN') || p.getProperty('LINE_ACCESS_TOKEN'); // 両対応
  const cfg = {
    lineToken: token,
    lineGroupId: p.getProperty('LINE_GROUP_ID'),
    sheetId: p.getProperty('SHEET_ID'),
    appUrl: p.getProperty('APP_URL') || DEFAULT_APP_URL
  };
  if (!cfg.sheetId) throw new Error('SHEET_ID が未設定です（スクリプトプロパティ）');
  return cfg;
}

function getSpreadsheet() {
  const config = getConfig();
  return SpreadsheetApp.openById(config.sheetId);
}

function getSheetByName(name) {
  const sh = getSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error(`シート「${name}」が見つかりません。タブ名を確認してください。`);
  return sh;
}

function getRandomMessage(messages) {
  const index = Math.floor(Math.random() * messages.length);
  return messages[index];
}

function formatWorkingTime(minutes) {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}時間${mins}分`;
}

function formatDateJP(dateStr) {
  // 'yyyy-MM-dd' → 'YYYY年M月D日'
  const parts = dateStr.split('-').map(Number);
  return `${parts[0]}年${parts[1]}月${parts[2]}日`;
}

// 日跨ぎ対策あり（in/out は "HH:mm" または Date オブジェクト）
function calculateWorkingMinutes(clockInTime, clockOutTime) {
  console.log('calculateWorkingMinutes 入力:', {clockInTime, clockOutTime});
  console.log('clockInTime型:', typeof clockInTime, 'isDate:', clockInTime instanceof Date);

  // Dateオブジェクトの場合は文字列に変換
  let inStr;
  if (!clockInTime) {
    throw new Error('clockInTime が空です');
  } else if (clockInTime instanceof Date) {
    inStr = Utilities.formatDate(clockInTime, TIMEZONE, 'HH:mm');
  } else if (typeof clockInTime === 'object' && clockInTime.toString) {
    // シリアル値などのオブジェクト
    const d = new Date(clockInTime);
    inStr = Utilities.formatDate(d, TIMEZONE, 'HH:mm');
  } else {
    inStr = String(clockInTime);
  }

  let outStr;
  if (!clockOutTime) {
    throw new Error('clockOutTime が空です');
  } else if (clockOutTime instanceof Date) {
    outStr = Utilities.formatDate(clockOutTime, TIMEZONE, 'HH:mm');
  } else if (typeof clockOutTime === 'object' && clockOutTime.toString) {
    const d = new Date(clockOutTime);
    outStr = Utilities.formatDate(d, TIMEZONE, 'HH:mm');
  } else {
    outStr = String(clockOutTime);
  }

  console.log('変換後:', {inStr, outStr});

  const [ih, im] = inStr.split(':').map(Number);
  const [oh, om] = outStr.split(':').map(Number);
  const inMin  = ih * 60 + im;
  let outMin   = oh * 60 + om;
  if (outMin < inMin) outMin += 24 * 60; // 日跨ぎ
  return outMin - inMin;
}

// Webアプリの共通レスポンス（CORSヘッダは付けない：フロントは text/plain で送る）
function createResponse(ok, message, data) {
  const body = JSON.stringify({ ok, message, data });
  return ContentService.createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}

// =======================
// エンドポイント
// =======================

// フロントは Content-Type: text/plain で JSON 文字列をPOST（プリフライト回避）
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createResponse(false, 'リクエスト本文が空です', null);
    }
    const req = JSON.parse(e.postData.contents);
    const { action, id, name } = req;

    if (!action || !id || !name) {
      return createResponse(false, '必須パラメータ（action, id, name）が不足しています', null);
    }

    switch (String(action).toLowerCase()) {
      case 'clockin':   return clockIn(id, name);
      case 'clockout':  return clockOut(id, name);
      case 'complete':  return completeTask(id, name);
      case 'getstatus': return getStatus(id, name);
      default:          return createResponse(false, `不正なアクション: ${action}`, null);
    }
  } catch (err) {
    console.error('doPost エラー:', err);
    return createResponse(false, `サーバーエラー: ${err}`, null);
  }
}

// =======================
// 業務ロジック
// =======================

// 今日の未退勤行を最優先で探す（なければ最も新しい未退勤行）
function findOpenRowForUser(sheet, id, todayStr) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  const values = sheet.getRange(2, 1, lastRow - 1, 6).getValues(); // A-F
  let fallback = null; // 今日以外の未退勤の最新

  const idStr = String(id).trim();

  for (let i = values.length - 1; i >= 0; i--) {
    const [date, vid, , inStr, outStr] = values[i];

    // IDを文字列に変換し、前後のスペースを削除
    const vidStr = String(vid).trim();

    if (vidStr !== idStr || !inStr || outStr) continue; // 自分、出勤あり、退勤なし

    // 日付を文字列にフォーマット
    const dateStr = (date instanceof Date)
      ? Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd')
      : String(date);

    const rowNumber = i + 2;
    // 時刻を文字列に変換
    const clockInTime = (inStr instanceof Date) ? Utilities.formatDate(inStr, TIMEZONE, 'HH:mm') : String(inStr);
    const record = { rowNumber, date: dateStr, inStr: clockInTime };
    if (dateStr === todayStr) return record; // ✅ 今日が最優先
    if (!fallback) fallback = record;
  }
  return fallback;
}

function clockIn(id, name) {
  const sheet = getSheetByName(SHEET_NAME_CLOCK);

  const now = new Date();
  const todayStr = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd');
  const timeStr  = Utilities.formatDate(now, TIMEZONE, 'HH:mm');

  // 同日同IDの出勤重複チェック
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const values = sheet.getRange(2, 1, lastRow - 1, 6).getValues(); // A-F
    for (let i = values.length - 1; i >= 0; i--) {
      const [date, vid] = [values[i][0], values[i][1]];
      // 日付を文字列にフォーマットして比較
      const dateStr = (date instanceof Date)
        ? Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd')
        : String(date);

      // IDを文字列に変換し、前後のスペースを削除
      const vidStr = String(vid).trim();
      const idStr = String(id).trim();

      if (dateStr === todayStr && vidStr === idStr) {
        return createResponse(false, '今日はすでに出勤済みです', null);
      }
    }
  }

  // 追記：A:日付, B:ID, C:氏名, D:出勤, E:退勤, F:勤務時間
  sheet.appendRow([todayStr, id, name, timeStr, '', '']);

  const msg = `【出勤】
${name}さん、おはようございます！

📅 日付：${formatDateJP(todayStr)}
🕐 出勤時刻：${timeStr}

${getRandomMessage(MORNING_MESSAGES)} ☀️`;
  sendLine(msg);

  return createResponse(true, '出勤を記録しました', {
    date: todayStr,
    clockInTime: timeStr
  });
}

function clockOut(id, name) {
  const sheet = getSheetByName(SHEET_NAME_CLOCK);

  const now = new Date();
  const todayStr = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd');
  const outStr   = Utilities.formatDate(now, TIMEZONE, 'HH:mm');

  // 今日の未退勤を最優先で取得（無ければ最新の未退勤）
  const target = findOpenRowForUser(sheet, id, todayStr);
  if (!target) {
    return createResponse(false, '「未退勤」の出勤記録が見つかりません（先に出勤してください）', null);
  }

  const { rowNumber, date: recordDate, inStr: clockInStr } = target;

  // 時刻を文字列に変換（Dateオブジェクトの場合）
  const clockInTime = (clockInStr instanceof Date)
    ? Utilities.formatDate(clockInStr, TIMEZONE, 'HH:mm')
    : String(clockInStr);

  // 勤務分を計算（日跨ぎ考慮）
  const workMin = calculateWorkingMinutes(clockInTime, outStr);
  const workStr = formatWorkingTime(workMin);

  // 退勤と勤務時間を反映
  sheet.getRange(rowNumber, 5).setValue(outStr); // E:退勤
  sheet.getRange(rowNumber, 6).setValue(workStr); // F:勤務時間

  const msg = `【退勤】
${name}さん、${getRandomMessage(EVENING_MESSAGES)}

📅 日付：${formatDateJP(recordDate)}
🕐 出勤：${clockInTime}
🕐 退勤：${outStr}
⏰ 勤務時間：${workStr}

今日もよく頑張りました！🌙`;
  sendLine(msg);

  return createResponse(true, '退勤を記録しました', {
    date: recordDate,
    clockInTime: clockInTime,
    clockOutTime: outStr,
    workingTime: workStr
  });
}

function completeTask(id, name) {
  const sheetClock = getSheetByName(SHEET_NAME_CLOCK);
  const sheetComp  = getSheetByName(SHEET_NAME_COMPLETE);
  const config = getConfig();

  // Script PropertiesからAPP_URLを取得、なければデフォルト
  const appUrl = config.appUrl;

  const now = new Date();
  const completedAt = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd HH:mm');

  const lastRow = sheetClock.getLastRow();
  if (lastRow <= 1) return createResponse(false, '先に出勤・退勤の記録を行ってください', null);

  const values = sheetClock.getRange(2, 1, lastRow - 1, 6).getValues();
  let latest = null;
  for (let i = values.length - 1; i >= 0; i--) {
    const [date, vid, vname, inStr, outStr, workStr] = values[i];
    const vidStr = String(vid).trim();
    const idStr = String(id).trim();

    if (vidStr === idStr && outStr) {
      // 時刻を文字列に変換
      const clockInTime = (inStr instanceof Date) ? Utilities.formatDate(inStr, TIMEZONE, 'HH:mm') : String(inStr);
      const clockOutTime = (outStr instanceof Date) ? Utilities.formatDate(outStr, TIMEZONE, 'HH:mm') : String(outStr);

      latest = { date, id: vid, name: vname, inStr: clockInTime, outStr: clockOutTime, workStr };
      break;
    }
  }
  if (!latest) return createResponse(false, '先に出勤・退勤の記録を行ってください', null);

  const min = calculateWorkingMinutes(latest.inStr, latest.outStr);
  const judgment = min >= 480 ? '合格' : '不合格';

  // スプレッドシート「課題完了記録」に追記
  sheetComp.appendRow([completedAt, latest.id, latest.name, appUrl, judgment]);

  const msg = `【🎉課題完了報告🎉】
研修生：${latest.name}（${latest.id}）
完了日時：${completedAt}
勤務時間：${latest.workStr}
判定：${judgment}

アプリURL：
${appUrl}

確認をお願いします！`;
  sendLine(msg);

  return createResponse(true, '課題完了を記録しました', {
    completedAt,
    id: latest.id,
    name: latest.name,
    appUrl: appUrl,
    judgment
  });
}

function getStatus(id, name) {
  const sheet = getSheetByName(SHEET_NAME_CLOCK);
  const todayStr = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');

  console.log('=== getStatus デバッグ ===');
  console.log('検索ID:', id);
  console.log('今日の日付:', todayStr);

  let status = 'not_clocked_in';
  let clockInTime = '';
  let clockOutTime = '';
  let workingTime = '';

  const lastRow = sheet.getLastRow();
  console.log('シート最終行:', lastRow);

  if (lastRow > 1) {
    const values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
    console.log('取得した行数:', values.length);

    for (let i = values.length - 1; i >= 0; i--) {
      const [date, vid, vname, inStr, outStr, workStr] = values[i];

      // 日付を文字列にフォーマットして比較
      const dateStr = (date instanceof Date)
        ? Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd')
        : String(date);

      // IDを文字列に変換し、前後のスペースを削除
      const vidStr = String(vid).trim();
      const idStr = String(id).trim();

      console.log(`行${i}: 日付=${dateStr}, ID="${vidStr}", 氏名=${vname}, 出勤=${inStr}, 退勤=${outStr}`);
      console.log(`  ID比較: "${vidStr}" === "${idStr}" = ${vidStr === idStr}`);
      console.log(`  日付比較: "${dateStr}" === "${todayStr}" = ${dateStr === todayStr}`);

      if (vidStr === idStr && dateStr === todayStr) {
        console.log('✅ マッチしました！');
        // 時刻をDateオブジェクトから文字列に変換
        clockInTime  = inStr ? ((inStr instanceof Date) ? Utilities.formatDate(inStr, TIMEZONE, 'HH:mm') : String(inStr)) : '';
        clockOutTime = outStr ? ((outStr instanceof Date) ? Utilities.formatDate(outStr, TIMEZONE, 'HH:mm') : String(outStr)) : '';
        workingTime  = workStr || '';
        status = outStr ? 'clocked_out' : (inStr ? 'clocked_in' : 'not_clocked_in');
        console.log('ステータス:', status);
        break;
      }
    }
  }

  console.log('最終ステータス:', status);

  return createResponse(true, 'ステータス取得成功', {
    status,
    date: todayStr,
    clockInTime,
    clockOutTime,
    workingTime,
    weeklyMinutes: getWeeklyMinutes(id),
    monthlyMinutes: getMonthlyMinutes(id),
    motivationMessage: getRandomMessage(MORNING_MESSAGES)
  });
}

// =======================
// 集計（分）
// =======================

function getWeeklyMinutes(id) {
  const sheet = getSheetByName(SHEET_NAME_CLOCK);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = today.getDay(); // 0:日〜6:土
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : (dow - 1)));

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;

  const vals = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  const idStr = String(id).trim();
  let total = 0;

  for (let i = 0; i < vals.length; i++) {
    const [dateStr, vid, , inStr, outStr] = vals[i];
    const vidStr = String(vid).trim();

    if (vidStr !== idStr || !inStr || !outStr) continue;

    const d = new Date(dateStr);
    if (d >= monday) {
      // 時刻をDateオブジェクトから文字列に変換
      const clockInTime = (inStr instanceof Date) ? Utilities.formatDate(inStr, TIMEZONE, 'HH:mm') : String(inStr);
      const clockOutTime = (outStr instanceof Date) ? Utilities.formatDate(outStr, TIMEZONE, 'HH:mm') : String(outStr);
      total += calculateWorkingMinutes(clockInTime, clockOutTime);
    }
  }
  return total;
}

function getMonthlyMinutes(id) {
  const sheet = getSheetByName(SHEET_NAME_CLOCK);
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;

  const vals = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  const idStr = String(id).trim();
  let total = 0;

  for (let i = 0; i < vals.length; i++) {
    const [dateStr, vid, , inStr, outStr] = vals[i];
    const vidStr = String(vid).trim();

    if (vidStr !== idStr || !inStr || !outStr) continue;

    const d = new Date(dateStr);
    if (d >= first) {
      // 時刻をDateオブジェクトから文字列に変換
      const clockInTime = (inStr instanceof Date) ? Utilities.formatDate(inStr, TIMEZONE, 'HH:mm') : String(inStr);
      const clockOutTime = (outStr instanceof Date) ? Utilities.formatDate(outStr, TIMEZONE, 'HH:mm') : String(outStr);
      total += calculateWorkingMinutes(clockInTime, clockOutTime);
    }
  }
  return total;
}

// =======================
// LINE 通知（Messaging API Push）
// =======================

function sendLine(text) {
  const { lineToken, lineGroupId } = getConfig();
  if (!lineToken) { console.warn('LINE_TOKEN（チャネルアクセストークン）が未設定です'); return; }
  if (!lineGroupId) { console.warn('LINE_GROUP_ID が未設定です'); return; }

  const url = 'https://api.line.me/v2/bot/message/push';
  const payload = { to: lineGroupId, messages: [{ type: 'text', text }] };
  const options = {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + lineToken, 'Content-Type': 'application/json' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    if (code !== 200) console.error('LINE送信失敗:', code, res.getContentText());
  } catch (err) {
    console.error('LINE送信エラー:', err);
  }
}

// =======================
// テスト用（GASから実行）
// =======================

function testClockIn()   { return clockIn('user01', '岩田龍弥'); }
function testClockOut()  { return clockOut('user01', '岩田龍弥'); }
function testComplete()  { return completeTask('user01', '岩田龍弥'); }
function testGetStatus() { return getStatus('user01', '岩田龍弥'); }

// デバッグ用：スプレッドシートの内容を確認
function debugCheckSheet() {
  const sheet = getSheetByName(SHEET_NAME_CLOCK);
  const todayStr = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');

  console.log('今日の日付:', todayStr);
  console.log('シート名:', SHEET_NAME_CLOCK);

  const lastRow = sheet.getLastRow();
  console.log('最終行:', lastRow);

  if (lastRow > 1) {
    const values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
    console.log('全データ:');
    for (let i = 0; i < values.length; i++) {
      const [date, id, name, inTime, outTime, workTime] = values[i];
      const dateStr = (date instanceof Date)
        ? Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd')
        : String(date);
      console.log(`行${i+2}: 日付="${dateStr}", ID="${id}", 氏名="${name}", 出勤="${inTime}", 退勤="${outTime}"`);
    }
  }
}
