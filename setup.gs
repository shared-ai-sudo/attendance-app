/**
 * スプレッドシート初期化スクリプト
 *
 * 使い方:
 * 1. Google Driveで新しいスプレッドシートを作成
 * 2. 拡張機能 → Apps Script を開く
 * 3. このスクリプトをコピー＆ペースト
 * 4. 実行 → setupSpreadsheet を選択して実行
 */

/**
 * スプレッドシートの初期セットアップ
 */
function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 既存のシートをすべて削除（デフォルトのシート1など）
  const sheets = ss.getSheets();
  sheets.forEach(sheet => {
    ss.deleteSheet(sheet);
  });

  // シート1: 研修生マスタ
  const masterSheet = ss.insertSheet('研修生マスタ', 0);
  masterSheet.getRange('A1:C1').setValues([['研修生ID', '氏名', 'ステータス']]);
  masterSheet.getRange('A1:C1').setFontWeight('bold').setBackground('#4A90E2').setFontColor('#FFFFFF');
  masterSheet.setFrozenRows(1);

  // サンプルデータを追加
  masterSheet.getRange('A2:C2').setValues([['user01', '山田太郎', '進行中']]);

  // 列幅を調整
  masterSheet.setColumnWidth(1, 120); // 研修生ID
  masterSheet.setColumnWidth(2, 150); // 氏名
  masterSheet.setColumnWidth(3, 120); // ステータス

  // シート2: 打刻記録
  const clockSheet = ss.insertSheet('打刻記録', 1);
  clockSheet.getRange('A1:F1').setValues([['日付', '研修生ID', '氏名', '出勤時刻', '退勤時刻', '勤務時間']]);
  clockSheet.getRange('A1:F1').setFontWeight('bold').setBackground('#4CAF50').setFontColor('#FFFFFF');
  clockSheet.setFrozenRows(1);

  // 列幅を調整
  clockSheet.setColumnWidth(1, 120); // 日付
  clockSheet.setColumnWidth(2, 120); // 研修生ID
  clockSheet.setColumnWidth(3, 150); // 氏名
  clockSheet.setColumnWidth(4, 100); // 出勤時刻
  clockSheet.setColumnWidth(5, 100); // 退勤時刻
  clockSheet.setColumnWidth(6, 120); // 勤務時間

  // シート3: 課題完了記録
  const completeSheet = ss.insertSheet('課題完了記録', 2);
  completeSheet.getRange('A1:E1').setValues([['完了日時', '研修生ID', '氏名', 'アプリURL', '判定']]);
  completeSheet.getRange('A1:E1').setFontWeight('bold').setBackground('#FF5722').setFontColor('#FFFFFF');
  completeSheet.setFrozenRows(1);

  // 列幅を調整
  completeSheet.setColumnWidth(1, 150); // 完了日時
  completeSheet.setColumnWidth(2, 120); // 研修生ID
  completeSheet.setColumnWidth(3, 150); // 氏名
  completeSheet.setColumnWidth(4, 300); // アプリURL
  completeSheet.setColumnWidth(5, 100); // 判定

  // 完了メッセージ
  Browser.msgBox(
    'セットアップ完了',
    '✅ スプレッドシートの初期化が完了しました！\n\n' +
    '次の手順：\n' +
    '1. このスプレッドシートのIDをコピー（URLの /d/ と /edit の間）\n' +
    '2. プロジェクトの設定 → スクリプトプロパティ に以下を設定：\n' +
    '   - SHEET_ID: スプレッドシートID\n' +
    '   - LINE_TOKEN: LINE Messaging APIのトークン\n' +
    '   - LINE_GROUP_ID: LINE グループID\n' +
    '3. Code.gs をコピー＆ペーストして保存\n' +
    '4. デプロイ → 新しいデプロイ → ウェブアプリを選択',
    Browser.Buttons.OK
  );

  Logger.log('✅ スプレッドシートのセットアップが完了しました');
  Logger.log('スプレッドシートID: ' + ss.getId());
}

/**
 * スクリプトプロパティの設定を確認
 */
function checkScriptProperties() {
  const properties = PropertiesService.getScriptProperties();
  const sheetId = properties.getProperty('SHEET_ID');
  const lineToken = properties.getProperty('LINE_TOKEN');
  const lineGroupId = properties.getProperty('LINE_GROUP_ID');

  Logger.log('=== スクリプトプロパティの確認 ===');
  Logger.log('SHEET_ID: ' + (sheetId ? '✅ 設定済み' : '❌ 未設定'));
  Logger.log('LINE_TOKEN: ' + (lineToken ? '✅ 設定済み' : '❌ 未設定'));
  Logger.log('LINE_GROUP_ID: ' + (lineGroupId ? '✅ 設定済み' : '❌ 未設定'));

  if (!sheetId || !lineToken || !lineGroupId) {
    Browser.msgBox(
      '設定不足',
      '以下のスクリプトプロパティが未設定です：\n\n' +
      (sheetId ? '' : '❌ SHEET_ID\n') +
      (lineToken ? '' : '❌ LINE_TOKEN\n') +
      (lineGroupId ? '' : '❌ LINE_GROUP_ID\n') +
      '\nプロジェクトの設定 → スクリプトプロパティ から設定してください。',
      Browser.Buttons.OK
    );
  } else {
    Browser.msgBox(
      '設定完了',
      '✅ すべてのスクリプトプロパティが設定されています！',
      Browser.Buttons.OK
    );
  }
}

/**
 * サンプル打刻データを追加（テスト用）
 */
function addSampleData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const clockSheet = ss.getSheets()[1]; // シート2: 打刻記録

  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  // サンプルデータ
  clockSheet.appendRow([today, 'user01', '山田太郎', '09:00', '17:00', '8時間0分']);
  clockSheet.appendRow([today, 'user02', '佐藤花子', '09:30', '18:00', '8時間30分']);

  Browser.msgBox(
    'サンプルデータ追加完了',
    '✅ 打刻記録にサンプルデータを追加しました！',
    Browser.Buttons.OK
  );
}

/**
 * メニューをカスタマイズ
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('出退勤アプリ')
    .addItem('📋 初期セットアップ', 'setupSpreadsheet')
    .addItem('⚙️ 設定確認', 'checkScriptProperties')
    .addItem('📝 サンプルデータ追加', 'addSampleData')
    .addToUi();
}
