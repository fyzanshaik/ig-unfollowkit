const STORAGE_KEYS = {
  SESSION: 'session',
  PROFILE: 'profileInfo',
  RESULTS: 'scanResults',
  HISTORY: 'scanHistory',
  STATE: 'scanState',
  LOGS: 'logs',
  GRAPH: 'graphData',
  GRAPH_STATE: 'graphState',
  GRAPH_PROGRESS: 'graphProgress',
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

// --- Graph ---

export function defaultGraphState() {
  return {
    status: 'idle', // idle | starting | scanning | paused | complete | error
    currentIndex: 0,
    totalNodes: 0,
    currentNodeUsername: null,
    edgesCount: 0,
    startedAt: null,
    completedAt: null,
    error: null,
    rateLimitedUntil: null,
  };
}

export async function getGraph() {
  const r = await chrome.storage.local.get(STORAGE_KEYS.GRAPH);
  return r[STORAGE_KEYS.GRAPH] || null;
}

export async function setGraph(graph) {
  await chrome.storage.local.set({ [STORAGE_KEYS.GRAPH]: graph });
}

export async function getGraphState() {
  const r = await chrome.storage.local.get(STORAGE_KEYS.GRAPH_STATE);
  return r[STORAGE_KEYS.GRAPH_STATE] || defaultGraphState();
}

export async function setGraphState(state) {
  await chrome.storage.local.set({ [STORAGE_KEYS.GRAPH_STATE]: state });
}

export async function getGraphProgress() {
  const r = await chrome.storage.local.get(STORAGE_KEYS.GRAPH_PROGRESS);
  return r[STORAGE_KEYS.GRAPH_PROGRESS] || {};
}

export async function setGraphProgress(progress) {
  await chrome.storage.local.set({ [STORAGE_KEYS.GRAPH_PROGRESS]: progress });
}

export async function clearGraphProgress() {
  await chrome.storage.local.remove(STORAGE_KEYS.GRAPH_PROGRESS);
}

export async function clearAll() {
  await chrome.storage.local.clear();
}
