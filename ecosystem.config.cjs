module.exports = {
  apps: [
    {
      name: "clubsante",
      cwd: "/opt/clubsante",
      script: "server/index.js",
      interpreter: "node",
      watch: false,
      instances: 1,
      autorestart: true,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        PORT: 3000
        // OPENAI_API_KEY, ASSISTANT_ID и прочие — берутся из .env
      },
      out_file: "/var/log/clubsante.out.log",
      error_file: "/var/log/clubsante.err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z"
    }
  ]
};
