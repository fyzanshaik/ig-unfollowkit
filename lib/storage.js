const STORAGE_KEYS = {
  SESSION: 'session',
  PROFILE: 'profileInfo',
  RESULTS: 'scanResults',
  HISTORY: 'scanHistory',
  STATE: 'scanState',
  LOGS: 'logs',
};

const MAX_HISTORY = 10;

export function defaultScanState() {
  return {
    status: 'idle',
    followersProgress: { fetched: 0, total: 0 },
    followingProgress: { fetched: 0, total: 0 },
    error: null,
    startedAt: null,
    completedAt: null,
  };
}

export async function getScanState() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.STATE);
  return result[STORAGE_KEYS.STATE] || defaultScanState();
}

export async function setScanState(state) {
  await chrome.storage.local.set({ [STORAGE_KEYS.STATE]: state });
}

export async function getSession() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SESSION);
  return result[STORAGE_KEYS.SESSION] || null;
}

export async function setSession(session) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.SESSION]: { ...session, lastUpdated: new Date().toISOString() },
  });
}

export async function getProfile() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.PROFILE);
  return result[STORAGE_KEYS.PROFILE] || null;
}

export async function setProfile(profile) {
  await chrome.storage.local.set({ [STORAGE_KEYS.PROFILE]: profile });
}

export async function getResults() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.RESULTS);
  return result[STORAGE_KEYS.RESULTS] || null;
}

export async function setResults(results) {
  await chrome.storage.local.set({ [STORAGE_KEYS.RESULTS]: results });
}

// --- Scan history ---

export async function getHistory() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.HISTORY);
  return result[STORAGE_KEYS.HISTORY] || [];
}

export async function pushHistory(snapshot) {
  const history = await getHistory();
  history.unshift(snapshot); // newest first
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: history });
}

export async function clearAll() {
  await chrome.storage.local.clear();
}
