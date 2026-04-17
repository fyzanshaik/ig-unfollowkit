const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// State
let currentTab = 'dontFollowMeBack';
let currentFilter = 'all';
let currentResults = null;
let pollTimer = null;
let graphPollTimer = null;

const RING_C = 2 * Math.PI * 24; // circumference for r=24

// Elements
const views = {
  prompt: $('#viewPrompt'),
  progress: $('#viewProgress'),
  complete: $('#viewComplete'),
  error: $('#viewError'),
};

// --- Messaging ---
function send(type, payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload ? { type, payload } : { type }, resolve);
  });
}

// --- View switching ---
function showView(name) {
  Object.entries(views).forEach(([k, el]) => {
    el.classList.toggle('hidden', k !== name);
  });
}

// --- Progress ---
function setProgress(pct, title, detail) {
  const ring = $('#progressRing');
  ring.style.strokeDashoffset = RING_C - (pct / 100) * RING_C;
  $('#progressPct').textContent = `${Math.round(pct)}%`;
  if (title) $('#progressTitle').textContent = title;
  if (detail !== undefined) $('#progressDetail').textContent = detail;
}

// --- Toast ---
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

// --- Utils ---
function timeAgo(iso) {
  if (!iso) return '';
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// --- Render user list ---
function renderList(users) {
  const q = $('#searchInput').value.toLowerCase().trim();
  const list = $('#userList');
  const info = $('#resultsInfo');

  let filtered = users;
  if (currentFilter === 'verified') filtered = filtered.filter((u) => u.is_verified);
  else if (currentFilter === 'public_unverified') filtered = filtered.filter((u) => !u.is_private && !u.is_verified);
  else if (currentFilter === 'public') filtered = filtered.filter((u) => !u.is_private);
  else if (currentFilter === 'private') filtered = filtered.filter((u) => u.is_private);

  if (q) {
    filtered = filtered.filter(
      (u) => u.username.toLowerCase().includes(q) || u.full_name.toLowerCase().includes(q)
    );
  }

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">${q ? 'No matches' : 'None in this category'}</div>`;
    info.textContent = '';
    return;
  }

  const show = filtered.slice(0, 200);

  // Build HTML with data-src instead of src (prevents premature loading)
  list.innerHTML = show
    .map(
      (u) => `<div class="user-row">
      <div class="avatar-wrap">
        <span class="avatar-letter">${escHtml(u.username[0].toUpperCase())}</span>
        <img class="avatar-img" data-src="${escAttr(u.profile_pic_url)}" referrerpolicy="no-referrer" alt="" />
      </div>
      <div class="user-info">
        <a class="user-name" href="https://www.instagram.com/${escAttr(u.username)}/" target="_blank" rel="noopener">${escHtml(u.username)}</a>
        ${u.full_name ? `<div class="user-sub">${escHtml(u.full_name)}</div>` : ''}
      </div>
      ${u.is_verified ? '<span class="pill pill-verified">Verified</span>' : ''}
      ${u.is_private ? '<span class="pill pill-private">Private</span>' : ''}
    </div>`
    )
    .join('');

  // Now load images: attach handlers FIRST, then set src
  list.querySelectorAll('.avatar-img').forEach((img) => {
    const src = img.getAttribute('data-src');
    if (!src) return;

    img.addEventListener('load', () => {
      img.classList.add('loaded');
    });
    img.addEventListener('error', () => {
      // Letter fallback is already visible underneath
      img.remove();
    });
    img.src = src;
  });

  info.textContent =
    filtered.length > 200
      ? `Showing 200 of ${filtered.length} \u2014 use search to narrow down`
      : `${filtered.length} user${filtered.length !== 1 ? 's' : ''}`;
}

// --- Tab switching ---
function switchTab(tab) {
  currentTab = tab;
  // Deactivate diff cards if switching to a main tab
  if (!tab.startsWith('diff_')) {
    $$('.diff-card').forEach((c) => c.classList.remove('active'));
  }
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  if (currentResults) renderList(currentResults[tab] || []);
}

function switchDiffTab(tab) {
  currentTab = tab;
  // Deactivate main tabs, activate the diff card
  $$('.tab').forEach((t) => t.classList.remove('active'));
  $$('.diff-card').forEach((c) => c.classList.toggle('active', c.dataset.tab === tab));
  if (currentResults) renderList(currentResults[tab] || []);
}

// --- Polling ---
function startPoll() {
  stopPoll();
  pollTimer = setInterval(poll, 800);
}
function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function poll() {
  const s = await send('GET_STATUS');
  if (!s) return;
  applyState(s);
  if (s.status === 'complete' || s.status === 'error' || s.status === 'idle') {
    stopPoll();
    if (s.status === 'complete') await loadResults();
  }
}

function applyState(s) {
  switch (s.status) {
    case 'idle':
      showView(currentResults ? 'complete' : 'prompt');
      break;
    case 'starting':
    case 'fetching_profile':
      showView('progress');
      setProgress(2, 'Fetching profile...', 'Connecting');
      break;
    case 'fetching_followers': {
      showView('progress');
      const { fetched, total } = s.followersProgress;
      const p = total > 0 ? Math.max(5, (fetched / total) * 45) : 5;
      setProgress(p, 'Fetching followers...', `${fetched} / ${total}`);
      break;
    }
    case 'fetching_following': {
      showView('progress');
      const { fetched, total } = s.followingProgress;
      setProgress(50 + (total > 0 ? (fetched / total) * 40 : 0), 'Fetching following...', `${fetched} / ${total}`);
      break;
    }
    case 'cross_referencing':
      showView('progress'); setProgress(92, 'Analyzing...', 'Comparing lists'); break;
    case 'verifying':
      showView('progress'); setProgress(96, 'Verifying...', 'Double-checking'); break;
    case 'complete':
      showView('complete'); break;
    case 'error':
      showView('error');
      $('#errorMsg').textContent = s.error || 'Something went wrong';
      break;
  }
}

// --- Load data ---
async function loadResults() {
  const r = await send('GET_RESULTS');
  if (!r) return;
  currentResults = r;

  const sec = $('#resultsSection');
  const stats = $('#statsRow');
  sec.classList.remove('hidden');
  stats.classList.remove('hidden');
  showView('complete');

  const p = await send('GET_PROFILE');
  if (p) {
    $('#statFollowers').textContent = fmtNum(p.follower_count);
    $('#statFollowing').textContent = fmtNum(p.following_count);
  }
  $('#statNotFollowing').textContent = fmtNum(r.dontFollowMeBack?.length || 0);
  $('#statMutuals').textContent = fmtNum(r.mutuals?.length || 0);

  $('#tabCount0').textContent = r.dontFollowMeBack?.length || 0;
  $('#tabCount1').textContent = r.dontFollowMeBackUnverified?.length || 0;
  $('#tabCount2').textContent = r.iDontFollowBack?.length || 0;
  $('#tabCount3').textContent = r.mutuals?.length || 0;

  $('#lastScan').textContent = `Last scan: ${timeAgo(r.timestamp)}`;

  // Diff section
  const diffSec = $('#diffSection');
  if (r.diff) {
    diffSec.classList.remove('hidden');
    $('#diffNewFollowers').textContent = r.diff.newFollowers?.length || 0;
    $('#diffLostFollowers').textContent = r.diff.lostFollowers?.length || 0;
    $('#diffNewFollowing').textContent = r.diff.newFollowing?.length || 0;
    $('#diffUnfollowedByMe').textContent = r.diff.unfollowedByMe?.length || 0;
    $('#diffTimeAgo').textContent = `vs ${timeAgo(r.diff.previousTimestamp)}`;

    // Store diff lists in currentResults for tab switching
    currentResults.diff_newFollowers = r.diff.newFollowers || [];
    currentResults.diff_lostFollowers = r.diff.lostFollowers || [];
    currentResults.diff_newFollowing = r.diff.newFollowing || [];
    currentResults.diff_unfollowedByMe = r.diff.unfollowedByMe || [];
  } else {
    diffSec.classList.add('hidden');
  }

  renderList(currentResults[currentTab] || []);

  // Reveal graph section once mutuals are known
  const mutualCount = r.mutuals?.length || 0;
  const graphSection = $('#graphSection');
  if (mutualCount > 0) {
    graphSection.classList.remove('hidden');
    $('#graphMutualCount').textContent = mutualCount;
    $('#graphConfirmCount').textContent = mutualCount;
    const etaMin = estimateGraphMinutes(mutualCount);
    $('#graphEta').textContent = `~${etaMin} min`;
    $('#graphConfirmEta').textContent = `${etaMin} min`;
  } else {
    graphSection.classList.add('hidden');
  }

  await refreshGraphState();
}

function estimateGraphMinutes(n) {
  // 1 page typical (page_size=100) + 1s between nodes + some padding.
  // Worst case with fallback to 12/page: ~4 pages × 2s + phase ≈ 10s/node.
  // We show a mid estimate.
  const perNodeSec = 3;
  return Math.max(1, Math.round((n * perNodeSec) / 60));
}

async function loadProfile() {
  const p = await send('GET_PROFILE');
  if (!p) return;
  const chip = $('#profileChip');
  chip.classList.remove('hidden');
  $('#username').textContent = `@${p.username}`;

  if (p.profile_pic_url) {
    const img = $('#profilePic');
    const fb = $('#profilePicFallback');
    img.addEventListener('load', () => { img.style.opacity = '1'; });
    img.addEventListener('error', () => { img.style.display = 'none'; fb.style.display = 'block'; });
    img.src = p.profile_pic_url;
  }
}

// --- Init ---
async function init() {
  const s = await send('GET_STATUS');
  if (s) {
    applyState(s);
    if (!['idle', 'complete', 'error'].includes(s.status)) startPoll();
  }
  await loadProfile();
  await loadResults();
  if (!currentResults && (!s || s.status === 'idle')) showView('prompt');
}

// --- Actions ---
function startScan() {
  send('START_SCAN').then((resp) => {
    if (resp?.ok) {
      $('#resultsSection').classList.add('hidden');
      $('#statsRow').classList.add('hidden');
      $('#diffSection').classList.add('hidden');
      showView('progress');
      setProgress(0, 'Starting...', '');
      startPoll();
    } else {
      showView('error');
      $('#errorMsg').textContent = resp?.error || 'Failed to start';
    }
  });
}

$('#btnScan').addEventListener('click', startScan);
$('#btnRescan').addEventListener('click', startScan);
$('#btnRetry').addEventListener('click', startScan);

$('#btnCancel').addEventListener('click', async () => {
  await send('CANCEL_SCAN');
  showView(currentResults ? 'complete' : 'prompt');
  toast('Cancelled');
  stopPoll();
});

$('#btnCopyLogs').addEventListener('click', async () => {
  const r = await send('GET_LOGS');
  if (r?.logs) { await navigator.clipboard.writeText(r.logs); toast('Logs copied'); }
  else toast('No logs');
});

$('#btnClearData').addEventListener('click', async () => {
  await send('CLEAR_DATA');
  currentResults = null;
  stopGraphPoll();
  $('#resultsSection').classList.add('hidden');
  $('#statsRow').classList.add('hidden');
  $('#diffSection').classList.add('hidden');
  $('#graphSection').classList.add('hidden');
  $('#lastScan').textContent = '';
  showView('prompt');
  toast('Cleared');
});

$$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

$$('.diff-card').forEach((c) => {
  c.addEventListener('click', () => switchDiffTab(c.dataset.tab));
});

$$('.chip').forEach((c) => {
  c.addEventListener('click', () => {
    currentFilter = c.dataset.filter;
    $$('.chip').forEach((x) => x.classList.toggle('active', x === c));
    if (currentResults) renderList(currentResults[currentTab] || []);
  });
});

$('#searchInput').addEventListener('input', () => {
  if (currentResults) renderList(currentResults[currentTab] || []);
});

// --- Graph section ---

const GRAPH_STATES = ['graphIdle', 'graphConfirm', 'graphScanning', 'graphComplete', 'graphError'];

function showGraphState(name) {
  GRAPH_STATES.forEach((id) => {
    $('#' + id).classList.toggle('hidden', id !== name);
  });
}

async function refreshGraphState() {
  const [state, graph] = await Promise.all([send('GET_GRAPH_STATUS'), send('GET_GRAPH')]);
  applyGraphState(state, graph);
  if (state && (state.status === 'scanning' || state.status === 'starting')) {
    startGraphPoll();
  }
}

function applyGraphState(state, graph) {
  if (!state) {
    showGraphState('graphIdle');
    return;
  }
  switch (state.status) {
    case 'idle':
      if (graph && graph.nodes && graph.nodes.length > 0) {
        showGraphState('graphComplete');
        $('#graphCompleteNodes').textContent = graph.nodes.length;
        $('#graphCompleteEdges').textContent = graph.edges.length;
      } else {
        showGraphState('graphIdle');
      }
      break;
    case 'starting':
    case 'scanning': {
      showGraphState('graphScanning');
      const pct = state.totalNodes > 0 ? (state.currentIndex / state.totalNodes) * 100 : 0;
      $('#graphBar').style.width = `${pct}%`;
      $('#graphProgressTitle').textContent = state.currentNodeUsername
        ? `Scanning @${state.currentNodeUsername}...`
        : 'Scanning mutuals...';
      $('#graphProgressDetail').textContent = `${state.currentIndex} / ${state.totalNodes}`;
      $('#graphEdgesLabel').textContent = `${state.edgesCount || 0} edges`;
      break;
    }
    case 'complete':
      showGraphState('graphComplete');
      $('#graphCompleteNodes').textContent = (graph && graph.nodes.length) || state.totalNodes;
      $('#graphCompleteEdges').textContent = (graph && graph.edges.length) || state.edgesCount;
      break;
    case 'error':
      showGraphState('graphError');
      $('#graphErrorMsg').textContent = state.error || 'Something went wrong';
      break;
  }
}

function startGraphPoll() {
  stopGraphPoll();
  graphPollTimer = setInterval(pollGraph, 1000);
}
function stopGraphPoll() {
  if (graphPollTimer) {
    clearInterval(graphPollTimer);
    graphPollTimer = null;
  }
}
async function pollGraph() {
  const [state, graph] = await Promise.all([send('GET_GRAPH_STATUS'), send('GET_GRAPH')]);
  if (!state) return;
  applyGraphState(state, graph);
  if (state.status === 'complete' || state.status === 'error' || state.status === 'idle') {
    stopGraphPoll();
  }
}

function openGraphTab() {
  chrome.tabs.create({ url: chrome.runtime.getURL('graph/graph.html') });
}

$('#btnGraphBuild').addEventListener('click', () => {
  showGraphState('graphConfirm');
});
$('#btnGraphCancelConfirm').addEventListener('click', () => {
  showGraphState('graphIdle');
});
$('#btnGraphStart').addEventListener('click', async () => {
  const resp = await send('START_GRAPH_SCAN');
  if (resp?.ok) {
    showGraphState('graphScanning');
    $('#graphBar').style.width = '0%';
    $('#graphProgressDetail').textContent = '0 / 0';
    $('#graphEdgesLabel').textContent = '0 edges';
    startGraphPoll();
    openGraphTab();
  } else {
    showGraphState('graphError');
    $('#graphErrorMsg').textContent = resp?.error || 'Failed to start graph scan';
  }
});
$('#btnGraphCancelScan').addEventListener('click', async () => {
  await send('CANCEL_GRAPH_SCAN');
  stopGraphPoll();
  toast('Graph scan cancelled');
  refreshGraphState();
});
$('#btnGraphOpenTab').addEventListener('click', openGraphTab);
$('#btnGraphOpen').addEventListener('click', openGraphTab);
$('#btnGraphRebuild').addEventListener('click', async () => {
  await send('CLEAR_GRAPH');
  showGraphState('graphIdle');
});
$('#btnGraphRetry').addEventListener('click', () => showGraphState('graphIdle'));

init();
