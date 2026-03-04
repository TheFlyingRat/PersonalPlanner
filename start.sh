#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Reclaim — Self-hosted Calendar Manager${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Check for Node.js
if ! command -v node &>/dev/null; then
  echo -e "${RED}Error: Node.js is not installed.${NC}"
  echo "Install Node.js 22+ from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo -e "${RED}Error: Node.js 20+ required (found v$(node -v)).${NC}"
  exit 1
fi

# Check for pnpm
if ! command -v pnpm &>/dev/null; then
  echo -e "${YELLOW}pnpm not found. Installing...${NC}"
  npm install -g pnpm@9.15.4
fi

# Create .env from example if it doesn't exist
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo -e "${YELLOW}Created .env from .env.example — edit it with your settings.${NC}"
  fi
fi

# Parse command
MODE="${1:-dev}"

case "$MODE" in
  dev)
    echo -e "${GREEN}Starting in development mode...${NC}"
    echo ""

    # Install dependencies if needed
    if [ ! -d node_modules ]; then
      echo -e "${CYAN}Installing dependencies...${NC}"
      pnpm install
    fi

    echo -e "${CYAN}API:      ${NC}http://localhost:3000"
    echo -e "${CYAN}Frontend: ${NC}http://localhost:5173"
    echo ""

    pnpm dev
    ;;

  build)
    echo -e "${GREEN}Building all packages...${NC}"
    echo ""

    if [ ! -d node_modules ]; then
      echo -e "${CYAN}Installing dependencies...${NC}"
      pnpm install
    fi

    pnpm build

    echo ""
    echo -e "${GREEN}Build complete.${NC} Run ${CYAN}./start.sh prod${NC} to start."
    ;;

  prod|production|start)
    echo -e "${GREEN}Starting in production mode...${NC}"
    echo ""

    # Install dependencies if needed
    if [ ! -d node_modules ]; then
      echo -e "${CYAN}Installing dependencies...${NC}"
      pnpm install
    fi

    # Build if not already built
    if [ ! -f packages/api/dist/index.js ]; then
      echo -e "${CYAN}Building packages...${NC}"
      pnpm build
    fi

    PORT="${PORT:-3000}"
    echo -e "${CYAN}Server: ${NC}http://localhost:${PORT}"
    echo ""

    node packages/api/dist/index.js
    ;;

  test)
    echo -e "${GREEN}Running tests...${NC}"
    echo ""

    if [ ! -d node_modules ]; then
      pnpm install
    fi

    cd packages/engine && npx vitest run
    ;;

  *)
    echo "Usage: ./start.sh [command]"
    echo ""
    echo "Commands:"
    echo "  dev          Start in development mode with hot reload (default)"
    echo "  build        Build all packages for production"
    echo "  prod         Start in production mode"
    echo "  test         Run engine tests"
    echo ""
    ;;
esac
