// server.js
import 'dotenv/config';
import express from 'express';

// Arranca el bot de Telegram (long-polling)
import './tg-polling.js';

const app = express();

app.get('/', (req, res) => res.send('Bot online'));
app.get('/healthz', (req, res) => res.status(200).send('ok')); // health check para Render

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`[server] HTTP up on :${PORT}`);
});

// Cierre limpio (Render envía SIGTERM en deploys)
const stop = (sig) => () => { console.log(`[server] ${sig}`); process.exit(0); };
process.on('SIGINT',  stop('SIGINT'));
process.on('SIGTERM', stop('SIGTERM'));
