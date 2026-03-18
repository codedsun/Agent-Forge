// ── State ──────────────────────────────────────────────────────────────────────

const state = {
  running: false,
  projects: [],
  selectedProjectIds: [],
  currentFilter: 'all',
  logEntries: [],
  enhancedTicket: null,
  plan: null,
  archPlan: null,
  repoPayload: null,
  reviewPayload: null,
  qa1Payload: null,
  qa2Payload: null,
  agentStatuses: {},
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const dom = {
  projectList:        $('projectList'),
  addProjectBtn:      $('addProjectBtn'),
  addProjectForm:     $('addProjectForm'),
  newProjectName:     $('newProjectName'),
  newProjectPath:     $('newProjectPath'),
  newProjectType:     $('newProjectType'),
  dirBrowser:         $('dirBrowser'),
  dirBreadcrumb:      $('dirBreadcrumb'),
  dirList:            $('dirList'),
  dirSelected:        $('dirSelected'),
  cancelAddProject:   $('cancelAddProject'),
  confirmAddProject:  $('confirmAddProject'),
  ticket:             $('ticket'),
  settingsToggle:     $('settingsToggle'),
  settingsBody:       $('settingsBody'),
  toggleArrow:        $('toggleArrow'),
  contextIndicator:   $('contextIndicator'),
  contextText:        $('contextText'),
  runBtn:             $('runBtn'),
  pipelineStatus:     $('pipelineStatus'),
  branchBadge:        $('branchBadge'),
  progressFill:       $('progressFill'),
  agentsRow:          $('agentsRow'),
  timelinePanel:      $('timelinePanel'),
  timelineBody:       $('timelineBody'),
  logFilters:         $('logFilters'),
  logBody:            $('logBody'),
  errorBanner:        $('errorBanner'),
  successBanner:      $('successBanner'),
  successTitle:       $('successTitle'),
  successDetail:      $('successDetail'),
  outputArea:         $('outputArea'),
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function detectLanguage(filepath) {
  const ext = filepath.split('.').pop().toLowerCase();
  const map = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    jsx: 'jsx', ts: 'typescript', tsx: 'jsx',
    py: 'python', go: 'go', json: 'json', css: 'css',
    html: 'markup', htm: 'markup', vue: 'markup', svelte: 'markup',
    md: 'markdown', yml: 'yaml', yaml: 'yaml',
    kt: 'kotlin', java: 'java', swift: 'swift',
    xml: 'markup', gradle: 'javascript',
  };
  return map[ext] || 'javascript';
}

// ── Project Management ────────────────────────────────────────────────────────

async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    state.projects = await res.json();
  } catch {
    state.projects = [];
  }
  renderProjectList();
}

function renderProjectList() {
  if (state.projects.length === 0) {
    dom.projectList.innerHTML = '<div class="project-empty">No projects added yet</div>';
    updateContextDisplay();
    return;
  }

  dom.projectList.innerHTML = state.projects.map(p => {
    const checked = state.selectedProjectIds.includes(p.id) ? 'checked' : '';
    return `
      <label class="project-list-item">
        <input type="checkbox" value="${escHtml(p.id)}" ${checked}>
        <span class="project-list-name">${escHtml(p.name)}</span>
        <span class="project-list-type">${escHtml(p.type || 'fullstack')}</span>
        <span class="project-list-path" title="${escHtml(p.path)}">${escHtml(shortenPath(p.path))}</span>
        <button class="project-list-remove" onclick="removeProject('${escHtml(p.id)}', event)" title="Remove">&times;</button>
      </label>
    `;
  }).join('');

  // Bind checkbox changes
  dom.projectList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.value;
      if (cb.checked) {
        if (!state.selectedProjectIds.includes(id)) state.selectedProjectIds.push(id);
      } else {
        state.selectedProjectIds = state.selectedProjectIds.filter(x => x !== id);
      }
      updateContextDisplay();
    });
  });

  updateContextDisplay();
}

function shortenPath(p) {
  const parts = p.split('/');
  if (parts.length <= 4) return p;
  return '.../' + parts.slice(-3).join('/');
}

function updateContextDisplay() {
  const count = state.selectedProjectIds.length;
  if (count === 0) {
    dom.contextText.textContent = 'No project selected';
    dom.contextIndicator.className = 'context-indicator';
  } else if (count === 1) {
    const proj = state.projects.find(p => p.id === state.selectedProjectIds[0]);
    dom.contextText.textContent = proj ? `${proj.name} (${proj.type})` : '1 project selected';
    dom.contextIndicator.className = 'context-indicator';
  } else {
    dom.contextText.textContent = `${count} projects selected`;
    dom.contextIndicator.className = 'context-indicator';
  }
}

// ── Add / Remove Projects ─────────────────────────────────────────────────────

function showAddForm() {
  dom.addProjectForm.classList.remove('hidden');
  dom.newProjectName.value = '';
  dom.newProjectPath.value = '';
  dom.newProjectType.value = 'fullstack';
  dom.dirSelected.textContent = 'No folder selected';
  dom.newProjectName.focus();
  browsePath(); // load home directory
}

function hideAddForm() {
  dom.addProjectForm.classList.add('hidden');
}

async function addProject() {
  const name = dom.newProjectName.value.trim();
  const projectPath = dom.newProjectPath.value.trim();
  const projectType = dom.newProjectType.value;
  if (!name || !projectPath) {
    alert('Please enter a name and select a project folder.');
    return;
  }

  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path: projectPath, type: projectType }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error);
      return;
    }
    const project = await res.json();
    state.projects.push(project);
    state.selectedProjectIds.push(project.id);
    renderProjectList();
    hideAddForm();
  } catch (e) {
    alert('Failed to add project: ' + e.message);
  }
}

window.removeProject = async function(id, event) {
  event?.preventDefault();
  event?.stopPropagation();
  const project = state.projects.find(p => p.id === id);
  if (!project) return;
  if (!confirm(`Remove "${project.name}" from saved projects?`)) return;

  try {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    state.projects = state.projects.filter(p => p.id !== id);
    state.selectedProjectIds = state.selectedProjectIds.filter(x => x !== id);
    renderProjectList();
  } catch (e) {
    alert('Failed to remove project: ' + e.message);
  }
};

// ── Directory Browser ─────────────────────────────────────────────────────────

async function browsePath(dirPath) {
  const url = dirPath ? `/api/browse?path=${encodeURIComponent(dirPath)}` : '/api/browse';
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json();
      alert(err.error);
      return;
    }
    const data = await res.json();
    renderBreadcrumb(data.current, data.parent);
    renderDirList(data.dirs, data.current);
  } catch (e) {
    console.error('Browse error:', e);
  }
}

function renderBreadcrumb(currentPath, parentPath) {
  const parts = currentPath.split('/').filter(Boolean);
  let crumbs = '';

  // Root crumb
  crumbs += `<span class="dir-crumb" onclick="browsePath('/')">/</span>`;

  // Each path segment
  let accumulated = '';
  for (let i = 0; i < parts.length; i++) {
    accumulated += '/' + parts[i];
    const isLast = i === parts.length - 1;
    if (isLast) {
      crumbs += `<span class="dir-crumb active">${escHtml(parts[i])}</span>`;
    } else {
      const p = accumulated;
      crumbs += `<span class="dir-crumb" onclick="browsePath('${escHtml(p)}')">${escHtml(parts[i])}</span>`;
    }
    if (!isLast) crumbs += '<span class="dir-sep">/</span>';
  }

  dom.dirBreadcrumb.innerHTML = crumbs;
}

function renderDirList(dirs, currentPath) {
  if (dirs.length === 0) {
    dom.dirList.innerHTML = '<div class="dir-empty" style="color:var(--muted);font-size:12px;padding:8px">No subfolders</div>';
    return;
  }

  dom.dirList.innerHTML = dirs.map(d => {
    const gitClass = d.isGitRepo ? ' git-repo' : '';
    const gitIcon = d.isGitRepo ? '<span class="dir-git-icon" title="Git repository">&#9679;</span>' : '';
    return `
      <div class="dir-item${gitClass}" onclick="dirItemClick('${escHtml(d.path)}', ${d.isGitRepo})">
        <span class="dir-folder-icon">&#128193;</span>
        <span class="dir-name">${escHtml(d.name)}</span>
        ${gitIcon}
      </div>
    `;
  }).join('');
}

window.dirItemClick = function(dirPath, isGitRepo) {
  if (isGitRepo) {
    selectDirPath(dirPath);
  }
  browsePath(dirPath);
};

function selectDirPath(dirPath) {
  dom.newProjectPath.value = dirPath;
  dom.dirSelected.textContent = 'Selected: ' + dirPath;
  dom.dirSelected.classList.add('has-selection');

  // Auto-fill name if empty
  if (!dom.newProjectName.value.trim()) {
    const name = dirPath.split('/').filter(Boolean).pop() || '';
    dom.newProjectName.value = name;
  }
}

// Expose browsePath globally for onclick
window.browsePath = browsePath;

// ── Agent Settings ────────────────────────────────────────────────────────────

function toggleSettings() {
  dom.settingsBody.classList.toggle('hidden');
  const open = !dom.settingsBody.classList.contains('hidden');
  dom.toggleArrow.innerHTML = open ? '&#9662;' : '&#9656;';
}

function getAgentConfig() {
  const config = {};
  document.querySelectorAll('.setting-row').forEach(row => {
    const agentId = row.dataset.agent;
    const checkbox = row.querySelector('input[type="checkbox"]');
    const instrInput = row.querySelector('.setting-instr');
    config[agentId] = {
      enabled: checkbox?.checked ?? true,
      instructions: instrInput?.value?.trim() || '',
    };
  });
  return config;
}

// QA group toggle — syncs master checkbox with QA #1 and QA #2
function initQAGroupToggle() {
  const groupToggle = $('qaGroupToggle');
  if (!groupToggle) return;

  const qaRows = document.querySelectorAll('.setting-row.qa-child');
  const qaCheckboxes = Array.from(qaRows).map(r => r.querySelector('input[type="checkbox"]'));

  // Master toggle → set both children
  groupToggle.addEventListener('change', () => {
    qaCheckboxes.forEach(cb => { if (cb) cb.checked = groupToggle.checked; });
  });

  // Child toggle → update master (all checked = checked, any unchecked = unchecked)
  qaCheckboxes.forEach(cb => {
    if (!cb) return;
    cb.addEventListener('change', () => {
      groupToggle.checked = qaCheckboxes.every(c => c?.checked);
      groupToggle.indeterminate = !groupToggle.checked && qaCheckboxes.some(c => c?.checked);
    });
  });
}

// ── Agent Cards ───────────────────────────────────────────────────────────────

const AGENTS = [
  { id: 'enhance', label: 'Enhancer' },
  { id: 'pm',      label: 'PM Agent' },
  { id: 'arch',    label: 'Architect' },
  { id: 'repo',    label: 'Repo Agent' },
  { id: 'review',  label: 'PR Review' },
  { id: 'qa1',     label: 'QA #1' },
  { id: 'qa2',     label: 'QA #2' },
  { id: 'git',     label: 'Git' },
];

function renderAgentCards() {
  dom.agentsRow.innerHTML = AGENTS.map(a => `
    <div class="agent-card" id="card-${a.id}" onclick="toggleAgentExpand('${a.id}')">
      <div class="agent-top">
        <div class="agent-label">${a.label}</div>
        <div class="status-dot" id="dot-${a.id}"></div>
      </div>
      <div class="agent-msg" id="msg-${a.id}">Idle</div>
      <div class="agent-details" id="details-${a.id}"></div>
    </div>
  `).join('');
}

function setAgent(id, status, msg) {
  const card = $(`card-${id}`);
  const dot  = $(`dot-${id}`);
  const msgEl = $(`msg-${id}`);
  if (!card) return;
  card.className = `agent-card ${status}` + (card.classList.contains('expanded') ? ' expanded' : '');
  dot.className  = `status-dot ${status}`;
  if (msg) msgEl.textContent = msg;
}

function toggleAgentExpand(id) {
  const card = $(`card-${id}`);
  const details = $(`details-${id}`);
  card.classList.toggle('expanded');

  const agentState = state.agentStatuses[id];
  if (!agentState?.payload) {
    details.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:4px 0">No data yet</div>';
    return;
  }

  const renderers = {
    enhance: renderEnhanceDetails,
    pm:      renderPMDetails,
    arch:    renderArchDetails,
    repo:    renderRepoDetails,
    review:  renderReviewDetails,
    qa1:     (p) => renderQADetails(p, 'QA #1'),
    qa2:     (p) => renderQADetails(p, 'QA #2'),
    git:     renderGitDetails,
  };

  const renderer = renderers[id];
  if (renderer) details.innerHTML = renderer(agentState.payload);
}

function renderEnhanceDetails(payload) {
  const ticket = payload.enhanced_ticket || '';
  const preview = ticket.length > 600 ? ticket.slice(0, 600) + '...' : ticket;
  return `
    <div class="detail-section">
      <div class="detail-label">Enhanced Ticket</div>
      <div class="detail-value" style="white-space:pre-wrap;word-break:break-word;font-size:11px;line-height:1.5">${escHtml(preview)}</div>
    </div>
  `;
}

function renderPMDetails(plan) {
  const subtasks = (plan.subtasks || []).map(s => `
    <div class="subtask">
      <div class="subtask-header">
        <span class="subtask-id">${escHtml(s.id)}</span>
        <span class="subtask-title">${escHtml(s.title)}</span>
      </div>
      <div class="subtask-meta">
        ${s.risk ? `<span class="risk-badge ${s.risk}">${s.risk}</span>` : ''}
        ${s.estimation ? `<span class="est-badge">${s.estimation}</span>` : ''}
        ${s.area ? `<span class="est-badge">${s.area}</span>` : ''}
      </div>
      ${s.description ? `<div class="subtask-desc">${escHtml(s.description)}</div>` : ''}
    </div>
  `).join('');
  return `
    <div class="detail-section"><div class="detail-label">Summary</div><div class="detail-value">${escHtml(plan.summary || '')}</div></div>
    <div class="detail-section"><div class="detail-label">Type</div><div class="detail-value">${escHtml(plan.type || '')}</div></div>
    <div class="detail-section"><div class="detail-label">Subtasks</div>${subtasks || '<div class="detail-value" style="color:var(--muted)">None</div>'}</div>
  `;
}

function renderArchDetails(arch) {
  const files = (arch.file_changes || [])
    .sort((a, b) => (a.priority || 99) - (b.priority || 99))
    .map(f => `
      <div class="file-item">
        <span class="file-action ${f.action}">${f.action}</span>
        <span class="file-path">${escHtml(f.path)}</span>
        ${f.project ? `<span class="est-badge">${escHtml(f.project)}</span>` : ''}
        ${f.priority ? `<span class="file-priority">#${f.priority}</span>` : ''}
      </div>
    `).join('');
  return `
    <div class="detail-section"><div class="detail-label">Analysis</div><div class="detail-value">${escHtml(arch.analysis || '')}</div></div>
    <div class="detail-section"><div class="detail-label">Files</div>${files || '<div class="detail-value" style="color:var(--muted)">None</div>'}</div>
  `;
}

function renderRepoDetails(repo) {
  const files = (repo.files || []).map(f => `<div class="file-item"><span class="file-action create">write</span><span class="file-path">${escHtml(f)}</span></div>`).join('');
  return `
    <div class="detail-section"><div class="detail-label">Commit</div><div class="detail-value" style="font-family:'Geist Mono',monospace;font-size:11px">${escHtml(repo.commit_message || '')}</div></div>
    <div class="detail-section"><div class="detail-label">Files</div>${files || '<div class="detail-value" style="color:var(--muted)">None</div>'}</div>
  `;
}

function renderReviewDetails(payload) {
  const verdict = payload.verdict || 'unknown';
  const verdictClass = verdict === 'approve' ? 'approve' : 'request-changes';
  const verdictLabel = verdict === 'approve' ? 'Approved' : 'Changes Requested';
  const issues = (payload.issues || []).slice(0, 10);
  const summary = payload.summary || '';
  const fixedCount = payload.fixed_count || 0;

  const issueHtml = issues.length > 0
    ? issues.map(iss => `
        <div class="qa-issue">
          <div class="qa-issue-header">
            <span class="severity-badge ${iss.severity || 'minor'}">${iss.severity || 'minor'}</span>
            <span class="category-badge">${escHtml(iss.category || '')}</span>
            <span class="qa-issue-file">${escHtml(iss.file || '')}</span>
          </div>
          <div class="qa-issue-desc">${escHtml(iss.description || '')}</div>
        </div>
      `).join('')
    : '<div style="color:var(--muted);font-size:11px">No issues found</div>';

  return `
    <div class="detail-section">
      <div class="detail-label">Verdict</div>
      <div class="detail-value"><span class="verdict-badge ${verdictClass}">${verdictLabel}</span></div>
    </div>
    <div class="detail-section"><div class="detail-label">Summary</div><div class="detail-value">${escHtml(summary)}</div></div>
    <div class="detail-section"><div class="detail-label">Files Fixed</div><div class="detail-value">${fixedCount} file(s)</div></div>
    <div class="detail-section"><div class="detail-label">Issues (${issues.length})</div>${issueHtml}</div>
  `;
}

function renderQADetails(payload, label) {
  const issues = (payload.issues || []).slice(0, 10);
  const summary = payload.summary || '';
  const fixedCount = payload.fixed_count || 0;

  const issueHtml = issues.length > 0
    ? issues.map(iss => `
        <div class="qa-issue">
          <div class="qa-issue-header">
            <span class="severity-badge ${iss.severity || 'minor'}">${iss.severity || 'minor'}</span>
            <span class="category-badge">${iss.category || ''}</span>
            <span class="qa-issue-file">${escHtml(iss.file || '')}</span>
          </div>
          <div class="qa-issue-desc">${escHtml(iss.description || '')}</div>
        </div>
      `).join('')
    : '<div style="color:var(--muted);font-size:11px">No issues found</div>';

  return `
    <div class="detail-section"><div class="detail-label">${label} Summary</div><div class="detail-value">${escHtml(summary)}</div></div>
    <div class="detail-section"><div class="detail-label">Files Fixed</div><div class="detail-value">${fixedCount} file(s)</div></div>
    <div class="detail-section"><div class="detail-label">Issues (${issues.length})</div>${issueHtml}</div>
  `;
}

function renderGitDetails(git) {
  const projectResults = git.projects || [];
  if (projectResults.length <= 1) {
    const branch = projectResults[0]?.branch || git.branch || '';
    const files = projectResults[0]?.files || git.files || [];
    return `
      <div class="detail-section"><div class="detail-label">Branch</div><div class="detail-value" style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--green)">${escHtml(branch)}</div></div>
      <div class="detail-section"><div class="detail-label">Files committed</div><div class="detail-value">${files.length} file(s)</div></div>
    `;
  }

  const projHtml = projectResults.map(pr => `
    <div class="detail-section" style="margin-left:8px">
      <div class="detail-label">${escHtml(pr.name)}</div>
      <div class="detail-value" style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--green)">${escHtml(pr.branch)} &mdash; ${pr.files?.length || 0} file(s)</div>
    </div>
  `).join('');

  return `<div class="detail-section"><div class="detail-label">Projects</div>${projHtml}</div>`;
}

// ── Decision Timeline ─────────────────────────────────────────────────────────

function addTimelineEvent(agentId, title, detail) {
  dom.timelinePanel.classList.remove('hidden');
  const item = document.createElement('div');
  item.className = `timeline-item ${agentId} fadein`;
  item.innerHTML = `<div><div class="timeline-title">${escHtml(title)}</div><div class="timeline-detail">${escHtml(detail)}</div></div>`;
  dom.timelineBody.appendChild(item);
}

// ── Log Panel ─────────────────────────────────────────────────────────────────

const TAG_NAMES = {
  enhance: '[enhance]',
  pm:      '[pm]    ',
  arch:    '[arch]  ',
  repo:    '[repo]  ',
  review:  '[review]',
  qa1:     '[qa1]   ',
  qa2:     '[qa2]   ',
  git:     '[git]   ',
};

function addLogEntry(agentId, msg, isErr = false) {
  state.logEntries.push({ agentId, msg, isErr, timestamp: Date.now() });
  renderLogEntries();
}

function renderLogEntries() {
  const filtered = state.currentFilter === 'all'
    ? state.logEntries
    : state.logEntries.filter(e => e.agentId === state.currentFilter);

  dom.logBody.innerHTML = filtered.map(e => `
    <div class="log-line fadein">
      <span class="log-tag ${e.agentId}">${TAG_NAMES[e.agentId] || `[${e.agentId}]`}</span>
      <span class="${e.isErr ? 'log-err' : 'log-msg'}">${escHtml(e.msg)}</span>
    </div>
  `).join('');

  dom.logBody.scrollTop = dom.logBody.scrollHeight;
}

// ── Output Rendering ──────────────────────────────────────────────────────────

function renderOutputs() {
  const plan = state.plan;
  const archPlan = state.archPlan;
  const repoPayload = state.repoPayload;
  const reviewPayload = state.reviewPayload;
  const qa1 = state.qa1Payload;
  const qa2 = state.qa2Payload;

  // Enhanced ticket
  let enhancedHtml = '';
  if (state.enhancedTicket) {
    const preview = state.enhancedTicket.length > 1500
      ? state.enhancedTicket.slice(0, 1500) + '\n\n... (truncated)'
      : state.enhancedTicket;
    enhancedHtml = `
      <div class="output-card" style="grid-column:1/-1">
        <div class="output-card-header">Enhanced Ticket</div>
        <div class="output-card-body"><div class="enhanced-ticket-preview">${escHtml(preview)}</div></div>
      </div>
    `;
  }

  // Subtasks
  const subtasksHtml = (plan?.subtasks || []).map(s => `
    <div class="subtask">
      <div class="subtask-header">
        <span class="subtask-id">${escHtml(s.id)}</span>
        <span class="subtask-title">${escHtml(s.title)}</span>
      </div>
      <div class="subtask-meta">
        ${s.risk ? `<span class="risk-badge ${s.risk}">${s.risk}</span>` : ''}
        ${s.estimation ? `<span class="est-badge">${s.estimation}</span>` : ''}
      </div>
      <div class="subtask-desc">${escHtml(s.description || '')}</div>
    </div>
  `).join('');

  // Files
  const filesHtml = (archPlan?.file_changes || [])
    .sort((a, b) => (a.priority || 99) - (b.priority || 99))
    .map(f => `
      <div class="file-item">
        <span class="file-action ${f.action}">${f.action}</span>
        <span class="file-path">${escHtml(f.path)}</span>
        ${f.project ? `<span class="est-badge">${escHtml(f.project)}</span>` : ''}
        ${f.priority ? `<span class="file-priority">#${f.priority}</span>` : ''}
      </div>
    `).join('');

  // PR Review issues
  let reviewHtml = '';
  const reviewIssues = reviewPayload?.issues || [];
  if (reviewIssues.length > 0) {
    const verdictClass = reviewPayload?.verdict === 'approve' ? 'approve' : 'request-changes';
    const verdictLabel = reviewPayload?.verdict === 'approve' ? 'Approved' : 'Changes Requested';
    const issueRows = reviewIssues.map(iss => `
      <div class="qa-issue">
        <div class="qa-issue-header">
          <span class="severity-badge ${iss.severity || 'minor'}">${iss.severity || 'minor'}</span>
          <span class="category-badge">${escHtml(iss.category || '')}</span>
          <span class="qa-issue-file">${escHtml(iss.file || '')}</span>
        </div>
        <div class="qa-issue-desc">${escHtml(iss.description || '')}</div>
        ${iss.fix ? `<div class="qa-issue-fix">${escHtml(iss.fix)}</div>` : ''}
      </div>
    `).join('');

    reviewHtml = `
      <div class="output-card" style="grid-column:1/-1">
        <div class="output-card-header">
          PR Review
          <span class="verdict-badge ${verdictClass}">${verdictLabel}</span>
          <span class="qa-count">${reviewIssues.length}</span>
        </div>
        <div class="output-card-body">
          ${reviewPayload?.summary ? `<div style="color:var(--muted);font-size:11px;margin-bottom:10px">${escHtml(reviewPayload.summary)}</div>` : ''}
          ${issueRows}
        </div>
      </div>
    `;
  }

  // QA issues summary
  let qaHtml = '';
  const qa1Issues = qa1?.issues || [];
  const qa2Issues = qa2?.issues || [];
  if (qa1Issues.length > 0 || qa2Issues.length > 0) {
    const allIssues = [
      ...qa1Issues.map(i => ({ ...i, source: 'QA #1' })),
      ...qa2Issues.map(i => ({ ...i, source: 'QA #2' })),
    ];
    const issueRows = allIssues.map(iss => `
      <div class="qa-issue">
        <div class="qa-issue-header">
          <span class="severity-badge ${iss.severity || 'minor'}">${iss.severity || 'minor'}</span>
          <span class="category-badge">${iss.category || ''}</span>
          <span class="qa-issue-file">${escHtml(iss.file || '')}</span>
          <span style="font-size:9px;color:var(--muted)">${iss.source}</span>
        </div>
        <div class="qa-issue-desc">${escHtml(iss.description || '')}</div>
        ${iss.fix ? `<div class="qa-issue-fix">${escHtml(iss.fix)}</div>` : ''}
      </div>
    `).join('');

    qaHtml = `
      <div class="output-card" style="grid-column:1/-1">
        <div class="output-card-header">
          QA Review &mdash; Issues Found &amp; Fixed
          <span class="qa-count">${allIssues.length}</span>
        </div>
        <div class="output-card-body">${issueRows}</div>
      </div>
    `;
  }

  // Final code — cascade: qa2 > qa1 > review > repo
  const finalFiles = qa2?.file_contents || qa1?.file_contents || reviewPayload?.file_contents || repoPayload?.file_contents || {};
  const finalTests = qa2?.tests || qa1?.tests || reviewPayload?.tests || repoPayload?.tests || {};

  let codeHtml = '';
  if (Object.keys(finalFiles).length > 0) {
    codeHtml = `
      <div class="output-card" style="grid-column:1/-1">
        <div class="output-card-header">Final Code (after all reviews)</div>
        <div class="output-card-body" style="max-height:none;padding:0">
          <div class="code-previews">
            ${Object.entries(finalFiles).map(([filepath, content]) => {
              const lang = detectLanguage(filepath);
              let highlighted;
              try {
                highlighted = Prism.highlight(content, Prism.languages[lang] || Prism.languages.javascript, lang);
              } catch {
                highlighted = escHtml(content);
              }
              return `
                <div class="code-preview">
                  <div class="code-preview-header">
                    <span class="code-preview-filename">${escHtml(filepath)}</span>
                    <button class="code-preview-copy" onclick="copyCode(this, '${escHtml(filepath).replace(/'/g, "\\'")}')">Copy</button>
                  </div>
                  <div class="code-preview-body">
                    <pre class="language-${lang}"><code>${highlighted}</code></pre>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  // Tests
  let testHtml = '';
  if (Object.keys(finalTests).length > 0) {
    testHtml = `
      <div class="output-card" style="grid-column:1/-1">
        <div class="output-card-header">Final Tests (after all reviews)</div>
        <div class="output-card-body" style="max-height:none;padding:0">
          <div class="code-previews">
            ${Object.entries(finalTests).map(([filepath, content]) => {
              const lang = detectLanguage(filepath);
              let highlighted;
              try {
                highlighted = Prism.highlight(content, Prism.languages[lang] || Prism.languages.javascript, lang);
              } catch {
                highlighted = escHtml(content);
              }
              return `
                <div class="code-preview">
                  <div class="code-preview-header">
                    <span class="code-preview-filename">${escHtml(filepath)}</span>
                    <button class="code-preview-copy" onclick="copyCode(this, '${escHtml(filepath).replace(/'/g, "\\'")}')">Copy</button>
                  </div>
                  <div class="code-preview-body">
                    <pre class="language-${lang}"><code>${highlighted}</code></pre>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  dom.outputArea.innerHTML = `
    <div class="output-grid fadein">
      ${enhancedHtml}
      <div class="output-row">
        <div class="output-card">
          <div class="output-card-header">PM Plan &mdash; Subtasks</div>
          <div class="output-card-body">${subtasksHtml || '<span style="color:var(--muted)">No subtasks</span>'}</div>
        </div>
        <div class="output-card">
          <div class="output-card-header">Architecture &mdash; File Changes</div>
          <div class="output-card-body">
            ${archPlan?.analysis ? `<div style="color:var(--muted);font-size:11px;margin-bottom:10px">${escHtml(archPlan.analysis)}</div>` : ''}
            ${filesHtml || '<span style="color:var(--muted)">No files</span>'}
          </div>
        </div>
      </div>
      ${reviewHtml}
      ${qaHtml}
      ${codeHtml}
      ${testHtml}
    </div>
  `;
}

// ── Copy Code ─────────────────────────────────────────────────────────────────

window.copyCode = function(btn, filepath) {
  const qa2Files = state.qa2Payload?.file_contents || {};
  const qa2Tests = state.qa2Payload?.tests || {};
  const qa1Files = state.qa1Payload?.file_contents || {};
  const qa1Tests = state.qa1Payload?.tests || {};
  const reviewFiles = state.reviewPayload?.file_contents || {};
  const reviewTests = state.reviewPayload?.tests || {};
  const repoFiles = state.repoPayload?.file_contents || {};
  const repoTests = state.repoPayload?.tests || {};

  // Cascade: later agents override earlier ones
  const allFiles = { ...repoFiles, ...repoTests, ...reviewFiles, ...reviewTests, ...qa1Files, ...qa1Tests, ...qa2Files, ...qa2Tests };
  const content = allFiles[filepath];
  if (content) {
    navigator.clipboard.writeText(content).then(() => {
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
  }
};

// ── Progress ──────────────────────────────────────────────────────────────────

const PROGRESS_MAP = {
  enhance: 8,
  pm:      18,
  arch:    32,
  repo:    48,
  review:  58,
  qa1:     70,
  qa2:     82,
  git:     95,
};

function updateProgress(agentId, done = false) {
  const pct = done ? 100 : (PROGRESS_MAP[agentId] || 0);
  dom.progressFill.style.width = pct + '%';
}

// ── Banners ───────────────────────────────────────────────────────────────────

function showErrorBanner(msg) {
  dom.errorBanner.textContent = msg;
  dom.errorBanner.classList.add('visible');
}

function showSuccessBanner(branch, files, commit, projectResults) {
  dom.successTitle.textContent = 'Pipeline complete';
  let detail = `Branch: ${escHtml(branch)}<br>${files?.length || 0} file(s) committed<br>Commit: ${escHtml(commit || '')}`;
  if (projectResults && projectResults.length > 1) {
    detail += '<br>Projects: ' + projectResults.map(p => escHtml(p.name)).join(', ');
  }
  dom.successDetail.innerHTML = detail;
  dom.successBanner.classList.add('visible');
}

function hideBanners() {
  dom.errorBanner.classList.remove('visible');
  dom.successBanner.classList.remove('visible');
}

// ── SSE Event Handler ─────────────────────────────────────────────────────────

function handleSSEEvent(evt) {
  switch (evt.type) {
    case 'agent': {
      const doneMessages = {
        enhance: 'Done \u2014 ticket enhanced',
        pm:      `Done \u2014 ${evt.payload?.subtasks?.length || 0} subtasks`,
        arch:    `Done \u2014 ${evt.payload?.file_changes?.length || 0} files mapped`,
        repo:    `Done \u2014 ${evt.payload?.files?.length || 0} files written`,
        review:  `Done \u2014 ${evt.payload?.verdict === 'approve' ? 'Approved' : 'Changes'}, ${evt.payload?.issues?.length || 0} issues`,
        qa1:     `Done \u2014 ${evt.payload?.issues?.length || 0} issues, ${evt.payload?.fixed_count || 0} fixed`,
        qa2:     `Done \u2014 ${evt.payload?.issues?.length || 0} issues, ${evt.payload?.fixed_count || 0} fixed`,
        git:     'Committed locally',
      };
      setAgent(evt.id, evt.status, evt.status === 'done' ? doneMessages[evt.id] : evt.msg);
      state.agentStatuses[evt.id] = { status: evt.status, msg: evt.msg, payload: evt.payload };

      if (evt.status === 'error') {
        updateProgress(evt.id);
        addTimelineEvent(evt.id, 'Error', evt.msg || 'Agent failed');
      }

      if (evt.status === 'done') {
        updateProgress(evt.id);

        if (evt.id === 'enhance') {
          state.enhancedTicket = evt.payload?.enhanced_ticket;
          addTimelineEvent('enhance', 'Ticket enhanced', `${(evt.payload?.enhanced_ticket || '').length} chars of detailed spec`);
        }
        if (evt.id === 'pm') {
          state.plan = evt.payload;
          addTimelineEvent('pm', 'Plan created', `${evt.payload.subtasks?.length || 0} subtasks, type: ${evt.payload.type}`);
        }
        if (evt.id === 'arch') {
          state.archPlan = evt.payload;
          addTimelineEvent('arch', 'Architecture decided', `${evt.payload.file_changes?.length || 0} files, branch: ${evt.payload.branch_name}`);
        }
        if (evt.id === 'repo') {
          state.repoPayload = evt.payload;
          addTimelineEvent('repo', 'Code generated', `${evt.payload.files?.length || 0} files written`);
          renderOutputs();
        }
        if (evt.id === 'review') {
          state.reviewPayload = evt.payload;
          const verdict = evt.payload?.verdict === 'approve' ? 'Approved' : 'Changes requested';
          const issueCount = evt.payload?.issues?.length || 0;
          addTimelineEvent('review', `PR Review \u2014 ${verdict}`, `${issueCount} issues, ${evt.payload?.fixed_count || 0} files improved`);
          renderOutputs();
        }
        if (evt.id === 'qa1') {
          state.qa1Payload = evt.payload;
          const issueCount = evt.payload?.issues?.length || 0;
          const fixedCount = evt.payload?.fixed_count || 0;
          addTimelineEvent('qa1', 'QA #1 reviewed', `${issueCount} issues found, ${fixedCount} files fixed`);
          renderOutputs();
        }
        if (evt.id === 'qa2') {
          state.qa2Payload = evt.payload;
          const issueCount = evt.payload?.issues?.length || 0;
          const fixedCount = evt.payload?.fixed_count || 0;
          addTimelineEvent('qa2', 'QA #2 reviewed', `${issueCount} issues found, ${fixedCount} files improved`);
          renderOutputs();
        }
        if (evt.id === 'git') {
          const projectResults = evt.payload?.projects || [];
          if (projectResults.length > 1) {
            addTimelineEvent('git', 'Committed to repos', projectResults.map(p => `${p.name}: ${p.branch}`).join(', '));
          } else {
            addTimelineEvent('git', 'Committed', `Branch: ${projectResults[0]?.branch || ''}`);
          }
        }
      }
      if (evt.status === 'running') {
        updateProgress(evt.id);
      }
      break;
    }

    case 'log':
      addLogEntry(evt.id, evt.msg);
      break;

    case 'context': {
      const projects = evt.projects || [];
      if (projects.length === 1) {
        const p = projects[0];
        dom.contextIndicator.className = p.generated ? 'context-indicator generated' : 'context-indicator has-context';
        dom.contextText.textContent = p.generated ? `${p.name}: CLAUDE.md auto-generated` : `${p.name}: CLAUDE.md loaded`;
      } else if (projects.length > 1) {
        const allLoaded = projects.every(p => !p.generated);
        dom.contextIndicator.className = allLoaded ? 'context-indicator has-context' : 'context-indicator generated';
        dom.contextText.textContent = `${projects.length} projects: CLAUDE.md loaded`;
      }
      break;
    }

    case 'error':
      addLogEntry('git', evt.msg, true);
      setAgent('git', 'error', 'Error');
      showErrorBanner(evt.msg);
      break;

    case 'done':
      updateProgress('git', true);
      dom.pipelineStatus.textContent = `Done \u2014 branch: ${evt.branch}`;
      dom.branchBadge.textContent = evt.branch;
      dom.branchBadge.classList.add('visible');
      addLogEntry('git', `Done! Branch: ${evt.branch} \u2014 ${evt.files?.length || 0} file(s) committed`);
      showSuccessBanner(evt.branch, evt.files, evt.commit, evt.projects);
      break;
  }
}

// ── Pipeline Execution ────────────────────────────────────────────────────────

function resetUI() {
  state.logEntries = [];
  state.enhancedTicket = null;
  state.plan = null;
  state.archPlan = null;
  state.repoPayload = null;
  state.reviewPayload = null;
  state.qa1Payload = null;
  state.qa2Payload = null;
  state.agentStatuses = {};
  dom.progressFill.style.width = '0%';
  dom.logBody.innerHTML = '';
  dom.timelineBody.innerHTML = '';
  dom.timelinePanel.classList.add('hidden');
  dom.branchBadge.classList.remove('visible');
  dom.outputArea.innerHTML = '';
  hideBanners();
  renderAgentCards();
  AGENTS.forEach(a => setAgent(a.id, '', 'Idle'));
  dom.pipelineStatus.textContent = 'Pipeline running...';
  dom.runBtn.disabled = true;
  dom.runBtn.innerHTML = '<div class="spinner"></div> Running 8 agents...';
}

function resetRunButton() {
  dom.runBtn.disabled = false;
  dom.runBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M3 2L13 7.5L3 13V2Z" fill="currentColor"/></svg> Run engineering team';
}

async function runPipeline() {
  if (state.running) return;

  const ticket = dom.ticket.value.trim();
  if (!ticket) { alert('Please paste a ticket first.'); return; }

  // Gather selected projects
  const selectedProjects = state.projects.filter(p => state.selectedProjectIds.includes(p.id));
  if (selectedProjects.length === 0) { alert('Please select at least one project.'); return; }

  const projects = selectedProjects.map(p => ({
    path: p.path,
    type: p.type || 'fullstack',
    name: p.name,
  }));

  const agentConfig = getAgentConfig();

  state.running = true;
  resetUI();

  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket, projects, agentConfig }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let parsed;
        try { parsed = JSON.parse(line.slice(6)); } catch { continue; }
        handleSSEEvent(parsed);
      }
    }
  } catch (err) {
    addLogEntry('git', `Fatal: ${err.message}`, true);
    showErrorBanner(`Fatal: ${err.message}`);
    dom.pipelineStatus.textContent = 'Error \u2014 see log';
  } finally {
    state.running = false;
    resetRunButton();
  }
}

// ── Event Listeners ───────────────────────────────────────────────────────────

dom.addProjectBtn.addEventListener('click', showAddForm);
dom.cancelAddProject.addEventListener('click', hideAddForm);
dom.confirmAddProject.addEventListener('click', addProject);
dom.runBtn.addEventListener('click', runPipeline);
dom.settingsToggle.addEventListener('click', toggleSettings);

// Log filter
dom.logFilters.addEventListener('click', (e) => {
  if (!e.target.classList.contains('log-filter')) return;
  document.querySelectorAll('.log-filter').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  state.currentFilter = e.target.dataset.filter;
  renderLogEntries();
});

// Enter key on add project name
dom.newProjectName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addProject();
});

// Expose for onclick in HTML
window.toggleAgentExpand = toggleAgentExpand;

// ── Init ──────────────────────────────────────────────────────────────────────

renderAgentCards();
loadProjects();
initQAGroupToggle();
