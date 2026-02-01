#!/bin/bash

# Slack Roulette Production Startup Script
# Handles build, migrations, and PM2 start

set -e  # Exit on any error

echo "🚀 Starting Slack Roulette production deployment..."

# Store the base directory
BASE_DIR=$(pwd)

# Clean Next.js build artifacts and cache
echo "🧹 Cleaning Next.js cache and build artifacts..."

if [ -d ".next" ]; then
    echo "   Removing .next directory..."
    rm -rf .next
fi

# Clear Next.js cache
echo "   Clearing Next.js cache..."
npx next cache clean 2>/dev/null || true

# Create logs directory
echo "📁 Ensuring logs directory exists..."
mkdir -p logs

# Install dependencies
echo "📦 Installing dependencies..."
npm ci

# Generate Prisma client
echo "🔧 Generating Prisma client..."
npx prisma generate

# Run database migrations
echo "🗄️  Running database migrations..."
npx prisma migrate deploy

# Build the application
echo "🏗️  Building application..."
npm run build

# Start with PM2
echo "🔄 Starting application with PM2..."
pm2 start ecosystem.config.js --env production || pm2 restart ecosystem.config.js --env production

echo "📊 PM2 Status:"
pm2 list

echo ""
echo "✅ Slack Roulette started successfully!"
echo "📝 Logs: pm2 logs slack-roulette"
echo "📊 Status: pm2 status"
echo "🔄 Restart: pm2 restart slack-roulette"
echo "🛑 Stop: pm2 stop slack-roulette"
