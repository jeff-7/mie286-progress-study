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
  'order', 'partialSave', 'blockSeconds',
  'numericMeanRT', 'numericAccuracy', 'numericScore', 'numericCompleted',
  'barMeanRT', 'barAccuracy', 'barScore', 'barCompleted',
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

    if (String(data.uploadMode || '') === 'replace_all' || truthy_(data.replaceAllTrials)) {
      replaceTrialRows_(trialsSheet, data.participantId || '', data.sessionId || '', data.trialData || [], now);
    } else {
      upsertTrialChunk_(trialsSheet, data.trialData || [], now);
    }

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
      const numericCompleted = safeNum_(row.numericCompleted);
      const numericAccuracy = safeNum_(row.numericAccuracy);
      const numericScore = computeScore_(numericCompleted, numericAccuracy);
      const barCompleted = safeNum_(row.barCompleted);
      const barAccuracy = safeNum_(row.barAccuracy);
      const barScore = computeScore_(barCompleted, barAccuracy);
      const bestIsNumeric = numericScore >= barScore;
      const entry = {
        participantId: row.participantId || '',
        nickname: row.nickname || '',
        score: Math.max(numericScore, barScore),
        accuracy: bestIsNumeric ? numericAccuracy : barAccuracy,
        meanRT: bestIsNumeric ? safeNum_(row.numericMeanRT) : safeNum_(row.barMeanRT),
        completed: bestIsNumeric ? numericCompleted : barCompleted,
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

  const newRows = (trialData || []).map(row => buildTrialRecord_(row, now));
  const allRows = keptRows.concat(newRows).map(obj => TRIAL_HEADERS.map(header => obj[header] ?? ''));
  rewriteSheet_(sheet, TRIAL_HEADERS, allRows);
}

function upsertTrialChunk_(sheet, trialData, now) {
  normalizeSheetHeaders_(sheet, TRIAL_HEADERS);

  const existingRows = readSheetObjects_(sheet, TRIAL_HEADERS);
  const nextRows = [];
  const indexByKey = new Map();

  existingRows.forEach(row => {
    const key = trialRowKey_(row);
    if (!key) return;
    indexByKey.set(key, nextRows.length);
    nextRows.push(row);
  });

  (trialData || []).forEach(row => {
    const record = buildTrialRecord_(row, now);
    const key = trialRowKey_(record);
    if (!key) return;

    if (indexByKey.has(key)) {
      nextRows[indexByKey.get(key)] = record;
    } else {
      indexByKey.set(key, nextRows.length);
      nextRows.push(record);
    }
  });

  rewriteSheet_(sheet, TRIAL_HEADERS, nextRows.map(row => TRIAL_HEADERS.map(header => row[header] ?? '')));
}

function buildTrialRecord_(row, now) {
  return {
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
  };
}

function trialRowKey_(row) {
  if (!row || !row.sessionId || row.trial === '' || row.trial === null || typeof row.trial === 'undefined') {
    return '';
  }
  return [
    row.participantId || '',
    row.sessionId || '',
    truthy_(row.practice) ? 'practice' : 'main',
    row.condition || '',
    String(row.trial)
  ].join('__');
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
  const numericMeanRT = safeNum_(data.numericSummary && data.numericSummary.meanRT);
  const numericAccuracy = safeNum_(data.numericSummary && data.numericSummary.accuracy);
  const numericCompleted = safeNum_(data.numericSummary && (data.numericSummary.completed ?? data.numericSummary.attempted));
  const numericScore = computeScore_(numericCompleted, numericAccuracy);
  const barMeanRT = safeNum_(data.barSummary && data.barSummary.meanRT);
  const barAccuracy = safeNum_(data.barSummary && data.barSummary.accuracy);
  const barCompleted = safeNum_(data.barSummary && (data.barSummary.completed ?? data.barSummary.attempted));
  const barScore = computeScore_(barCompleted, barAccuracy);
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
    blockSeconds: safeNum_(data.blockSeconds),
    numericMeanRT,
    numericAccuracy,
    numericScore,
    numericCompleted,
    barMeanRT,
    barAccuracy,
    barScore,
    barCompleted,
    finalScore: Math.max(numericScore, barScore),
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
  return values
    .map(row => rowToObject_(headers, row))
    .filter(row => Object.values(row).some(value => value !== '' && value !== null));
}

function rewriteSheet_(sheet, headers, rows) {
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  applySheetFormats_(sheet, headers, Math.max(rows.length, 1));
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

function computeScore_(completed, accuracy) {
  return Number((safeNum_(completed) * Math.pow(safeNum_(accuracy), 2)).toFixed(2));
}

function applySheetFormats_(sheet, headers, rowCount) {
  const formats = {};
  if (headers === TRIAL_HEADERS) {
    formats.blockIndex = '0';
    formats.trial = '0';
    formats.rtMs = '0';
    formats.elapsedMsInBlock = '0';
  }
  if (headers === LEADERBOARD_HEADERS) {
    formats.blockSeconds = '0';
    formats.numericMeanRT = '0';
    formats.numericAccuracy = '0.0000';
    formats.numericScore = '0.00';
    formats.numericCompleted = '0';
    formats.barMeanRT = '0';
    formats.barAccuracy = '0.0000';
    formats.barScore = '0.00';
    formats.barCompleted = '0';
    formats.finalScore = '0.00';
  }
  Object.keys(formats).forEach((header) => {
    const idx = headers.indexOf(header);
    if (idx === -1) return;
    sheet.getRange(2, idx + 1, rowCount, 1).setNumberFormat(formats[header]);
  });
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
  if (value instanceof Date) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function resetExperimentData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const trialsSheet = getOrCreateSheet_(ss, TRIAL_SHEET_NAME, TRIAL_HEADERS);
  const leaderboardSheet = getOrCreateSheet_(ss, LEADERBOARD_SHEET_NAME, LEADERBOARD_HEADERS);
  rewriteSheet_(trialsSheet, TRIAL_HEADERS, []);
  rewriteSheet_(leaderboardSheet, LEADERBOARD_HEADERS, []);
}
