# Contributing to AgentForge

Thanks for your interest in contributing! Here's how to get started.

## Setup

```bash
git clone https://github.com/codedsun/AgentForge.git
cd AgentForge
npm install
npm run dev   # starts with --watch for auto-reload
```

Requires [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`claude auth login`).

## Project structure

```
server.js           Main backend — Express server, pipeline orchestration, git helpers
prompts/            One .txt file per agent (system prompts)
public/
  index.html        UI layout
  css/styles.css    Dark theme, all styling
  js/app.js         Client-side state, SSE handling, rendering
projects.json       Persisted project list (git-ignored)
```

## How the pipeline works

1. Frontend sends ticket + selected projects + agent config to `POST /api/run`
2. Server opens an SSE stream and runs agents sequentially
3. Each agent: loads its prompt from `prompts/`, spawns `claude` CLI, parses JSON response
4. Results stream to the frontend as SSE events (`agent`, `log`, `timeline`, `done`)
5. Final step: git branch + commit per project

## Adding a new agent

1. **Create the prompt** -- add `prompts/my-agent.txt` with the system prompt
2. **Add the runner** -- in `server.js`, create `async function runMyAgent(...)` following the pattern of existing agents (use `runClaude()` + `parseJSON()`)
3. **Wire into pipeline** -- add the call in the `/api/run` handler, wrapped with `safeAgentRun()` for error resilience
4. **Update frontend** -- add the agent to `AGENTS` array in `app.js`, add a log filter button in `index.html`, add CSS colors

## Pull request guidelines

- Keep PRs focused — one feature or fix per PR
- Test with at least one project before submitting
- If changing prompts, describe what changed and why
- If adding a new agent, include the prompt file and a sample output

## Reporting issues

Open an issue with:
- What you expected to happen
- What actually happened
- Server logs (from terminal) if applicable
