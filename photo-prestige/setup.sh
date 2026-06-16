#!/bin/bash

# Photo Prestige - Quick Setup Script
# This script initializes the project structure and prepares it for development

set -e

echo "=========================================="
echo "Photo Prestige - Setup Script"
echo "=========================================="
echo ""

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Please install Docker."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose not found. Please install Docker Compose."
    exit 1
fi

echo "✅ Docker and Docker Compose found"
echo ""

# Copy environment file
if [ ! -f .env ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
    echo "⚠️  Please update .env with your Imagga credentials!"
    echo ""
fi

# Build images
echo "Building Docker images..."
docker-compose build

echo ""
echo "✅ Setup complete!"
echo ""
echo "=========================================="
echo "Next steps:"
echo "=========================================="
echo "1. Update .env with Imagga API credentials"
echo "2. Run: docker-compose up -d"
echo "3. Wait 30 seconds for services to start"
echo "4. Check health: curl http://localhost:3001/auth/health"
echo "5. Read GETTING_STARTED.md for testing guide"
echo "=========================================="
