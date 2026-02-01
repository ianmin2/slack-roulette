module.exports = {
  apps: [
    {
      name: 'slack-roulette',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: './',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      // Logging
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // Process management
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      // Health monitoring
      health_check_grace_period: 5000,
      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
      // Restart policy
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '30s',
      // Exponential backoff restart delay
      exp_backoff_restart_delay: 100
    }
  ]
};
