module.exports = {
  apps: [
    {
      name: "trace-barcode",
      script: "server.js",
      cwd: "/home/deploy/Github/trace-barcode",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
  ],
};
