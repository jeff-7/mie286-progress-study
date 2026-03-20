const TRIAL_SHEET_NAME = 'Trials';
const LEADERBOARD_SHEET_NAME = 'Leaderboard';

const TRIAL_HEADERS = [
  'participantId', 'nickname', 'sessionId', 'deviceType', 'inputMode', 'soundEnabled', 'joinLeaderboard',
  'condition', 'blockIndex', 'practice', 'trial', 'stimulus',
  'correctKey', 'responseKey', 'correct', 'rtMs', 'elapsedMsInBlock',
  'timestamp', 'savedAt'
];

const LEADERBOARD_HEADERS = [
  'participantId', 'nickname', 'sessionId', 'deviceType', 'inputMode', 'soundEnabled', 'joinLeaderboard',
  'order', 'partialSave',
  'numericMeanRT', 'numericAccuracy', 'numericScore',
  'barMeanRT', 'barAccuracy', 'barScore',
  'finalScore', 'updatedAt'
];

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    const data = parseRequest_(e);
    const now = new Date();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const trialsSheet = getOrCreateSheet_(ss, TRIAL_SHEET_NAME, TRIAL_HEADERS);
    const leaderboardSheet = getOrCreateSheet_(ss, LEADERBOARD_SHEET_NAME, LEADERBOARD_HEADERS);

    upsertLeaderboardRow_(leaderboardSheet, buildLeaderboardRecord_(data, now));
    replaceTrialRows_(trialsSheet, data.participantId || '', data.sessionId || '', data.trialData || [], now);

    return jsonResponse_({ status: 'ok' });
  } catch (err) {
    return jsonResponse_({
      status: 'error',
      message: err && err.message ? err.message : String(err)
    });
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {
    }
  }
}

function doGet(e) {
  const mode = String((e && e.parameter && e.parameter.mode) || '');

  if (mode === 'leaderboard') {
    return jsonResponse_({ entries: getLeaderboardEntries_() });
  }

  return jsonResponse_({ status: 'ready' });
}

function getLeaderboardEntries_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, LEADERBOARD_SHEET_NAME, LEADERBOARD_HEADERS);
  const rows = readSheetObjects_(sheet, LEADERBOARD_HEADERS);
  const bestEntries = new Map();

  rows
    .filter(row => truthy_(row.joinLeaderboard))
    .filter(row => !truthy_(row.partialSave))
    .forEach(row => {
      const entry = {
        participantId: row.participantId || '',
        nickname: row.nickname || '',
        score: safeNum_(row.finalScore),
        accuracy: Math.max(safeNum_(row.numericAccuracy), safeNum_(row.barAccuracy)),
        meanRT: pickBestRT_(
          safeNum_(row.numericScore),
          safeNum_(row.numericMeanRT),
          safeNum_(row.barScore),
          safeNum_(row.barMeanRT)
        ),
        updatedAt: row.updatedAt || ''
      };

      const key = String(row.participantId || row.nickname || row.sessionId || Utilities.getUuid());
      const prev = bestEntries.get(key);

      if (!prev || entry.score > prev.score || (entry.score === prev.score && entry.meanRT < prev.meanRT)) {
        bestEntries.set(key, entry);
      }
    });

  return Array.from(bestEntries.values())
    .sort((a, b) => b.score - a.score || a.meanRT - b.meanRT)
    .slice(0, 20)
    .map(({ updatedAt, ...rest }) => rest);
}

function replaceTrialRows_(sheet, participantId, sessionId, trialData, now) {
  normalizeSheetHeaders_(sheet, TRIAL_HEADERS);

  const existingRows = readSheetObjects_(sheet, TRIAL_HEADERS);
  const keptRows = existingRows.filter(row => {
    return !(String(row.participantId) === String(participantId) && String(row.sessionId) === String(sessionId));
  });

  const newRows = (trialData || []).map(row => ({
    participantId: row.participantId || '',
    nickname: row.nickname || '',
    sessionId: row.sessionId || '',
    deviceType: row.deviceType || '',
    inputMode: row.inputMode || '',
    soundEnabled: truthy_(row.soundEnabled),
    joinLeaderboard: truthy_(row.joinLeaderboard),
    condition: row.condition || '',
    blockIndex: row.blockIndex ?? '',
    practice: truthy_(row.practice),
    trial: row.trial ?? '',
    stimulus: row.stimulus || '',
    correctKey: row.correctKey || '',
    responseKey: row.responseKey || '',
    correct: truthy_(row.correct),
    rtMs: safeNum_(row.rtMs),
    elapsedMsInBlock: safeNum_(row.elapsedMsInBlock),
    timestamp: row.timestamp || '',
    savedAt: now
  }));

  const allRows = keptRows.concat(newRows).map(obj => TRIAL_HEADERS.map(header => obj[header] ?? ''));
  rewriteSheet_(sheet, TRIAL_HEADERS, allRows);
}

function upsertLeaderboardRow_(sheet, obj) {
  normalizeSheetHeaders_(sheet, LEADERBOARD_HEADERS);

  const rows = readSheetObjects_(sheet, LEADERBOARD_HEADERS);
  const key = `${obj.participantId}__${obj.sessionId}`;
  let replaced = false;

  const nextRows = rows.map(row => {
    const rowKey = `${row.participantId || ''}__${row.sessionId || ''}`;
    if (rowKey === key) {
      replaced = true;
      return obj;
    }
    return row;
  });

  if (!replaced) nextRows.push(obj);

  rewriteSheet_(sheet, LEADERBOARD_HEADERS, nextRows.map(row => LEADERBOARD_HEADERS.map(header => row[header] ?? '')));
}

function buildLeaderboardRecord_(data, now) {
  return {
    participantId: data.participantId || '',
    nickname: data.nickname || '',
    sessionId: data.sessionId || '',
    deviceType: data.deviceType || '',
    inputMode: data.inputMode || '',
    soundEnabled: truthy_(data.soundEnabled),
    joinLeaderboard: truthy_(data.joinLeaderboard),
    order: data.order || '',
    partialSave: truthy_(data.partialSave),
    numericMeanRT: safeNum_(data.numericSummary && data.numericSummary.meanRT),
    numericAccuracy: safeNum_(data.numericSummary && data.numericSummary.accuracy),
    numericScore: safeNum_(data.numericSummary && data.numericSummary.score),
    barMeanRT: safeNum_(data.barSummary && data.barSummary.meanRT),
    barAccuracy: safeNum_(data.barSummary && data.barSummary.accuracy),
    barScore: safeNum_(data.barSummary && data.barSummary.score),
    finalScore: safeNum_(data.finalScore),
    updatedAt: now
  };
}

function getOrCreateSheet_(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  normalizeSheetHeaders_(sheet, headers);
  return sheet;
}

function normalizeSheetHeaders_(sheet, expectedHeaders) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow === 0 || lastCol === 0) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    return;
  }

  const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (currentHeaders.join('|') === expectedHeaders.join('|')) return;

  const currentRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  const normalizedRows = currentRows.map(row => {
    return expectedHeaders.map(header => {
      const idx = currentHeaders.indexOf(header);
      return idx === -1 ? '' : row[idx];
    });
  });

  rewriteSheet_(sheet, expectedHeaders, normalizedRows);
}

function readSheetObjects_(sheet, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(row => rowToObject_(headers, row));
}

function rewriteSheet_(sheet, headers, rows) {
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (!rows.length) return;
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function parseRequest_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('Missing POST body.');
  }

  try {
    return JSON.parse(e.postData.contents);
  } catch (_) {
    throw new Error('Invalid JSON payload.');
  }
}

function rowToObject_(headers, row) {
  const obj = {};
  headers.forEach((header, idx) => {
    obj[header] = row[idx];
  });
  return obj;
}

function pickBestRT_(numericScore, numericMeanRT, barScore, barMeanRT) {
  return numericScore >= barScore ? numericMeanRT : barMeanRT;
}

function truthy_(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function safeNum_(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
