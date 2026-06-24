/*************************************************************
 * 旭建設CW出勤簿アプリ  ―  サーバー側スクリプト (Code.gs)
 * Google スプレッドシートに紐づく「コンテナバインド」スクリプトとして利用します。
 *************************************************************/

// ===== シート名 =====
const SHEET_USERS   = 'ユーザー';
const SHEET_SITES   = '現場';
const SHEET_RECORDS = '出勤記録';
const SHEET_ADMIN   = '管理者';

function getSS() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/*************************************************************
 * 1. 画面ルーティング
 *   通常アクセス     → シビルワーカー画面 (Index)
 *   ?page=admin 付き → 管理者ログイン/管理画面 (Admin)
 *************************************************************/
function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'worker';
  const file = (page === 'admin') ? 'Admin' : 'Index';
  return HtmlService.createTemplateFromFile(file)
    .evaluate()
    .setTitle('旭建設CW出勤簿アプリ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getAppUrl() {
  return ScriptApp.getService().getUrl();
}

/*************************************************************
 * 2. 初期セットアップ（最初に1回だけ手動実行）
 *   エディタ上部の関数選択 → setup → 実行
 *************************************************************/
function setup() {
  const ss = getSS();

  // ユーザー
  let sh = ss.getSheetByName(SHEET_USERS) || ss.insertSheet(SHEET_USERS);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['ユーザーID', '氏名', '有給残日数', '有効']);
    sh.getRange('A1:D1').setFontWeight('bold').setBackground('#bae6fd');
  }

  // 現場
  sh = ss.getSheetByName(SHEET_SITES) || ss.insertSheet(SHEET_SITES);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['現場ID', '現場名', '有効']);
    sh.getRange('A1:C1').setFontWeight('bold').setBackground('#bae6fd');
  }

  // 出勤記録
  sh = ss.getSheetByName(SHEET_RECORDS) || ss.insertSheet(SHEET_RECORDS);
  if (sh.getLastRow() === 0) {
    sh.appendRow([
      '記録ID', '登録日時', '日付', '氏名', '出勤区分', '現場種別', '現場', '出勤数',
      '残業', '残業開始', '残業終了', '宿泊', '食事', '車両区分',
      '自宅〜現場(km)', '自宅〜集合場所(km)', '運転者', '同乗者'
    ]);
    sh.getRange('A1:R1').setFontWeight('bold').setBackground('#bae6fd');
  }

  // 管理者（初期ログイン：admin / asahi0000）
  sh = ss.getSheetByName(SHEET_ADMIN) || ss.insertSheet(SHEET_ADMIN);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['ログインID', 'パスワード']);
    sh.appendRow(['admin', 'asahi0000']);
    sh.getRange('A1:B1').setFontWeight('bold').setBackground('#bae6fd');
  }

  SpreadsheetApp.getUi().alert('セットアップが完了しました。\n初期管理者ID：admin / パスワード：asahi0000');
}

/*************************************************************
 * 3. シビルワーカー画面用 API
 *************************************************************/

// 有効なユーザー一覧 [{id, name, leave}]
function getActiveUsers() {
  const sh = getSS().getSheetByName(SHEET_USERS);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .filter(r => r[1] && r[3] !== false && r[3] !== 'FALSE' && r[3] !== '×')
    .map(r => ({ id: r[0], name: r[1], leave: r[2] }));
}

// 有効な現場一覧 [現場名,...]
function getActiveSites() {
  const sh = getSS().getSheetByName(SHEET_SITES);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
    .filter(r => r[1] && r[2] !== false && r[2] !== 'FALSE' && r[2] !== '×')
    .map(r => r[1]);
}

// 指定ユーザーの有給残日数
function getUserLeave(name) {
  const u = getActiveUsers().find(x => x.name === name);
  return u ? u.leave : '';
}

// C列（日付）以降の16項目を組み立て（新規・更新で共通）
function recordTail_(data) {
  return [
    data.date,
    data.userName,
    data.attendance,            // 終日 / 午前 / 午後 / 休み
    data.siteMode,              // 単一現場 / 複数現場 / （休み・午前午後は空 or 単一現場）
    data.site || '',            // 現場（複数は「現場A、現場B」、休みは「休み」）
    data.workDays,              // 出勤数（1 / 0.5 / 0）
    data.overtime,              // あり / なし
    data.overtimeStart || '',
    data.overtimeEnd || '',
    data.stay,                  // 宿泊 あり / なし
    data.meal,                  // 食事（宿泊ありのときのみ）
    data.carType,               // 社用車 / 自家用車
    data.commuteGenba || '',    // 自宅〜現場(km)
    data.commuteShugo || '',    // 自宅〜集合場所(km)
    data.driver || '',
    (data.passengers || []).join('、')
  ];
}

// 新規登録
function submitRecord(data) {
  const sh = getSS().getSheetByName(SHEET_RECORDS);
  const id = Utilities.getUuid().slice(0, 8);
  sh.appendRow([id, new Date()].concat(recordTail_(data)));
  return { ok: true, id: id };
}

// 既存記録を上書き（記録IDで特定）
function updateRecord(id, data) {
  const sh = getSS().getSheetByName(SHEET_RECORDS);
  if (!sh || sh.getLastRow() < 2) return { ok: false };
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      const row = i + 2;
      sh.getRange(row, 2).setValue(new Date());
      sh.getRange(row, 3, 1, 16).setValues([recordTail_(data)]);
      return { ok: true, id: id };
    }
  }
  return { ok: false };
}

// 氏名＋日付で、その日の最新記録を取得（無ければ null）
function getRecordForEdit(name, dateStr) {
  const sh = getSS().getSheetByName(SHEET_RECORDS);
  if (!sh || sh.getLastRow() < 2) return null;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 18).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (String(r[3]) !== String(name)) continue;
    let d = r[2];
    d = (d instanceof Date)
      ? Utilities.formatDate(d, 'JST', 'yyyy-MM-dd')
      : String(d).replace(/\//g, '-').slice(0, 10);
    if (d !== dateStr) continue;
    return {
      id: r[0], attendance: r[4], siteMode: r[5], site: r[6],
      overtime: r[8], otStart: r[9], otEnd: r[10], stay: r[11], meal: r[12],
      carType: r[13], commuteGenba: r[14], commuteShugo: r[15],
      driver: r[16], passengers: r[17]
    };
  }
  return null;
}

/*************************************************************
 * 4. 管理者画面用 API
 *************************************************************/

// ログイン認証
function adminLogin(id, pass) {
  const sh = getSS().getSheetByName(SHEET_ADMIN);
  if (!sh || sh.getLastRow() < 2) return false;
  return sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()
    .some(r => String(r[0]) === String(id) && String(r[1]) === String(pass));
}

// --- ユーザー管理 ---
function adminGetUsers() {
  const sh = getSS().getSheetByName(SHEET_USERS);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .map(r => ({ id: r[0], name: r[1], leave: r[2], active: !(r[3] === false || r[3] === 'FALSE' || r[3] === '×') }));
}

function adminAddUser(name, leave) {
  const sh = getSS().getSheetByName(SHEET_USERS);
  sh.appendRow(['U' + Utilities.getUuid().slice(0, 6), name, Number(leave) || 0, true]);
  return { ok: true };
}

function adminUpdateLeave(id, leave) {
  const sh = getSS().getSheetByName(SHEET_USERS);
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) { sh.getRange(i + 2, 3).setValue(Number(leave) || 0); return { ok: true }; }
  }
  return { ok: false };
}

function adminToggleUser(id, active) {
  const sh = getSS().getSheetByName(SHEET_USERS);
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) { sh.getRange(i + 2, 4).setValue(active); return { ok: true }; }
  }
  return { ok: false };
}

// --- 現場管理 ---
function adminGetSites() {
  const sh = getSS().getSheetByName(SHEET_SITES);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
    .map(r => ({ id: r[0], name: r[1], active: !(r[2] === false || r[2] === 'FALSE' || r[2] === '×') }));
}

function adminAddSite(name) {
  const sh = getSS().getSheetByName(SHEET_SITES);
  sh.appendRow(['S' + Utilities.getUuid().slice(0, 6), name, true]);
  return { ok: true };
}

function adminToggleSite(id, active) {
  const sh = getSS().getSheetByName(SHEET_SITES);
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) { sh.getRange(i + 2, 3).setValue(active); return { ok: true }; }
  }
  return { ok: false };
}

// --- 出勤記録の閲覧（新しい順・最大500件・絞り込み対応）---
function adminGetRecords(filter) {
  const sh = getSS().getSheetByName(SHEET_RECORDS);
  if (!sh || sh.getLastRow() < 2) return [];
  let rows = sh.getRange(2, 1, sh.getLastRow() - 1, 18).getValues().map(r => ({
    id: r[0],
    created: r[1] ? Utilities.formatDate(new Date(r[1]), 'JST', 'yyyy/MM/dd HH:mm') : '',
    date: r[2] ? (r[2] instanceof Date ? Utilities.formatDate(r[2], 'JST', 'yyyy/MM/dd') : String(r[2])) : '',
    name: r[3], attendance: r[4], siteMode: r[5], site: r[6], workDays: r[7],
    overtime: r[8], otStart: r[9], otEnd: r[10], stay: r[11], meal: r[12], carType: r[13],
    commuteGenba: r[14], commuteShugo: r[15], driver: r[16], passengers: r[17]
  }));

  if (filter) {
    if (filter.name)     rows = rows.filter(r => r.name === filter.name);
    if (filter.dateFrom) rows = rows.filter(r => r.date >= filter.dateFrom.replace(/-/g, '/'));
    if (filter.dateTo)   rows = rows.filter(r => r.date <= filter.dateTo.replace(/-/g, '/'));
  }

  return rows.reverse().slice(0, 500);
}