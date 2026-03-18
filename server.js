import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { execFileSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PROJECTS_FILE = path.join(__dirname, 'projects.json');
const PROMPTS_DIR = path.join(__dirname, 'prompts');

// ── Logger ────────────────────────────────────────────────────────────────────

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${label}] ${msg}`);
}

// ── Prompt Loader ─────────────────────────────────────────────────────────────

const promptCache = {};

async function loadPrompt(name) {
  if (promptCache[name]) return promptCache[name];
  const content = await fs.readFile(path.join(PROMPTS_DIR, `${name}.txt`), 'utf-8');
  promptCache[name] = content.trim();
  log('PROMPT', `Loaded prompt: ${name} (${content.length} chars)`);
  return promptCache[name];
}

// ── Projects Store ────────────────────────────────────────────────────────────

async function loadProjects() {
  try {
    const data = await fs.readFile(PROJECTS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveProjects(projects) {
  await fs.writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf-8');
}

// ── Local Filesystem Helpers ──────────────────────────────────────────────────

const IGNORE = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', '.cache',
  'coverage', '.idea', '.vscode', '__pycache__', '.DS_Store', 'vendor',
  '.turbo', '.parcel-cache', '.svelte-kit', 'target', 'out', 'Pods',
  '.gradle', '.kotlin', 'DerivedData', 'xcuserdata',
]);

async function getLocalFileTree(projectPath) {
  const entries = [];
  const MAX_ENTRIES = 2000;

  async function recurse(dir, depth) {
    if (depth > 5 || entries.length >= MAX_ENTRIES) return;
    let items;
    try { items = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const item of items) {
      if (entries.length >= MAX_ENTRIES) return;
      if (IGNORE.has(item.name) || item.name.startsWith('.')) continue;
      const fullPath = path.join(dir, item.name);
      const relPath = path.relative(projectPath, fullPath);
      if (item.isDirectory()) {
        entries.push(relPath + '/');
        await recurse(fullPath, depth + 1);
      } else {
        entries.push(relPath);
      }
    }
  }
  await recurse(projectPath, 0);
  return entries;
}

async function readLocalFile(projectPath, filePath) {
  const full = path.resolve(projectPath, filePath);
  if (!full.startsWith(path.resolve(projectPath))) {
    throw new Error(`Path traversal blocked: ${filePath}`);
  }
  return fs.readFile(full, 'utf-8');
}

// ── CLAUDE.md Support ─────────────────────────────────────────────────────────

async function readClaudeMd(projectPath) {
  try {
    return await fs.readFile(path.join(projectPath, 'CLAUDE.md'), 'utf-8');
  } catch {
    return null;
  }
}

async function generateClaudeMd(projectPath, fileTree) {
  const sections = [];
  const projectName = path.basename(projectPath);
  sections.push(`# ${projectName}\n`);

  const stack = [];
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (allDeps['react'])        stack.push('React');
    if (allDeps['next'])         stack.push('Next.js');
    if (allDeps['vue'])          stack.push('Vue');
    if (allDeps['nuxt'])         stack.push('Nuxt');
    if (allDeps['svelte'])       stack.push('Svelte');
    if (allDeps['express'])      stack.push('Express');
    if (allDeps['fastify'])      stack.push('Fastify');
    if (allDeps['nestjs'] || allDeps['@nestjs/core']) stack.push('NestJS');
    if (allDeps['typescript'] || fileTree.some(f => f.endsWith('.ts') || f.endsWith('.tsx'))) stack.push('TypeScript');
    if (allDeps['tailwindcss'])  stack.push('Tailwind CSS');
    if (allDeps['prisma'] || allDeps['@prisma/client']) stack.push('Prisma');
    if (allDeps['mongoose'])     stack.push('Mongoose');
    if (allDeps['jest'])         stack.push('Jest');
    if (allDeps['vitest'])       stack.push('Vitest');
    if (allDeps['mocha'])        stack.push('Mocha');
    if (allDeps['playwright'])   stack.push('Playwright');
    if (allDeps['cypress'])      stack.push('Cypress');
  } catch {}

  if (fileTree.some(f => f === 'requirements.txt' || f === 'pyproject.toml' || f === 'Pipfile')) stack.push('Python');
  if (fileTree.some(f => f === 'go.mod'))    stack.push('Go');
  if (fileTree.some(f => f === 'Cargo.toml')) stack.push('Rust');
  if (fileTree.some(f => f === 'Gemfile'))    stack.push('Ruby');
  if (fileTree.some(f => f.endsWith('.swift') || f === 'Package.swift')) stack.push('Swift');
  if (fileTree.some(f => f.endsWith('.xcodeproj/') || f.endsWith('.xcworkspace/'))) stack.push('Xcode');
  if (fileTree.some(f => f.endsWith('.kt') || f.endsWith('.kts'))) stack.push('Kotlin');

  if (stack.length) sections.push(`## Tech Stack\n${stack.join(', ')}\n`);

  const topDirs = [...new Set(fileTree.filter(f => f.includes('/') && !f.startsWith('.')).map(f => f.split('/')[0]))].sort();
  if (topDirs.length) sections.push(`## File Structure\n${topDirs.map(d => `- ${d}/`).join('\n')}\n`);

  const testFiles = fileTree.filter(f => /(\/__tests__\/|\/test\/|\/tests\/|\/spec\/|\.test\.|\.spec\.|Tests\.swift|Test\.kt)/.test(f));
  if (testFiles.length) {
    const patterns = [...new Set(testFiles.map(f => {
      if (f.includes('.test.')) return '*.test.*';
      if (f.includes('.spec.')) return '*.spec.*';
      if (f.includes('__tests__')) return '__tests__/';
      if (f.endsWith('Tests.swift')) return '*Tests.swift';
      if (f.endsWith('Test.kt')) return '*Test.kt';
      return 'test/';
    }))];
    sections.push(`## Testing\nTest pattern(s): ${patterns.join(', ')}\n${testFiles.length} test file(s) found.\n`);
  }

  const conventions = [];
  if (fileTree.some(f => f.includes('tsconfig'))) conventions.push('TypeScript (check tsconfig.json)');
  if (fileTree.some(f => f.includes('.eslintrc') || f.includes('eslint.config'))) conventions.push('ESLint configured');
  if (fileTree.some(f => f.includes('.prettierrc') || f.includes('prettier.config'))) conventions.push('Prettier configured');
  if (fileTree.some(f => f.includes('biome'))) conventions.push('Biome configured');
  if (fileTree.some(f => f.includes('.swiftlint'))) conventions.push('SwiftLint configured');
  if (fileTree.some(f => f.includes('ktlint') || f.includes('detekt'))) conventions.push('Kotlin lint configured');
  if (conventions.length) sections.push(`## Conventions\n${conventions.map(c => `- ${c}`).join('\n')}\n`);

  const content = sections.join('\n');
  await fs.writeFile(path.join(projectPath, 'CLAUDE.md'), content, 'utf-8');
  log('CTX', `Generated CLAUDE.md (${content.length} chars)`);
  return content;
}

async function getProjectContext(projectPath, fileTree) {
  let claudeMd = await readClaudeMd(projectPath);
  let generated = false;
  if (!claudeMd) {
    log('CTX', 'No CLAUDE.md found — generating...');
    claudeMd = await generateClaudeMd(projectPath, fileTree);
    generated = true;
  } else {
    log('CTX', `Read existing CLAUDE.md (${claudeMd.length} chars)`);
  }
  return { claudeMd, generated };
}

// ── Git Helpers ───────────────────────────────────────────────────────────────

function gitExec(projectPath, args) {
  log('GIT', `git ${args.join(' ')}`);
  return execFileSync('git', args, {
    cwd: projectPath,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

async function validateGitRepo(projectPath) {
  try {
    gitExec(projectPath, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    throw new Error(`Not a git repository: ${projectPath}`);
  }
  const status = gitExec(projectPath, ['status', '--porcelain']);
  return { hasUncommittedChanges: status.length > 0 };
}

function stashChanges(p) { gitExec(p, ['stash', 'push', '-m', 'agent-auto-stash']); }

function unstashChanges(p) {
  try { gitExec(p, ['stash', 'pop']); }
  catch { log('GIT', 'Warning: stash pop had conflicts. Check manually.'); }
}

function getCurrentBranch(p) { return gitExec(p, ['rev-parse', '--abbrev-ref', 'HEAD']); }

function createLocalBranch(projectPath, branchName) {
  try {
    gitExec(projectPath, ['checkout', '-b', branchName]);
    return branchName;
  } catch {
    const suffixed = `${branchName}-${Date.now()}`;
    log('GIT', `Branch "${branchName}" exists, using "${suffixed}"`);
    gitExec(projectPath, ['checkout', '-b', suffixed]);
    return suffixed;
  }
}

async function commitLocalFiles(projectPath, files, message) {
  for (const [filePath, content] of Object.entries(files)) {
    const full = path.resolve(projectPath, filePath);
    if (!full.startsWith(path.resolve(projectPath))) throw new Error(`Path traversal blocked: ${filePath}`);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
  }
  for (const filePath of Object.keys(files)) {
    gitExec(projectPath, ['add', filePath]);
  }
  gitExec(projectPath, ['commit', '-m', message]);
}

// ── Agent Helpers ─────────────────────────────────────────────────────────────

function parseJSON(text) {
  // Strip markdown code fences
  let clean = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();

  // Try direct parse first
  try { return JSON.parse(clean); } catch {}

  // CLI may wrap JSON with extra text — extract the first JSON object/array
  const jsonMatch = clean.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[1]); } catch {}
  }

  throw new Error(`Failed to parse JSON from CLI response (${clean.length} chars): ${clean.slice(0, 200)}...`);
}

/**
 * Safely run an agent function with error handling.
 * On failure, emits error to UI and returns the fallback value instead of crashing the pipeline.
 */
async function safeAgentRun(label, id, emit, agentFn, fallback) {
  try {
    return await agentFn();
  } catch (err) {
    log(label, `ERROR: ${err.message}`);
    emit('agent', { id, status: 'error', msg: `Error: ${err.message.slice(0, 200)}` });
    emit('log', { id, msg: `Error: ${err.message.slice(0, 150)}` });
    return fallback;
  }
}

function buildSystemPrompt(basePrompt, customInstructions) {
  if (!customInstructions?.trim()) return basePrompt;
  return `${basePrompt}\n\n## Additional Instructions from User\n${customInstructions.trim()}`;
}

// ── Claude CLI Helper ─────────────────────────────────────────────────────────

function runClaude(label, systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    log(label, 'Calling Claude CLI...');
    const startTime = Date.now();
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const proc = spawn('claude', [
      '-p', '--output-format', 'text',
      '--max-turns', '3',
      '--append-system-prompt', systemPrompt,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    // Pipe user message via stdin to avoid OS arg length limits
    proc.stdin.write(userMessage);
    proc.stdin.end();

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      log(label, `CLI responded in ${elapsed}s (${stdout.length} chars)`);
      if (stderr) log(label, `stderr: ${stderr.slice(0, 200)}`);
      if (code !== 0) {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr || stdout}`));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn claude CLI: ${err.message}. Is it installed? Run: npm install -g @anthropic-ai/claude-code`));
    });
  });
}

// ── Agents ────────────────────────────────────────────────────────────────────

async function runTicketEnhancer(ticket, projectType, claudeMd, instructions) {
  const basePrompt = await loadPrompt('ticket-enhancer');
  const systemPrompt = buildSystemPrompt(basePrompt, instructions);
  const userMsg = `Project type: ${projectType}\n\nProject context (CLAUDE.md):\n${claudeMd || '(none)'}\n\nRaw ticket:\n${ticket}`;
  return await runClaude('ENHANCE', systemPrompt, userMsg);
}

async function runPMAgent(ticket, projectType, claudeMd, instructions) {
  const basePrompt = await loadPrompt('pm-agent');
  const systemPrompt = buildSystemPrompt(basePrompt, instructions);
  const userMsg = `Project type: ${projectType}\n\nProject context (CLAUDE.md):\n${claudeMd || '(No CLAUDE.md available)'}\n\nTicket:\n${ticket}`;
  const result = await runClaude('PM', systemPrompt, userMsg);
  return parseJSON(result);
}

async function runArchAgent(plan, fileTree, projectType, claudeMd, instructions) {
  log('ARCH', `Preparing prompt with ${fileTree.length} file tree entries...`);
  const basePrompt = await loadPrompt('arch-agent');
  const systemPrompt = buildSystemPrompt(basePrompt, instructions);
  const userMsg = `Project type: ${projectType}\n\nProject context (CLAUDE.md):\n${claudeMd || '(none)'}\n\nPlan:\n${JSON.stringify(plan, null, 2)}\n\nRepo file tree (${fileTree.length} entries):\n${fileTree.slice(0, 500).join('\n')}${fileTree.length > 500 ? '\n... (truncated)' : ''}`;
  const result = await runClaude('ARCH', systemPrompt, userMsg);
  return parseJSON(result);
}

async function runRepoAgent(plan, archPlan, fileContents, projectType, claudeMd, instructions) {
  const fileCtx = Object.entries(fileContents)
    .map(([p, c]) => `=== ${p} ===\n${c.length > 6000 ? c.slice(0, 6000) + '\n... [truncated at 6000 chars]' : c}`)
    .join('\n\n');

  log('REPO', `Preparing prompt with ${Object.keys(fileContents).length} file(s) as context...`);
  const basePrompt = await loadPrompt('repo-agent');
  const systemPrompt = buildSystemPrompt(basePrompt, instructions);
  const userMsg = `Project type: ${projectType}\n\nProject context (CLAUDE.md):\n${claudeMd || '(none)'}\n\nPlan:\n${JSON.stringify(plan, null, 2)}\n\nFile change instructions:\n${JSON.stringify(archPlan.file_changes, null, 2)}\n\nCurrent file contents:\n${fileCtx || '(no existing files — all new code)'}`;
  const result = await runClaude('REPO', systemPrompt, userMsg);
  return parseJSON(result);
}

async function runPRReviewAgent(plan, codeFiles, testFiles, projectType, claudeMd, instructions) {
  const fileCtx = Object.entries(codeFiles)
    .map(([p, c]) => `=== ${p} ===\n${c}`)
    .join('\n\n');
  const testCtx = Object.entries(testFiles)
    .map(([p, c]) => `=== ${p} ===\n${c}`)
    .join('\n\n');

  log('REVIEW', `Preparing prompt — reviewing ${Object.keys(codeFiles).length} files...`);
  const basePrompt = await loadPrompt('pr-review-agent');
  const systemPrompt = buildSystemPrompt(basePrompt, instructions);
  const userMsg = `Project type: ${projectType}\n\nProject context (CLAUDE.md):\n${claudeMd || '(none)'}\n\nOriginal plan:\n${JSON.stringify(plan, null, 2)}\n\nGenerated code files:\n${fileCtx}\n\n${testCtx ? `Generated test files:\n${testCtx}` : '(no tests)'}`;
  const result = await runClaude('REVIEW', systemPrompt, userMsg);
  return parseJSON(result);
}

async function runQAAgent1(plan, codeFiles, testFiles, projectType, claudeMd, instructions) {
  const fileCtx = Object.entries(codeFiles)
    .map(([p, c]) => `=== ${p} ===\n${c}`)
    .join('\n\n');
  const testCtx = Object.entries(testFiles)
    .map(([p, c]) => `=== ${p} ===\n${c}`)
    .join('\n\n');

  log('QA1', `Preparing prompt — reviewing ${Object.keys(codeFiles).length} files...`);
  const basePrompt = await loadPrompt('qa-agent-1');
  const systemPrompt = buildSystemPrompt(basePrompt, instructions);
  const userMsg = `Project type: ${projectType}\n\nProject context (CLAUDE.md):\n${claudeMd || '(none)'}\n\nOriginal plan:\n${JSON.stringify(plan, null, 2)}\n\nGenerated code files:\n${fileCtx}\n\n${testCtx ? `Generated test files:\n${testCtx}` : '(no tests)'}`;
  const result = await runClaude('QA1', systemPrompt, userMsg);
  return parseJSON(result);
}

async function runQAAgent2(plan, codeFiles, testFiles, projectType, claudeMd, instructions) {
  const fileCtx = Object.entries(codeFiles)
    .map(([p, c]) => `=== ${p} ===\n${c}`)
    .join('\n\n');
  const testCtx = Object.entries(testFiles)
    .map(([p, c]) => `=== ${p} ===\n${c}`)
    .join('\n\n');

  log('QA2', `Preparing prompt — reviewing ${Object.keys(codeFiles).length} files...`);
  const basePrompt = await loadPrompt('qa-agent-2');
  const systemPrompt = buildSystemPrompt(basePrompt, instructions);
  const userMsg = `Project type: ${projectType}\n\nProject context (CLAUDE.md):\n${claudeMd || '(none)'}\n\nOriginal plan:\n${JSON.stringify(plan, null, 2)}\n\nCode files (already reviewed by PR Reviewer and QA #1):\n${fileCtx}\n\n${testCtx ? `Test files:\n${testCtx}` : '(no tests)'}`;
  const result = await runClaude('QA2', systemPrompt, userMsg);
  return parseJSON(result);
}

// ── Project Management API ────────────────────────────────────────────────────

app.get('/api/projects', async (req, res) => {
  res.json(await loadProjects());
});

app.post('/api/projects', async (req, res) => {
  const { name, path: projectPath, type: projectType } = req.body;
  if (!name?.trim() || !projectPath?.trim()) {
    return res.status(400).json({ error: 'name and path are required' });
  }
  try { await fs.access(projectPath); } catch {
    return res.status(400).json({ error: `Path does not exist: ${projectPath}` });
  }
  const projects = await loadProjects();
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const project = { id, name: name.trim(), path: projectPath.trim(), type: projectType || 'fullstack' };
  projects.push(project);
  await saveProjects(projects);
  log('API', `Added project: ${project.name} (${project.type}) → ${project.path}`);
  res.json(project);
});

app.delete('/api/projects/:id', async (req, res) => {
  let projects = await loadProjects();
  const before = projects.length;
  projects = projects.filter(p => p.id !== req.params.id);
  if (projects.length === before) return res.status(404).json({ error: 'Project not found' });
  await saveProjects(projects);
  log('API', `Removed project: ${req.params.id}`);
  res.json({ ok: true });
});

// ── Directory Browser API ─────────────────────────────────────────────────────

app.get('/api/browse', async (req, res) => {
  const requestedPath = req.query.path || os.homedir();
  const resolved = path.resolve(requestedPath);

  try {
    const items = await fs.readdir(resolved, { withFileTypes: true });
    const dirs = [];
    for (const item of items) {
      if (!item.isDirectory()) continue;
      if (item.name.startsWith('.')) continue;
      if (IGNORE.has(item.name)) continue;
      const fullPath = path.join(resolved, item.name);
      let isGitRepo = false;
      try {
        await fs.access(path.join(fullPath, '.git'));
        isGitRepo = true;
      } catch {}
      dirs.push({ name: item.name, path: fullPath, isGitRepo });
    }
    dirs.sort((a, b) => {
      if (a.isGitRepo && !b.isGitRepo) return -1;
      if (!a.isGitRepo && b.isGitRepo) return 1;
      return a.name.localeCompare(b.name);
    });
    const parent = path.dirname(resolved);
    res.json({ current: resolved, parent: parent !== resolved ? parent : null, dirs });
  } catch (e) {
    res.status(400).json({ error: `Cannot read directory: ${e.message}` });
  }
});

// ── SSE Pipeline Endpoint ─────────────────────────────────────────────────────

app.post('/api/run', async (req, res) => {
  const { ticket, agentConfig = {} } = req.body;

  // Support both single-project (legacy) and multi-project
  let projects = req.body.projects;
  if (!projects && req.body.projectPath) {
    projects = [{ path: req.body.projectPath, type: req.body.projectType || 'fullstack', name: path.basename(req.body.projectPath) }];
  }

  log('API', `POST /api/run — ${projects?.length || 0} project(s), ticket: ${ticket?.slice(0, 80)}...`);

  if (!ticket?.trim()) return res.status(400).json({ error: 'ticket is required' });
  if (!projects?.length) return res.status(400).json({ error: 'At least one project is required.' });

  for (const proj of projects) {
    try { await fs.access(proj.path); } catch {
      return res.status(400).json({ error: `Project path does not exist: ${proj.path}` });
    }
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const emit = (type, data = {}) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  const agentInstructions = (id) => agentConfig[id]?.instructions || '';
  const agentEnabled = (id) => agentConfig[id]?.enabled !== false;

  const projectStates = [];

  try {
    // ── 0. Validate & prepare all projects ──────────────────────────
    for (const proj of projects) {
      emit('log', { id: 'git', msg: `Validating ${proj.name}...` });
      const gitState = await validateGitRepo(proj.path);
      const originalBranch = getCurrentBranch(proj.path);
      let stashed = false;
      if (gitState.hasUncommittedChanges) {
        emit('log', { id: 'git', msg: `Stashing changes in ${proj.name}...` });
        stashChanges(proj.path);
        stashed = true;
      }

      emit('log', { id: 'arch', msg: `Scanning ${proj.name} files...` });
      let fileTree = [];
      try {
        fileTree = await getLocalFileTree(proj.path);
        log('CTX', `${proj.name}: ${fileTree.length} entries`);
      } catch (e) {
        log('CTX', `${proj.name} file tree error: ${e.message}`);
      }

      const { claudeMd, generated } = await getProjectContext(proj.path, fileTree);
      projectStates.push({ ...proj, originalBranch, stashed, fileTree, claudeMd, generated });
    }

    // ── 0.5. Merge contexts across projects ─────────────────────────
    let mergedFileTree, mergedClaudeMd, primaryType;

    if (projectStates.length === 1) {
      const ps = projectStates[0];
      mergedFileTree = ps.fileTree;
      mergedClaudeMd = ps.claudeMd;
      primaryType = ps.type || 'fullstack';
      emit('context', { projects: [{ name: ps.name, claudeMd: ps.claudeMd?.slice(0, 500) || null, generated: ps.generated }] });
    } else {
      mergedFileTree = [];
      const claudeParts = [];
      const contextEvents = [];
      for (const ps of projectStates) {
        for (const entry of ps.fileTree) {
          mergedFileTree.push(`[${ps.name}]/${entry}`);
        }
        claudeParts.push(`# Project: ${ps.name} (${ps.type || 'fullstack'})\n\n${ps.claudeMd || '(no CLAUDE.md)'}`);
        contextEvents.push({ name: ps.name, claudeMd: ps.claudeMd?.slice(0, 300) || null, generated: ps.generated });
      }
      mergedClaudeMd = claudeParts.join('\n\n---\n\n');
      primaryType = projectStates[0].type || 'fullstack';
      emit('context', { projects: contextEvents });
      emit('log', { id: 'pm', msg: `Merged context from ${projectStates.length} projects` });
    }

    // ── 1. Ticket Enhancer ──────────────────────────────────────────
    let enhancedTicket;
    if (agentEnabled('enhance')) {
      log('ENHANCE', 'Starting ticket enhancer...');
      emit('agent', { id: 'enhance', status: 'running', msg: 'Enhancing ticket with details...' });
      enhancedTicket = await safeAgentRun('ENHANCE', 'enhance', emit, async () => {
        const result = await runTicketEnhancer(ticket, primaryType, mergedClaudeMd, agentInstructions('enhance'));
        log('ENHANCE', `Done — enhanced ticket: ${result.length} chars`);
        emit('agent', { id: 'enhance', status: 'done', payload: { enhanced_ticket: result } });
        emit('log', { id: 'enhance', msg: `Ticket enhanced: ${result.length} chars of detailed spec` });
        return result;
      }, ticket);
      if (enhancedTicket === ticket && agentEnabled('enhance')) {
        // safeAgentRun returned fallback — ticket stays raw
        emit('log', { id: 'enhance', msg: 'Fallback — using raw ticket' });
      }
    } else {
      enhancedTicket = ticket;
      emit('agent', { id: 'enhance', status: 'done', msg: 'Skipped (disabled)', payload: { enhanced_ticket: ticket } });
      emit('log', { id: 'enhance', msg: 'Skipped — using raw ticket' });
    }

    // ── 2. PM Agent ─────────────────────────────────────────────────
    const pmFallback = { summary: enhancedTicket, type: 'feature', areas: [], subtasks: [], likely_files: [], pr_title: 'feat: agent changes', pr_description: enhancedTicket };
    let plan;
    if (agentEnabled('pm')) {
      log('PM', 'Starting PM agent...');
      emit('agent', { id: 'pm', status: 'running', msg: 'Building plan from enhanced ticket...' });
      plan = await safeAgentRun('PM', 'pm', emit, async () => {
        const result = await runPMAgent(enhancedTicket, primaryType, mergedClaudeMd, agentInstructions('pm'));
        log('PM', `Done — ${result.subtasks?.length || 0} subtasks, type: ${result.type}`);
        emit('agent', { id: 'pm', status: 'done', payload: result });
        emit('log', { id: 'pm', msg: `Plan ready: ${result.subtasks?.length || 0} subtasks across [${(result.areas || []).join(', ')}]` });
        return result;
      }, pmFallback);
    } else {
      plan = pmFallback;
      emit('agent', { id: 'pm', status: 'done', msg: 'Skipped (disabled)', payload: plan });
      emit('log', { id: 'pm', msg: 'Skipped — using minimal plan' });
    }

    // ── 3. Architecture Agent ───────────────────────────────────────
    const archFallback = { file_changes: [], branch_name: `feature/agent-${Date.now()}`, summary: 'Arch skipped' };
    let archPlan;
    if (agentEnabled('arch')) {
      log('ARCH', 'Starting architecture agent...');
      emit('agent', { id: 'arch', status: 'running', msg: 'Designing file changes...' });
      emit('log', { id: 'arch', msg: `Scanning ${mergedFileTree.length} files across ${projectStates.length} project(s)...` });

      archPlan = await safeAgentRun('ARCH', 'arch', emit, async () => {
        const result = await runArchAgent(plan, mergedFileTree, primaryType, mergedClaudeMd, agentInstructions('arch'));
        log('ARCH', `Done — ${result.file_changes?.length || 0} files, branch: ${result.branch_name}`);
        result.file_changes?.forEach(f => log('ARCH', `  ${f.action} ${f.path} (priority ${f.priority || '?'})`));
        emit('agent', { id: 'arch', status: 'done', payload: result });
        emit('log', { id: 'arch', msg: `Will touch ${result.file_changes?.length || 0} files → branch: ${result.branch_name}` });
        return result;
      }, archFallback);
    } else {
      archPlan = archFallback;
      emit('agent', { id: 'arch', status: 'done', msg: 'Skipped (disabled)', payload: archPlan });
      emit('log', { id: 'arch', msg: 'Skipped' });
    }

    // ── 4. Repo Agent ───────────────────────────────────────────────
    let currentFiles = {};
    let currentTests = {};
    const repoFallback = { files: {}, tests: {}, commit_message: '' };
    if (agentEnabled('repo')) {
      log('REPO', 'Starting repo agent...');
      emit('agent', { id: 'repo', status: 'running', msg: 'Reading existing files...' });

      const fileContents = {};
      for (const change of (archPlan.file_changes || []).filter(c => c.action === 'modify')) {
        let readPath = change.path;
        let readProject = projectStates[0];
        if (projectStates.length > 1 && change.project) {
          readProject = projectStates.find(p => p.name === change.project) || projectStates[0];
          const prefix = `[${readProject.name}]/`;
          if (readPath.startsWith(prefix)) readPath = readPath.slice(prefix.length);
        }
        try {
          log('REPO', `Reading ${readPath} from ${readProject.name}`);
          emit('log', { id: 'repo', msg: `Reading ${readPath}` });
          fileContents[change.path] = await readLocalFile(readProject.path, readPath);
        } catch (e) {
          log('REPO', `  → Error: ${e.message}`);
          emit('log', { id: 'repo', msg: `Warning: ${e.message} — will create fresh` });
        }
      }

      emit('log', { id: 'repo', msg: 'Writing code...' });
      const codeChanges = await safeAgentRun('REPO', 'repo', emit, async () => {
        const result = await runRepoAgent(plan, archPlan, fileContents, primaryType, mergedClaudeMd, agentInstructions('repo'));
        return result;
      }, repoFallback);
      currentFiles = { ...(codeChanges.files || {}) };
      currentTests = { ...(codeChanges.tests || {}) };
      log('REPO', `Done — ${Object.keys(currentFiles).length} files + ${Object.keys(currentTests).length} tests`);

      emit('agent', {
        id: 'repo', status: 'done',
        payload: {
          files: Object.keys(currentFiles),
          file_contents: currentFiles,
          tests: currentTests,
          commit_message: codeChanges.commit_message,
        },
      });
      emit('log', { id: 'repo', msg: `Generated ${Object.keys(currentFiles).length} files${Object.keys(currentTests).length ? ` + ${Object.keys(currentTests).length} tests` : ''}` });
    } else {
      emit('agent', { id: 'repo', status: 'done', msg: 'Skipped (disabled)', payload: {} });
      emit('log', { id: 'repo', msg: 'Skipped' });
    }

    // ── 5. PR Review — Senior Code Review ───────────────────────────
    const reviewFallback = { issues_found: [], summary: 'Review skipped due to error', verdict: 'skip', fixed_files: {}, fixed_tests: {} };
    if (agentEnabled('review')) {
      log('REVIEW', 'Starting PR review agent...');
      emit('agent', { id: 'review', status: 'running', msg: 'Senior engineer reviewing code...' });

      const reviewResult = await safeAgentRun('REVIEW', 'review', emit, async () => {
        return await runPRReviewAgent(plan, currentFiles, currentTests, primaryType, mergedClaudeMd, agentInstructions('review'));
      }, reviewFallback);
      const reviewIssues = reviewResult.issues_found || [];

      if (Object.keys(reviewResult.fixed_files || {}).length > 0) {
        currentFiles = { ...currentFiles, ...reviewResult.fixed_files };
      }
      if (Object.keys(reviewResult.fixed_tests || {}).length > 0) {
        currentTests = { ...currentTests, ...reviewResult.fixed_tests };
      }

      if (reviewResult !== reviewFallback) {
        emit('agent', {
          id: 'review', status: 'done',
          payload: {
            issues: reviewIssues,
            summary: reviewResult.summary,
            verdict: reviewResult.verdict,
            fixed_count: Object.keys(reviewResult.fixed_files || {}).length,
            file_contents: currentFiles,
            tests: currentTests,
          },
        });
        emit('log', { id: 'review', msg: `${reviewResult.verdict === 'approve' ? 'Approved' : 'Changes requested'} — ${reviewResult.summary || `${reviewIssues.length} issues`}` });
      }
    } else {
      emit('agent', { id: 'review', status: 'done', msg: 'Skipped (disabled)', payload: {} });
      emit('log', { id: 'review', msg: 'Skipped' });
    }

    // ── 6. QA Agent #1 — Bugs, Security, Correctness ────────────────
    const qaFallback = { issues_found: [], summary: 'QA skipped due to error', fixed_files: {}, fixed_tests: {} };
    if (agentEnabled('qa1')) {
      log('QA1', 'Starting QA agent #1...');
      emit('agent', { id: 'qa1', status: 'running', msg: 'Reviewing for bugs and security...' });

      const qa1Result = await safeAgentRun('QA1', 'qa1', emit, async () => {
        return await runQAAgent1(plan, currentFiles, currentTests, primaryType, mergedClaudeMd, agentInstructions('qa1'));
      }, qaFallback);
      const qa1Issues = qa1Result.issues_found || [];

      if (Object.keys(qa1Result.fixed_files || {}).length > 0) {
        currentFiles = { ...currentFiles, ...qa1Result.fixed_files };
      }
      if (Object.keys(qa1Result.fixed_tests || {}).length > 0) {
        currentTests = { ...currentTests, ...qa1Result.fixed_tests };
      }

      if (qa1Result !== qaFallback) {
        emit('agent', {
          id: 'qa1', status: 'done',
          payload: {
            issues: qa1Issues,
            summary: qa1Result.summary,
            fixed_count: Object.keys(qa1Result.fixed_files || {}).length,
            file_contents: currentFiles,
            tests: currentTests,
          },
        });
        emit('log', { id: 'qa1', msg: qa1Result.summary || `${qa1Issues.length} issues found` });
      }
    } else {
      emit('agent', { id: 'qa1', status: 'done', msg: 'Skipped (disabled)', payload: {} });
      emit('log', { id: 'qa1', msg: 'Skipped' });
    }

    // ── 7. QA Agent #2 — Quality, Performance, Best Practices ───────
    if (agentEnabled('qa2')) {
      log('QA2', 'Starting QA agent #2...');
      emit('agent', { id: 'qa2', status: 'running', msg: 'Reviewing for quality and best practices...' });

      const qa2Result = await safeAgentRun('QA2', 'qa2', emit, async () => {
        return await runQAAgent2(plan, currentFiles, currentTests, primaryType, mergedClaudeMd, agentInstructions('qa2'));
      }, qaFallback);
      const qa2Issues = qa2Result.issues_found || [];

      if (Object.keys(qa2Result.fixed_files || {}).length > 0) {
        currentFiles = { ...currentFiles, ...qa2Result.fixed_files };
      }
      if (Object.keys(qa2Result.fixed_tests || {}).length > 0) {
        currentTests = { ...currentTests, ...qa2Result.fixed_tests };
      }

      if (qa2Result !== qaFallback) {
        emit('agent', {
          id: 'qa2', status: 'done',
          payload: {
            issues: qa2Issues,
            summary: qa2Result.summary,
            fixed_count: Object.keys(qa2Result.fixed_files || {}).length,
            file_contents: currentFiles,
            tests: currentTests,
          },
        });
        emit('log', { id: 'qa2', msg: qa2Result.summary || `${qa2Issues.length} improvements applied` });
      }
    } else {
      emit('agent', { id: 'qa2', status: 'done', msg: 'Skipped (disabled)', payload: {} });
      emit('log', { id: 'qa2', msg: 'Skipped' });
    }

    // ── 8. Git — per project ────────────────────────────────────────
    const branchName = archPlan.branch_name || `feature/agent-${Date.now()}`;
    const allFiles = { ...currentFiles, ...currentTests };
    const commitMessage = codeChanges.commit_message;
    const projectResults = [];

    emit('agent', { id: 'git', status: 'running', msg: `Committing to ${projectStates.length} project(s)...` });

    if (projectStates.length === 1) {
      const ps = projectStates[0];
      const actualBranch = createLocalBranch(ps.path, branchName);
      emit('log', { id: 'git', msg: `Branch: ${actualBranch}` });
      await commitLocalFiles(ps.path, allFiles, commitMessage);
      emit('log', { id: 'git', msg: `Committed ${Object.keys(allFiles).length} file(s)` });
      projectResults.push({ name: ps.name, branch: actualBranch, files: Object.keys(allFiles) });
    } else {
      for (const ps of projectStates) {
        const projFiles = {};
        for (const [filePath, content] of Object.entries(allFiles)) {
          const prefix = `[${ps.name}]/`;
          if (filePath.startsWith(prefix)) {
            projFiles[filePath.slice(prefix.length)] = content;
          }
          const archFile = archPlan.file_changes?.find(f => f.path === filePath);
          if (archFile?.project === ps.name) {
            projFiles[filePath] = content;
          }
        }
        if (Object.keys(projFiles).length === 0 && projectStates.indexOf(ps) === 0) {
          Object.assign(projFiles, allFiles);
        }
        if (Object.keys(projFiles).length === 0) {
          emit('log', { id: 'git', msg: `No changes for ${ps.name}` });
          continue;
        }
        const actualBranch = createLocalBranch(ps.path, branchName);
        await commitLocalFiles(ps.path, projFiles, commitMessage);
        emit('log', { id: 'git', msg: `${ps.name}: ${Object.keys(projFiles).length} file(s) → ${actualBranch}` });
        projectResults.push({ name: ps.name, branch: actualBranch, files: Object.keys(projFiles) });
      }
    }

    emit('agent', { id: 'git', status: 'done', payload: { projects: projectResults } });

    emit('done', {
      projects: projectResults,
      branch: projectResults[0]?.branch || branchName,
      files: projectResults.flatMap(p => p.files),
      commit: commitMessage,
    });

  } catch (err) {
    log('ERROR', err.message);
    emit('error', { msg: err.message });
  } finally {
    for (const ps of projectStates) {
      try {
        gitExec(ps.path, ['checkout', ps.originalBranch]);
        log('GIT', `${ps.name}: restored → ${ps.originalBranch}`);
        if (ps.stashed) {
          unstashChanges(ps.path);
          log('GIT', `${ps.name}: unstashed`);
        }
      } catch (e) {
        log('GIT', `${ps.name}: warning — ${e.message}`);
      }
    }
    res.end();
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Engineering Team Agent\n  http://localhost:${PORT}\n`);
});
