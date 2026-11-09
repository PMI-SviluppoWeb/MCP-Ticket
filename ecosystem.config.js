module.exports = {
  apps: [
    {
      name: 'mcp-ticket-server',
      script: 'dist/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 8000,
      time: true,
      merge_logs: true,
      out_file: 'logs/mcp-ticket-server.log',
      error_file: 'logs/mcp-ticket-server-error.log',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
