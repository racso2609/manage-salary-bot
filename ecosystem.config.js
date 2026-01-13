module.exports = {
  apps: [{
    name: 'manage-salary-bot',
    script: 'index.ts',
    interpreter: 'node',
    interpreter_args: '--loader ts-node/esm',
    instances: 1,  // Single instance as requested
    autorestart: true,
    watch: true,   // Auto-restart on file changes for local dev
    ignore_watch: ['node_modules', 'logs'],
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log'
  }]
};