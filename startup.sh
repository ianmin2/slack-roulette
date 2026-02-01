#!/bin/bash
#
# Slack Roulette - PM2 Startup Script
# ====================================
# Handles complete deployment: checks, migrations, build, and PM2 start
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="slack-roulette"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${APP_DIR}/logs"
ENV_FILE="${APP_DIR}/.env"
ENV_LOCAL="${APP_DIR}/.env.local"

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_command() {
    if ! command -v "$1" &> /dev/null; then
        log_error "$1 is not installed"
        return 1
    fi
    log_success "$1 found: $(command -v $1)"
    return 0
}

# =============================================================================
# PREREQUISITE CHECKS
# =============================================================================

check_prerequisites() {
    log_info "Checking prerequisites..."

    local failed=0

    # Node.js
    if check_command node; then
        local node_version=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$node_version" -lt 18 ]; then
            log_error "Node.js 18+ required (found: $(node -v))"
            failed=1
        fi
    else
        failed=1
    fi

    # npm
    check_command npm || failed=1

    # PM2
    if ! check_command pm2; then
        log_warn "PM2 not found. Installing globally..."
        npm install -g pm2
        check_command pm2 || failed=1
    fi

    # Prisma CLI (will be installed with npm install if missing)

    if [ $failed -eq 1 ]; then
        log_error "Prerequisites check failed"
        exit 1
    fi

    log_success "All prerequisites satisfied"
}

# =============================================================================
# ENVIRONMENT CHECKS
# =============================================================================

check_environment() {
    log_info "Checking environment configuration..."

    # Check for .env or .env.local
    if [ ! -f "$ENV_FILE" ] && [ ! -f "$ENV_LOCAL" ]; then
        log_error "No .env or .env.local file found"
        log_info "Copy .env.example to .env and configure it:"
        log_info "  cp .env.example .env"
        exit 1
    fi

    # Source env file for checks
    if [ -f "$ENV_LOCAL" ]; then
        set -a
        source "$ENV_LOCAL"
        set +a
        log_success "Loaded .env.local"
    elif [ -f "$ENV_FILE" ]; then
        set -a
        source "$ENV_FILE"
        set +a
        log_success "Loaded .env"
    fi

    # Check required variables
    local required_vars=(
        "DATABASE_URL"
        "SLACK_BOT_TOKEN"
        "SLACK_SIGNING_SECRET"
    )

    local missing=0
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            log_error "Missing required env variable: $var"
            missing=1
        fi
    done

    if [ $missing -eq 1 ]; then
        log_error "Please configure missing environment variables"
        exit 1
    fi

    log_success "Environment configuration OK"
}

# =============================================================================
# SETUP
# =============================================================================

setup_directories() {
    log_info "Setting up directories..."

    # Create logs directory
    if [ ! -d "$LOG_DIR" ]; then
        mkdir -p "$LOG_DIR"
        log_success "Created logs directory: $LOG_DIR"
    else
        log_success "Logs directory exists: $LOG_DIR"
    fi
}

install_dependencies() {
    log_info "Installing dependencies..."

    cd "$APP_DIR"

    if [ ! -d "node_modules" ] || [ "$1" = "--force" ]; then
        npm ci --production=false
        log_success "Dependencies installed"
    else
        log_success "Dependencies already installed (use --force to reinstall)"
    fi
}

# =============================================================================
# DATABASE
# =============================================================================

run_migrations() {
    log_info "Running database migrations..."

    cd "$APP_DIR"

    # Generate Prisma client
    npx prisma generate
    log_success "Prisma client generated"

    # Run migrations
    npx prisma migrate deploy
    log_success "Database migrations applied"
}

# =============================================================================
# BUILD
# =============================================================================

build_app() {
    log_info "Building application..."

    cd "$APP_DIR"

    # Check if build exists and is recent
    if [ -d ".next" ] && [ "$1" != "--force" ]; then
        local build_time=$(stat -c %Y .next 2>/dev/null || stat -f %m .next 2>/dev/null)
        local package_time=$(stat -c %Y package.json 2>/dev/null || stat -f %m package.json 2>/dev/null)

        if [ "$build_time" -gt "$package_time" ]; then
            log_success "Build is up to date (use --force to rebuild)"
            return 0
        fi
    fi

    npm run build
    log_success "Application built successfully"
}

# =============================================================================
# PM2 MANAGEMENT
# =============================================================================

stop_app() {
    log_info "Stopping existing PM2 process..."

    if pm2 describe "$APP_NAME" &> /dev/null; then
        pm2 stop "$APP_NAME" --silent || true
        pm2 delete "$APP_NAME" --silent || true
        log_success "Stopped and removed existing process"
    else
        log_success "No existing process to stop"
    fi
}

start_app() {
    local env="${1:-production}"

    log_info "Starting application with PM2 (env: $env)..."

    cd "$APP_DIR"

    pm2 start ecosystem.config.js --env "$env"

    # Wait for startup
    sleep 3

    # Check if running
    if pm2 describe "$APP_NAME" &> /dev/null; then
        log_success "Application started successfully"
        pm2 show "$APP_NAME"
    else
        log_error "Failed to start application"
        log_info "Check logs: pm2 logs $APP_NAME"
        exit 1
    fi
}

save_pm2() {
    log_info "Saving PM2 process list..."
    pm2 save
    log_success "PM2 process list saved"
}

# =============================================================================
# MAIN
# =============================================================================

show_help() {
    echo "Slack Roulette - Startup Script"
    echo ""
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  start       Full startup (check, install, migrate, build, start)"
    echo "  restart     Restart the PM2 process"
    echo "  stop        Stop the PM2 process"
    echo "  status      Show PM2 status"
    echo "  logs        Show PM2 logs"
    echo "  build       Build only (no PM2)"
    echo "  migrate     Run database migrations only"
    echo "  setup       Setup only (install deps, create dirs)"
    echo ""
    echo "Options:"
    echo "  --force     Force reinstall/rebuild"
    echo "  --dev       Start in development mode"
    echo "  --help      Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 start              # Full production startup"
    echo "  $0 start --dev        # Start in development mode"
    echo "  $0 start --force      # Force rebuild and restart"
    echo "  $0 restart            # Restart existing process"
    echo "  $0 logs               # View logs"
}

main() {
    local command="${1:-start}"
    local force=""
    local env="production"

    # Parse options
    for arg in "$@"; do
        case $arg in
            --force)
                force="--force"
                ;;
            --dev|--development)
                env="development"
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
        esac
    done

    echo ""
    echo "========================================"
    echo "  Slack Roulette - Startup"
    echo "========================================"
    echo ""

    case $command in
        start)
            check_prerequisites
            check_environment
            setup_directories
            install_dependencies $force
            run_migrations
            build_app $force
            stop_app
            start_app $env
            save_pm2
            ;;
        restart)
            cd "$APP_DIR"
            pm2 restart "$APP_NAME"
            log_success "Application restarted"
            ;;
        stop)
            stop_app
            ;;
        status)
            pm2 status "$APP_NAME"
            ;;
        logs)
            pm2 logs "$APP_NAME" --lines 50
            ;;
        build)
            check_prerequisites
            install_dependencies $force
            build_app $force
            ;;
        migrate)
            check_prerequisites
            check_environment
            run_migrations
            ;;
        setup)
            check_prerequisites
            check_environment
            setup_directories
            install_dependencies $force
            ;;
        *)
            log_error "Unknown command: $command"
            show_help
            exit 1
            ;;
    esac

    echo ""
    log_success "Done!"
    echo ""
}

main "$@"
