FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    git \
    python3 \
    ripgrep \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV CODE_AGENT_PROVIDER=openai-compatible
ENV CODE_AGENT_BASE_URL=http://host.docker.internal:11434/v1
ENV CODE_AGENT_API_KEY=ollama
ENV CODE_AGENT_MODEL=qwen3:8b
ENV CODE_AGENT_PERMISSION_MODE=workspace-write
ENV CODE_AGENT_OUTPUT_FORMAT=text

CMD ["bash"]
