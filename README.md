# AgentForge

**Paste a ticket. 8 AI agents enhance, plan, architect, code, review, QA, and commit to local branches.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node 18+](https://img.shields.io/badge/node-18%2B-brightgreen.svg)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

<!-- Add a screenshot or demo GIF here -->
<!-- ![AgentForge Demo](docs/demo.png) -->

---

## Pipeline

```
Raw ticket (text)
      |
Ticket Enhancer     -- enriches vague tickets into detailed engineering specs
      |
PM Agent            -- reads enhanced ticket + CLAUDE.md, produces risk-assessed subtasks
      |
Architecture Agent  -- reads file tree + CLAUDE.md, picks files to change with priority order
      |
Repo Agent          -- reads files + CLAUDE.md, writes production code + tests
      |
PR Review Agent     -- senior engineer code review (design, naming, patterns, DRY)
      |
QA Agent #1         -- reviews for bugs, security, and correctness (project-type-aware)
      |
QA Agent #2         -- reviews for code quality, performance, and best practices
      |
Git                 -- creates branch, commits locally, restores original branch
```

## Features

- **8-agent pipeline** -- enhancer, PM, architect, repo, PR review, 2 QA agents, and git
- **5 project types** -- backend, frontend, android, iOS, or fullstack; every agent adapts its checklists
- **Multi-project runs** -- select multiple projects for a single pipeline run; agents merge context and commit per-project
- **Directory browser** -- browse your filesystem to pick project folders; git repos are highlighted
- **Agent configuration** -- toggle any agent on/off (including architect and repo) and add custom instructions per agent
- **QA group toggle** -- enable/disable both QA agents with a single click
- **PR Review agent** -- senior code review for design patterns, naming, DRY, readability, and maintainability
- **CLAUDE.md auto-detection** -- reads your project's `CLAUDE.md` for conventions; auto-generates one if missing
- **Ticket enhancement** -- raw tickets are enriched with acceptance criteria, edge cases, and technical requirements
- **Dual QA review** -- QA #1 catches bugs/security issues, QA #2 enforces quality/best practices; both auto-fix
- **Risk assessment** -- PM agent flags high-risk subtasks with reasons
- **Test generation** -- Repo agent generates tests if your project has testing patterns
- **Git safety** -- auto-stashes uncommitted changes, handles branch collisions, restores state after
- **Decision timeline** -- see exactly what each agent decided and why
- **Code preview** -- syntax-highlighted preview of final code (after all reviews) in the UI
- **Log filtering** -- filter pipeline logs by any of the 8 agents
- **Separate prompt files** -- all agent prompts live in `prompts/` for easy customization
- **Resilient pipeline** -- agents that fail gracefully skip instead of crashing the entire run
- **Powered by Claude CLI** -- no API key needed; uses your Claude subscription

## Quick Start

```bash
# 1. Install Claude CLI and authenticate
npm install -g @anthropic-ai/claude-code
claude auth login

# 2. Clone and install
git clone https://github.com/codedsun/AgentForge.git
cd AgentForge
npm install

# 3. Start
npm start
# -> http://localhost:3000
```

That's it. No API keys to configure -- AgentForge uses the Claude CLI under the hood, which authenticates via your Claude subscription.

## Adding projects

1. Click **+ Add Project** in the left panel
2. Enter a project name
3. Use the directory browser to navigate to a local git repo (git repos show a green indicator)
4. Click a git repo folder to select it
5. Choose the project type and click **Add**

Select multiple projects by checking their checkboxes in the project list. All selected projects are included in the pipeline run.

Project types: **backend**, **frontend**, **android**, **ios**, **fullstack** (default)

The project type determines which checklists every agent uses. For example:
- **Backend** -- SQL injection, auth/authz, rate limiting, DB transactions, API docs
- **Frontend** -- XSS, state management, accessibility, loading states, responsive design
- **Android** -- lifecycle handling, null safety, coroutine scopes, ProGuard, battery efficiency
- **iOS** -- retain cycles, force unwraps, Swift concurrency, SwiftUI best practices, Keychain
- **Fullstack** -- consistent types between frontend and backend, API error handling on both sides

## Agent configuration

Open **Agent Settings** in the left panel to:
- **Toggle agents on/off** -- disable any agent for faster runs or debugging
- **QA group toggle** -- enable/disable both QA agents at once
- **Add custom instructions** -- e.g., "focus on API design" for the PM agent

When an agent is disabled, the pipeline skips it and passes safe defaults to downstream agents. If an agent fails (e.g., bad JSON response), it's marked as errored and the pipeline continues.

## Agent prompts

All agent system prompts live in `prompts/`:

| File | Agent | Purpose |
|---|---|---|
| `ticket-enhancer.txt` | Ticket Enhancer | Enriches raw tickets into detailed specs |
| `pm-agent.txt` | PM Agent | Breaks tickets into subtasks with risk assessment |
| `arch-agent.txt` | Architecture Agent | Maps subtasks to file changes |
| `repo-agent.txt` | Repo Agent | Writes production code + tests |
| `pr-review-agent.txt` | PR Review | Senior code review for design and quality |
| `qa-agent-1.txt` | QA #1 | Bug hunting, security, correctness |
| `qa-agent-2.txt` | QA #2 | Code quality, performance, best practices |

Edit these files to customize agent behavior. Changes take effect on next `npm start` (prompts are cached in memory).

## CLAUDE.md

Add a `CLAUDE.md` to your repo root to give agents deep project context:

```markdown
# My App

## Tech Stack
React 18, TypeScript, Tailwind, Express, PostgreSQL, Prisma

## File Structure
- src/components/ -- React components (PascalCase)
- src/hooks/ -- custom hooks
- src/api/ -- API client
- server/ -- Express backend

## Conventions
- Imports: external first, then internal, then relative
- Naming: PascalCase components, camelCase utils
- Tests: co-located *.test.tsx files using Vitest

## No-Go Zones
- Don't modify auth middleware without review
- Don't change DB migrations directly
```

If no `CLAUDE.md` exists, the agent auto-generates one by scanning your project's `package.json`, file structure, and config files. Auto-detection supports JavaScript/TypeScript, Python, Go, Rust, Swift/Xcode, and Kotlin projects.

## Multi-project runs

When multiple projects are selected:

1. All projects are validated (must be git repos)
2. File trees are merged with project-name prefixes
3. CLAUDE.md files are concatenated with project headers
4. Agents work across the merged context
5. Git commits are created per-project on separate branches
6. All projects are restored to their original state afterward

## Architecture

```
public/              Vanilla JS frontend (HTML + CSS + JS)
  index.html         Two-panel layout: sidebar + pipeline view
  css/styles.css     Dark theme, CSS variables
  js/app.js          Client state, SSE handling, rendering

prompts/             Plain-text system prompts (one per agent)

server.js            Express server
  /api/projects      Project CRUD (stored in projects.json)
  /api/browse        Directory browser with git detection
  /api/run           SSE pipeline — spawns Claude CLI per agent
```

The server spawns the `claude` CLI as a subprocess for each agent, passing the system prompt via `--append-system-prompt` and piping the user message via stdin. Responses are parsed as JSON and streamed to the frontend via Server-Sent Events.

## Tips

- Write detailed tickets or let the Ticket Enhancer do the heavy lifting
- The more specific your `CLAUDE.md`, the better the code quality
- Check the generated code before merging -- you are the tech lead
- Use the decision timeline to understand agent reasoning
- Click agent cards to expand and see full details
- Customize prompts in `prompts/` to match your team's standards
- Toggle off QA agents for quick prototyping runs
- Add custom instructions to fine-tune agent behavior per run

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute.

