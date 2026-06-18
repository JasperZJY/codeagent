# Docker Sandbox

The project has two sandbox layers:

1. Docker isolation for the operating-system process boundary.
2. Code Agent permission and workspace path checks inside the runtime.

Docker does not replace runtime permission checks. Use both.

## Build

```powershell
cd "E:\学习文档\智能体相关学习资料\code agent"
docker compose build
```

## Run Checks

```powershell
docker compose run --rm code-agent npm test
docker compose run --rm code-agent npm run typecheck
docker compose run --rm code-agent python3 -m py_compile py/agent_bridge.py
```

## Enter The Container

```powershell
docker compose run --rm code-agent
```

Inside the container:

```bash
npm test
node dist/src/index.js doctor
node dist/src/index.js --output-format json route "read README.md"
node dist/src/index.js --permission-mode read-only prompt "read README.md"
```

## Provider Notes

For host Ollama from inside Docker Desktop, use:

```env
CODE_AGENT_PROVIDER=openai-compatible
CODE_AGENT_BASE_URL=http://host.docker.internal:11434/v1
CODE_AGENT_API_KEY=ollama
CODE_AGENT_MODEL=qwen3:8b
```

For hosted APIs, pass the same variables through your shell or `.env` file used by Docker Compose:

```env
CODE_AGENT_PROVIDER=openai-compatible
CODE_AGENT_BASE_URL=https://api.openai.com/v1
CODE_AGENT_API_KEY=sk-...
CODE_AGENT_MODEL=gpt-4.1-mini
```

Anthropic:

```env
CODE_AGENT_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6
```
