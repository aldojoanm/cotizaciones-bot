import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Routers
import tgRouter from './tg.js';
import pricesRouter from './prices.js'; 

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Estáticos
app.use('/image', express.static(path.join(__dirname, 'image')));
app.use(express.static(path.join(__dirname, 'public')));

// Health & páginas
app.get('/', (_req, res) => res.send('OK'));
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/privacidad', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacidad.html'));
});

app.use(tgRouter);

app.use(pricesRouter);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server Telegram escuchando en :${PORT}`);
  console.log('   • Telegram:   POST /tg/webhook');
  console.log('   • Health:     GET  /healthz');
  console.log('   • Imágenes:   /image/*');
  console.log('   • Privacidad: GET  /privacidad');
});
