# manage-salary-bot

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

## Running Locally with PM2 (Recommended for Continuous Operation)

To run the bot persistently in local development with auto-restart on changes:

```bash
npm run pm2:start
```

Monitor the process:
```bash
npm run pm2:monit
```

View logs:
```bash
npm run pm2:logs
```

Stop the bot:
```bash
npm run pm2:stop
```

This project was created using `bun init` in bun v1.3.5. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
