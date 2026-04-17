const $ = (sel) => document.querySelector(sel);

// vis-network exposes `vis` globally from the standalone UMD build.
let network = null;
let nodesDs = null;
let edgesDs = null;
let currentGraph = null;
let degreeMap = new Map();
let usernameByPk = new Map();
let hubSet = new Set(); // pks whose label is always shown
let selectedNodeId = null;
let showAllLabels = false;
let pollTimer = null;

const HUB_LABEL_COUNT = 20;
const NODE_DEFAULT_COLOR = '#71717a';
const NODE_VERIFIED_COLOR = '#2563eb';
const NODE_PRIVATE_COLOR = '#d97706';
const EDGE_DIRECTED_COLOR = 'rgba(161,161,170,0.22)';
const EDGE_RECIPROCAL_COLOR = 'rgba(82,82,91,0.38)';
const EDGE_DIM_COLOR = 'rgba(228,228,231,0.12)';
const EDGE_HIGHLIGHT_COLOR = '#18181b';

function send(type) {
  return new Promise((resolve) => chrome.runtime.sendMessage({ type }, resolve));
}

// ---------- Status panel ----------

function showStatusPanel() {
  $('#statusPanel').classList.remove('hidden');
  $('#graphPanel').classList.add('hidden');
}
function showGraphPanel() {
  $('#statusPanel').classList.add('hidden');
  $('#graphPanel').classList.remove('hidden');
}

function renderStatus(state) {
  const title = $('#statusTitle');
  const detail = $('#statusDetail');
  const barWrap = $('#statusBarWrap');
  const bar = $('#statusBar');
  const current = $('#statusCurrent');
  const btns = $('#statusButtons');

  btns.innerHTML = '';

  if (!state || state.status === 'idle') {
    title.textContent = 'No graph yet';
    detail.textContent = 'Start a graph scan from the extension popup.';
    barWrap.classList.add('hidden');
    current.textContent = '';
    return;
  }

  if (state.status === 'starting' || state.status === 'scanning') {
    title.textContent = state.status === 'starting' ? 'Preparing scan...' : 'Building social graph...';
    const pct = state.totalNodes > 0 ? (state.currentIndex / state.totalNodes) * 100 : 0;
    detail.textContent = `${state.currentIndex} / ${state.totalNodes} mutuals scanned · ${state.edgesCount || 0} edges found`;
    barWrap.classList.remove('hidden');
    bar.style.width = `${pct}%`;
    current.textContent = state.currentNodeUsername ? `Now scanning @${state.currentNodeUsername}` : '';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel scan';
    cancelBtn.className = 'g-btn g-btn-danger';
    cancelBtn.onclick = async () => {
      await send('CANCEL_GRAPH_SCAN');
      stopPoll();
      loadAndRender();
    };
    btns.appendChild(cancelBtn);
    return;
  }

  if (state.status === 'error') {
    title.textContent = 'Scan failed';
    detail.textContent = state.error || 'Unknown error';
    barWrap.classList.add('hidden');
    current.textContent = '';
    return;
  }
}

// ---------- Polling ----------

function startPoll() {
  stopPoll();
  pollTimer = setInterval(tick, 1000);
}
function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
async function tick() {
  const state = await send('GET_GRAPH_STATUS');
  if (!state) return;
  if (state.status === 'complete') {
    stopPoll();
    await loadAndRender();
    return;
  }
  renderStatus(state);
}

// ---------- Graph helpers ----------

function computeReciprocalCount(edges) {
  const keySet = new Set(edges.map((e) => `${e.from}|${e.to}`));
  const seen = new Set();
  let n = 0;
  for (const e of edges) {
    const k = `${e.from}|${e.to}`;
    const rk = `${e.to}|${e.from}`;
    if (seen.has(k) || seen.has(rk)) continue;
    if (keySet.has(rk)) n++;
    seen.add(k);
  }
  return n;
}

function labelFor(pk, forceShow = false) {
  if (!forceShow && !showAllLabels && !hubSet.has(pk)) return '';
  const u = usernameByPk.get(pk);
  return u ? '@' + u : '';
}

function nodeColorFor(n) {
  if (n.is_verified) return NODE_VERIFIED_COLOR;
  if (n.is_private) return NODE_PRIVATE_COLOR;
  return NODE_DEFAULT_COLOR;
}

// ---------- Render ----------

function renderGraph(graph) {
  currentGraph = graph;
  showGraphPanel();

  // --- Precompute degree & metadata ---
  degreeMap = new Map();
  usernameByPk = new Map();
  for (const n of graph.nodes) usernameByPk.set(n.pk, n.username);
  for (const e of graph.edges) {
    degreeMap.set(e.from, (degreeMap.get(e.from) || 0) + 1);
    degreeMap.set(e.to, (degreeMap.get(e.to) || 0) + 1);
  }
  const sorted = [...degreeMap.entries()].sort((a, b) => b[1] - a[1]);
  hubSet = new Set(sorted.slice(0, HUB_LABEL_COUNT).map(([pk]) => pk));

  // --- Build visual edges (collapse reciprocal A↔B into one undirected) ---
  const directedSet = new Set(graph.edges.map((e) => `${e.from}|${e.to}`));
  const visEdges = [];
  const seen = new Set();
  for (const e of graph.edges) {
    const k = `${e.from}|${e.to}`;
    const rk = `${e.to}|${e.from}`;
    const reciprocal = directedSet.has(rk);
    const canonical = reciprocal ? [e.from, e.to].sort().join('|') : k;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    visEdges.push({
      id: canonical,
      from: e.from,
      to: e.to,
      _reciprocal: reciprocal,
      arrows: reciprocal ? undefined : 'to',
      color: { color: reciprocal ? EDGE_RECIPROCAL_COLOR : EDGE_DIRECTED_COLOR },
      width: reciprocal ? 0.6 : 0.35,
      smooth: false,
      selectionWidth: 1.5,
    });
  }

  // --- Build visual nodes ---
  const visNodes = graph.nodes.map((n) => ({
    id: n.pk,
    label: labelFor(n.pk),
    title: `@${n.username}${n.full_name ? '\n' + n.full_name : ''}\n${degreeMap.get(n.pk) || 0} connections`,
    value: Math.max(1, degreeMap.get(n.pk) || 1),
    shape: 'dot',
    color: {
      background: nodeColorFor(n),
      border: nodeColorFor(n),
      highlight: { background: nodeColorFor(n), border: '#18181b' },
      hover: { background: nodeColorFor(n), border: '#18181b' },
    },
    font: { size: 10, face: 'Inter, sans-serif', color: '#27272a', strokeWidth: 2, strokeColor: '#ffffff' },
    borderWidth: 0,
  }));

  nodesDs = new vis.DataSet(visNodes);
  edgesDs = new vis.DataSet(visEdges);

  const container = $('#visContainer');
  const data = { nodes: nodesDs, edges: edgesDs };
  const options = {
    nodes: {
      scaling: {
        min: 4,
        max: 22,
        label: { enabled: false },
      },
    },
    edges: {
      arrows: { to: { enabled: true, scaleFactor: 0.32 } },
      color: { inherit: false },
    },
    physics: {
      enabled: true,
      solver: 'barnesHut',
      barnesHut: {
        gravitationalConstant: -8000,
        centralGravity: 0.08,
        springLength: 180,
        springConstant: 0.012,
        damping: 0.72,
        avoidOverlap: 0.9,
      },
      stabilization: {
        enabled: true,
        iterations: 300,
        updateInterval: 40,
        onlyDynamicEdges: false,
        fit: true,
      },
      minVelocity: 0.8,
      timestep: 0.35,
    },
    interaction: {
      hover: true,
      tooltipDelay: 140,
      navigationButtons: false,
      hideEdgesOnDrag: true,
      hideEdgesOnZoom: true,
      hideNodesOnDrag: false,
    },
    layout: { improvedLayout: false }, // improvedLayout is slow for dense graphs
  };

  if (network) network.destroy();
  network = new vis.Network(container, data, options);

  network.once('stabilizationIterationsDone', () => {
    // Freeze physics so the main thread isn't pinned. User can re-run via button.
    network.setOptions({ physics: { enabled: false } });
  });

  network.on('click', (params) => {
    if (params.nodes.length === 0) clearSelection();
    else selectNode(params.nodes[0]);
  });

  network.on('hoverNode', (params) => {
    if (selectedNodeId) return;
    softHighlightLabels(params.node);
  });
  network.on('blurNode', () => {
    if (selectedNodeId) return;
    resetLabels();
  });

  // --- Stats ---
  $('#statNodes').textContent = graph.nodes.length;
  $('#statEdges').textContent = graph.edges.length;
  $('#statReciprocal').textContent = computeReciprocalCount(graph.edges);

  const d = new Date(graph.timestamp);
  $('#headerMeta').textContent = `${graph.nodes.length} nodes · ${graph.edges.length} edges · ${d.toLocaleString()}`;

  applyFilters();
}

// ---------- Selection / highlight ----------

function neighborsOf(nodeId) {
  const set = new Set([nodeId]);
  for (const e of currentGraph.edges) {
    if (e.from === nodeId) set.add(e.to);
    if (e.to === nodeId) set.add(e.from);
  }
  return set;
}

function selectNode(nodeId) {
  selectedNodeId = nodeId;
  const node = currentGraph.nodes.find((n) => n.pk === nodeId);
  if (!node) return;

  const out = currentGraph.edges.filter((e) => e.from === nodeId).length;
  const inc = currentGraph.edges.filter((e) => e.to === nodeId).length;

  const panel = $('#selectedPanel');
  panel.classList.remove('hidden');
  $('#selectedBody').innerHTML = `
    <div class="g-sel-name">@${escapeHtml(node.username)}</div>
    <div class="g-sel-sub">${escapeHtml(node.full_name || '')}</div>
    <div class="g-sel-pills">
      ${node.is_verified ? '<span class="g-pill g-pill-verified">verified</span>' : ''}
      ${node.is_private ? '<span class="g-pill g-pill-private">private</span>' : ''}
    </div>
    <div class="g-sel-row"><span>follows in graph</span><span>${out}</span></div>
    <div class="g-sel-row"><span>followed in graph</span><span>${inc}</span></div>
    <div class="g-sel-row"><span>total degree</span><span>${degreeMap.get(nodeId) || 0}</span></div>
    <a class="g-sel-link" href="https://www.instagram.com/${encodeURIComponent(node.username)}/" target="_blank" rel="noopener">Open profile ↗</a>
  `;

  highlightNeighborhood(nodeId);
}

function clearSelection() {
  selectedNodeId = null;
  $('#selectedPanel').classList.add('hidden');
  resetHighlight();
}

// Batched neighborhood highlight — single .update per DataSet instead of N calls
function highlightNeighborhood(nodeId) {
  if (!nodesDs || !edgesDs || !currentGraph) return;
  const neighbors = neighborsOf(nodeId);

  const nodeUpdates = [];
  nodesDs.forEach((n) => {
    const isIn = neighbors.has(n.id);
    nodeUpdates.push({
      id: n.id,
      opacity: isIn ? 1 : 0.12,
      label: isIn ? labelFor(n.id, true) : '',
    });
  });
  nodesDs.update(nodeUpdates);

  const edgeUpdates = [];
  edgesDs.forEach((e) => {
    const touches = e.from === nodeId || e.to === nodeId;
    edgeUpdates.push({
      id: e.id,
      color: { color: touches ? EDGE_HIGHLIGHT_COLOR : EDGE_DIM_COLOR },
      width: touches ? 1.6 : 0.2,
    });
  });
  edgesDs.update(edgeUpdates);
}

function resetHighlight() {
  if (!nodesDs || !edgesDs) return;
  const nodeUpdates = [];
  nodesDs.forEach((n) => {
    nodeUpdates.push({ id: n.id, opacity: 1, label: labelFor(n.id) });
  });
  nodesDs.update(nodeUpdates);

  const edgeUpdates = [];
  edgesDs.forEach((e) => {
    const reciprocal = e._reciprocal;
    edgeUpdates.push({
      id: e.id,
      color: { color: reciprocal ? EDGE_RECIPROCAL_COLOR : EDGE_DIRECTED_COLOR },
      width: reciprocal ? 0.6 : 0.35,
    });
  });
  edgesDs.update(edgeUpdates);
}

// Lightweight hover effect: just add labels for the hovered node + neighbors.
function softHighlightLabels(nodeId) {
  if (!nodesDs || !currentGraph) return;
  const neighbors = neighborsOf(nodeId);
  const nodeUpdates = [];
  nodesDs.forEach((n) => {
    nodeUpdates.push({ id: n.id, label: neighbors.has(n.id) ? labelFor(n.id, true) : labelFor(n.id) });
  });
  nodesDs.update(nodeUpdates);
}

function resetLabels() {
  if (!nodesDs) return;
  const nodeUpdates = [];
  nodesDs.forEach((n) => nodeUpdates.push({ id: n.id, label: labelFor(n.id) }));
  nodesDs.update(nodeUpdates);
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ---------- Filters / search ----------

function applyFilters() {
  if (!currentGraph || !nodesDs || !edgesDs) return;

  const q = $('#searchInput').value.trim().toLowerCase();
  const verifiedOnly = $('#filterVerified').checked;
  const privateOnly = $('#filterPrivate').checked;
  const hideIsolated = $('#filterIsolated').checked;

  const visibleSet = new Set();
  for (const n of currentGraph.nodes) {
    if (verifiedOnly && !n.is_verified) continue;
    if (privateOnly && !n.is_private) continue;
    if (hideIsolated && (degreeMap.get(n.pk) || 0) === 0) continue;
    if (q && !n.username.toLowerCase().includes(q) && !(n.full_name || '').toLowerCase().includes(q)) continue;
    visibleSet.add(n.pk);
  }

  const nodeUpdates = [];
  nodesDs.forEach((n) => nodeUpdates.push({ id: n.id, hidden: !visibleSet.has(n.id) }));
  nodesDs.update(nodeUpdates);

  const edgeUpdates = [];
  edgesDs.forEach((e) => edgeUpdates.push({ id: e.id, hidden: !(visibleSet.has(e.from) && visibleSet.has(e.to)) }));
  edgesDs.update(edgeUpdates);
}

$('#searchInput').addEventListener('input', applyFilters);
$('#filterVerified').addEventListener('change', applyFilters);
$('#filterPrivate').addEventListener('change', applyFilters);
$('#filterIsolated').addEventListener('change', applyFilters);

$('#btnFit').addEventListener('click', () => {
  if (network) network.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
});

// Labels + layout controls
const labelsToggleEl = $('#labelsToggle');
if (labelsToggleEl) {
  labelsToggleEl.addEventListener('change', (e) => {
    showAllLabels = e.target.checked;
    if (selectedNodeId) highlightNeighborhood(selectedNodeId);
    else resetLabels();
  });
}

const restartBtn = $('#btnRestartLayout');
if (restartBtn) {
  restartBtn.addEventListener('click', () => {
    if (!network) return;
    network.setOptions({ physics: { enabled: true } });
    network.stabilize(300);
    network.once('stabilizationIterationsDone', () => {
      network.setOptions({ physics: { enabled: false } });
    });
  });
}

// ---------- Boot ----------

async function loadAndRender() {
  const [state, graph] = await Promise.all([send('GET_GRAPH_STATUS'), send('GET_GRAPH')]);

  if (graph && graph.nodes && graph.nodes.length > 0) {
    renderGraph(graph);
    if (state && (state.status === 'scanning' || state.status === 'starting')) {
      startPoll();
    }
    return;
  }

  showStatusPanel();
  renderStatus(state);
  if (state && (state.status === 'scanning' || state.status === 'starting')) {
    startPoll();
  }
}

loadAndRender();
