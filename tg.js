// tg.js
import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';

// Reutiliza lo que ya tienes:
import { sendAutoQuotePDF } from './quote.js';     // <- Si tu función se llama distinto, ajusta aquí
import { appendFromSession } from './sheets.js';   // <- Opcional: si quieres registrar en tu Sheet

const router = express.Router();
router.use(express.json());

const TG_TOKEN   = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_SECRET  = process.env.TELEGRAM_WEBHOOK_SECRET || ''; // si la pones, Telegram te manda un header
const BASE_URL   = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const TMP_DIR    = path.resolve('./data/tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

function tgsend(method, body) {
  const url = `https://api.telegram.org/bot${TG_TOKEN}/${method}`;
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function tgsendDoc(chat_id, filePath, caption='Cotización') {
  const url = `https://api.telegram.org/bot${TG_TOKEN}/sendDocument`;
  const form = new FormData();
  form.append('chat_id', String(chat_id));
  form.append('caption', caption.slice(0,1024));
  form.append('document', fs.createReadStream(filePath));
  const r = await fetch(url, { method:'POST', body: form });
  if (!r.ok) console.error('sendDocument error', await r.text());
  return r.ok;
}

const dia = (n)=> String(n).padStart(2,'0');

function hoyBO() {
  const d = new Date();
  return `${dia(d.getDate())}/${dia(d.getMonth()+1)}/${d.getFullYear()}`;
}

// ------ Parser de tu texto ---------------------------
// Formatos aceptados para ítems (usa cualquiera):
//  a) "3; Bidón 20L MICROCAT; 150"    (separado por ;)
//  b) "3 x Bidón 20L MICROCAT @ 150"
//  c) "3 Bidón 20L MICROCAT - Bs 150"
//  d) "3 Bidón 20L MICROCAT 150"  (todo junto, última cifra es costo)
const RE_EMPRESA = /(?:^|\n)\s*(empresa|cliente)\s*:\s*(.+)$/i;
const RE_FECHA   = /(?:^|\n)\s*fecha\s*:\s*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i;
const RE_DESC    = /(?:^|\n)\s*(desc|descripci[oó]n)\s*:\s*([\s\S]+?)(?=\n(?:mensaje|items?|ítems?|total)\s*:|\s*$)/i;
const RE_MSG     = /(?:^|\n)\s*mensaje\s*:\s*([\s\S]+?)(?=\n(?:items?|ítems?|total)\s*:|\s*$)/i;
const RE_TOTAL   = /(?:^|\n)\s*total\s*:\s*bs?\.?\s*([0-9]+(?:[.,][0-9]{1,2})?)/i;

function parseItems(text) {
  const items = [];
  const lines = text.split(/\n+/).map(s => s.trim()).filter(Boolean);

  for (const line of lines) {
    // a) "q; det; costo"
    let m = line.match(/^\s*([0-9]+(?:[.,][0-9]+)?)\s*;\s*(.+?)\s*;\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*$/);
    if (m) { items.push({ qty: +m[1].replace(',','.'), detail: m[2].trim(), unit: +m[3].replace(',','.') }); continue; }

    // b) "q x det @ costo"
    m = line.match(/^\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:x|por)?\s*(.+?)\s*@\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*$/i);
    if (m) { items.push({ qty: +m[1].replace(',','.'), detail: m[2].trim(), unit: +m[3].replace(',','.') }); continue; }

    // c) "q det - Bs costo"
    m = line.match(/^\s*([0-9]+(?:[.,][0-9]+)?)\s+(.+?)\s*[-–]\s*bs?\.?\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*$/i);
    if (m) { items.push({ qty: +m[1].replace(',','.'), detail: m[2].trim(), unit: +m[3].replace(',','.') }); continue; }

    // d) "q det costo"
    m = line.match(/^\s*([0-9]+(?:[.,][0-9]+)?)\s+(.+?)\s+([0-9]+(?:[.,][0-9]{1,2})?)\s*$/);
    if (m) { items.push({ qty: +m[1].replace(',','.'), detail: m[2].trim(), unit: +m[3].replace(',','.') }); continue; }
  }

  return items;
}

function parseQuoteText(raw) {
  const text = String(raw || '');
  const empresa = (text.match(RE_EMPRESA)?.[2] || '').trim();
  const fecha   = (text.match(RE_FECHA)?.[1] || '').trim();
  const desc    = (text.match(RE_DESC)?.[2] || '').trim();
  const msg     = (text.match(RE_MSG)?.[1] || '').trim();
  const totalIn = text.match(RE_TOTAL)?.[1];

  // Inferir bloque de ítems:
  let itemsBlock = '';
  const idxItems = text.search(/(?:^|\n)\s*(items?|ítems?)\s*:/i);
  if (idxItems >= 0) {
    itemsBlock = text.slice(idxItems).replace(/^[^\n]*:\s*/,''); // quita "Items:"
  } else {
    // Si no hay "Items:", toma todo lo que no sea encabezados conocidos (fallback)
    itemsBlock = text.replace(RE_EMPRESA,'').replace(RE_FECHA,'').replace(RE_DESC,'')
                     .replace(RE_MSG,'').replace(RE_TOTAL,'').trim();
  }
  const items = parseItems(itemsBlock);

  const subtotal = items.reduce((a,b)=> a + b.qty*b.unit, 0);
  const total = totalIn ? +totalIn.replace(',','.') : subtotal;

  return {
    empresa: empresa || 'Consumidor Final',
    fecha: fecha || hoyBO(),
    descripcion: desc || '',
    mensaje: msg || '',
    items,
    subtotal,
    total
  };
}

// Construir “session-like” para tu sendAutoQuotePDF (ajústalo si tu función exige otro shape)
function sessionFromParsed(chatId, parsed) {
  return {
    profileName: parsed.empresa,
    vars: {
      cart: parsed.items.map(it => ({
        sku: null,
        nombre: it.detail,
        presentacion: null,
        cantidad: `${it.qty} unid`,
        unit_bob: it.unit
      }))
    },
    meta: { origin: 'telegram', chatId },
    note: {
      fecha: parsed.fecha,
      descripcion: parsed.descripcion,
      mensaje: parsed.mensaje,
      total_bob: parsed.total
    }
  };
}

// (Opcional) Guardar en Sheets con tu appendFromSession
async function maybeAppendToSheets(s, id='telegram') {
  try { await appendFromSession(s, id, 'tg'); } catch(e){ console.warn('Sheets append fail:', e.message); }
}

// -------------- Webhook -------------------------------
router.post('/tg/webhook', async (req, res) => {
  try {
    if (TG_SECRET) {
      const hdr = req.headers['x-telegram-bot-api-secret-token'];
      if (!hdr || String(hdr) !== TG_SECRET) return res.sendStatus(401);
    }

    const update = req.body || {};
    const msg = update.message || update.edited_message || {};
    const chatId = msg.chat?.id;
    const text = msg.text || '';

    if (!chatId || !text) return res.sendStatus(200);

    // 1) Parsear
    const parsed = parseQuoteText(text);

    // 2) Armar session-like y generar PDF
    const s = sessionFromParsed(chatId, parsed);

    // ---- Opción A: Reutilizar tu generador existente ----
    const pdfPath = await sendAutoQuotePDF(chatId, s); 
    // Si tu sendAutoQuotePDF devuelve buffer en vez de path, guarda a archivo:
    // const pdfBuf = await sendAutoQuotePDF(chatId, s);
    // const tmp = path.join(TMP_DIR, `cotizacion_${chatId}_${Date.now()}.pdf`);
    // fs.writeFileSync(tmp, pdfBuf); const pdfPath = tmp;

    // 3) Enviar resumen + PDF
    await tgsend('sendMessage', {
      chat_id: chatId,
      text: [
        `*Cotización preparada*`,
        `Empresa: ${parsed.empresa}`,
        `Fecha: ${parsed.fecha}`,
        parsed.descripcion ? `Descripción: ${parsed.descripcion}` : null,
        parsed.mensaje ? `Mensaje: ${parsed.mensaje}` : null,
        '',
        ...parsed.items.map(it => `• ${it.qty} x ${it.detail} — Bs ${it.unit.toFixed(2)}`),
        '',
        `Subtotal: Bs ${parsed.subtotal.toFixed(2)}`,
        `Total: Bs ${parsed.total.toFixed(2)}`
      ].filter(Boolean).join('\n'),
      parse_mode: 'Markdown'
    });

    await tgsendDoc(chatId, pdfPath, 'Tu cotización en PDF');

    // 4) (Opcional) registrar en Sheets
    await maybeAppendToSheets(s, String(chatId));

    return res.sendStatus(200);
  } catch (e) {
    console.error('TG webhook error', e);
    return res.sendStatus(500);
  }
});

export default router;
