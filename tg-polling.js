// tg-polling.js — Menú de 3 botones (Registro / Cotizaciones / Rendición)
// Flujos con selección de nombre, marca (Publicom/Eco Rural) y guardado en Sheets.
import 'dotenv/config';
import fs from 'fs';
import { Telegraf, Markup } from 'telegraf';

import { sendAutoQuotePDF } from './quote.js';           // Publicom (actual)
import { sendEcoRuralQuotePDF } from './quote-eco.js';   // Eco Rural (nuevo archivo)

import {
  appendRegistroTrabajo,
  appendRendicionRow
} from './sheets.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) { console.error('Falta TELEGRAM_BOT_TOKEN en .env'); process.exit(1); }

const bot = new Telegraf(token);

// ============== Utils ==============
const pad2 = n => String(n).padStart(2,'0');
const hoyBO = () => {
  const d = new Date();
  return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`;
};
const cleanName = (s='') => String(s)
  .normalize('NFD').replace(/\p{Diacritic}/gu,'')
  .replace(/[\\/:*?"<>|]+/g,'')
  .replace(/\s+/g,' ')
  .trim()
  .slice(0, 80);

// ============== Estado en memoria ==============
/**
 * state por chatId:
 * {
 *   mode: 'registro'|'cotizacion'|'rendicion'|null,
 *   step: string|null,
 *   nombre: string|null,
 *   brand: 'PUBLICOM'|'ECORURAL'|null,
 *   // rendición:
 *   r_titulo: string|null,
 *   r_monto: number|null
 * }
 */
const state = new Map();
const getS = (id) => state.get(id) || {};
const setS = (id, patch) => state.set(id, { ...getS(id), ...patch });
const clearS = (id) => state.delete(id);

// ============== Botones / Menús ==============
const NOMBRES = ['SANTIAGO', 'ORLANDO', 'EFREN', 'MERCEDES'];
const nombresKeyboard = () => {
  const rows = [];
  for (let i=0;i<NOMBRES.length;i+=2){
    rows.push([
      Markup.button.callback(NOMBRES[i], `sel_nombre:${NOMBRES[i]}`),
      NOMBRES[i+1] ? Markup.button.callback(NOMBRES[i+1], `sel_nombre:${NOMBRES[i+1]}`) : undefined
    ].filter(Boolean));
  }
  return Markup.inlineKeyboard(rows);
};

const mainMenu = () => Markup.inlineKeyboard([
  [
    Markup.button.callback('📝 REGISTRO', 'registro'),
    Markup.button.callback('💼 COTIZACIONES', 'cotizaciones'),
    Markup.button.callback('💳 RENDICIÓN', 'rendicion')
  ]
]);

const brandMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('🏢 PUBLICOM', 'brand:PUBLICOM'), Markup.button.callback('🌿 ECO RURAL', 'brand:ECORURAL')]
]);

const afterRegistroMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('➕ AGREGAR NUEVO', 'registro_nuevo'), Markup.button.callback('✅ FINALIZAR', 'finalizar')]
]);

const afterCotizacionMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('🧾 COTIZAR NUEVAMENTE', 'cotizar_nuevo'), Markup.button.callback('✅ FINALIZAR', 'finalizar')]
]);

const afterRendicionMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('➕ AGREGAR NUEVO', 'rendicion_nuevo'), Markup.button.callback('✅ FINALIZAR', 'finalizar')]
]);

const introCampos = () => 'Por favor rellena estos campos y envíame el texto completo 👇';
const plantillaCampos = () => (
`Empresa:
Fecha: ${hoyBO()}

Descripción:

Items:
2; Diseño de logo; 350
1 Mantenimiento mensual - Bs 300
5 Horas de soporte 100`
);

// Registro — guía
const registroIntro = () => 'REGISTRA TU TRABAJO DE HOY. La FECHA y HORA se tomarán automáticamente.';
const registroPideNombre = () => 'Selecciona tu nombre:';
const registroPideTrabajos = () => '✍️ Escribe los TRABAJOS realizados hoy día.';

// Rendición — guía
const rendicionIntro = () => '💳 Realiza tu RENDICIÓN DE CUENTAS.';
const rendicionPideNombre = () => 'Selecciona tu nombre:';
const rendicionPideTitulo = () => '📌 Escribe el EVENTO / OCASIÓN:';
const rendicionPideMonto = () => '💵 Coloca el MONTO RECIBIDO (en Bs):';
const rendicionPideGastos = () => '🧾 Detalla tus gastos (una línea por gasto, ej: `100 - Trufi`, `20 - Almuerzo`).';

// ============== Parsers COTIZACIÓN ==============
const RE_EMPRESA = /(?:^|\n)\s*(?:empresa|cliente)\s*:\s*([^\n]+)/i;
const RE_FECHA   = /(?:^|\n)\s*fecha\s*:\s*([^\n]+)/i;
const RE_DESC    = /(?:^|\n)\s*(?:desc|descripci[oó]n|concepto)\s*:\s*([\s\S]+?)(?=\n(?:items?|ítems?|total)\s*:|\s*$)/i;
const RE_TOTAL   = /(?:^|\n)\s*total\s*:\s*(?:bs\.?\s*)?([0-9]+(?:[.,][0-9]{1,2})?)/i;

// Toma la última cifra de cada línea como subtotal (sin precio unitario)
function parseItems(block='') {
  const items = [];
  const lines = String(block).split(/\n+/).map(s => s.trim()).filter(Boolean);
  for (const line of lines) {
    let m;
    m = line.match(/^\s*([0-9]+(?:[.,][0-9]+)?)\s*;\s*(.+?)\s*;\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*$/);
    if (m) { items.push({ qty:+m[1].replace(',','.'), detail:m[2].trim(), line:+m[3].replace(',','.') }); continue; }
    m = line.match(/^\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:x|por)?\s*(.+?)\s*@\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*$/i);
    if (m) { items.push({ qty:+m[1].replace(',','.'), detail:m[2].trim(), line:+m[3].replace(',','.') }); continue; }
    m = line.match(/^\s*([0-9]+(?:[.,][0-9]+)?)\s+(.+?)\s*[-–]\s*bs?\.?\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*$/i);
    if (m) { items.push({ qty:+m[1].replace(',','.'), detail:m[2].trim(), line:+m[3].replace(',','.') }); continue; }
    m = line.match(/^\s*([0-9]+(?:[.,][0-9]+)?)\s+(.+?)\s+([0-9]+(?:[.,][0-9]{1,2})?)\s*$/);
    if (m) { items.push({ qty:+m[1].replace(',','.'), detail:m[2].trim(), line:+m[3].replace(',','.') }); continue; }
  }
  return items;
}

function parseQuoteText(text='') {
  const empresa = (text.match(RE_EMPRESA)?.[1] || '').trim();
  const fecha   = (text.match(RE_FECHA)?.[1] || '').trim();
  const desc    = (text.match(RE_DESC)?.[1] || '').trim();
  const totalIn = text.match(RE_TOTAL)?.[1];

  let itemsBlock = '';
  const idxItems = text.search(/(?:^|\n)\s*(items?|ítems?)\s*:/i);
  if (idxItems >= 0) itemsBlock = text.slice(idxItems).replace(/^[^\n]*:\s*/, '');
  else itemsBlock = text.replace(RE_EMPRESA,'').replace(RE_FECHA,'').replace(RE_DESC,'')
                        .replace(RE_TOTAL,'').trim();

  const items = parseItems(itemsBlock);
  const subtotal = items.reduce((a,b)=> a + b.line, 0);
  const total = totalIn ? +totalIn.replace(',','.') : subtotal;

  return { empresa, fecha: fecha || hoyBO(), descripcion: desc || '', items, subtotal, total };
}

function sessionFromParsed(telegramId, p){
  return {
    profileName: p.empresa || '',
    vars: {
      cart: p.items.map(it => ({
        nombre: it.detail,
        cantidad: it.qty,
        subtotal_bs: it.line
      }))
    },
    meta: { origin: 'telegram', chatId: telegramId },
    note: { fecha: p.fecha, descripcion: p.descripcion, total_bob: p.total }
  };
}

// ============== Helpers Rendición ==============
function parseMonto(s=''){
  const m = String(s).replace(',', '.').match(/-?\d+(?:\.\d{1,2})?/);
  return m ? Number(m[0]) : NaN;
}
function sumGastos(text=''){
  const lines = String(text).split(/\n+/).map(x=>x.trim()).filter(Boolean);
  let total = 0;
  for (const ln of lines){
    const m = ln.replace(',', '.').match(/-?\d+(?:\.\d{1,2})?/);
    if (m) total += Number(m[0]);
  }
  return { total, lines };
}

// ============== Bot: flujo ==============
async function sendWelcome(ctx){
  await ctx.reply('👋 ¡Bienvenido! ¿Qué deseas hacer hoy?', mainMenu());
}

bot.start(sendWelcome);

// ===== Menú principal =====
bot.action('registro', async (ctx) => {
  await ctx.answerCbQuery();
  clearS(ctx.chat.id);
  setS(ctx.chat.id, { mode:'registro', step:'pickName' });
  await ctx.reply(registroIntro());
  await ctx.reply(registroPideNombre(), nombresKeyboard());
});

bot.action('cotizaciones', async (ctx) => {
  await ctx.answerCbQuery();
  clearS(ctx.chat.id);
  setS(ctx.chat.id, { mode:'cotizacion', step:'brand' });
  await ctx.reply('Elige la empresa para la cotización:', brandMenu());
});

bot.action('rendicion', async (ctx) => {
  await ctx.answerCbQuery();
  clearS(ctx.chat.id);
  setS(ctx.chat.id, { mode:'rendicion', step:'pickName' });
  await ctx.reply(rendicionIntro());
  await ctx.reply(rendicionPideNombre(), nombresKeyboard());
});

// ===== Selección de nombre (registro/rendición) =====
bot.action(/sel_nombre:(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const name = ctx.match[1];
  const st = getS(ctx.chat.id);
  if (!st.mode) return;

  setS(ctx.chat.id, { nombre: name });

  if (st.mode === 'registro') {
    setS(ctx.chat.id, { step:'trabajos' });
    await ctx.reply(registroPideTrabajos());
  } else if (st.mode === 'rendicion') {
    setS(ctx.chat.id, { step:'titulo' });
    await ctx.reply(rendicionPideTitulo());
  }
});

// ===== Selección de marca (cotizaciones) =====
bot.action(/brand:(PUBLICOM|ECORURAL)/, async (ctx) => {
  await ctx.answerCbQuery();
  const brand = ctx.match[1];
  setS(ctx.chat.id, { mode:'cotizacion', step:'plantilla', brand });
  await ctx.reply(introCampos());
  await ctx.reply(plantillaCampos());
});

// ===== Acciones post-flujo =====
bot.action('registro_nuevo', async (ctx) => {
  await ctx.answerCbQuery();
  clearS(ctx.chat.id);
  setS(ctx.chat.id, { mode:'registro', step:'pickName' });
  await ctx.reply(registroIntro());
  await ctx.reply(registroPideNombre(), nombresKeyboard());
});

bot.action('cotizar_nuevo', async (ctx) => {
  await ctx.answerCbQuery();
  clearS(ctx.chat.id);
  setS(ctx.chat.id, { mode:'cotizacion', step:'brand' });
  await ctx.reply('Elige la empresa para la cotización:', brandMenu());
});

bot.action('rendicion_nuevo', async (ctx) => {
  await ctx.answerCbQuery();
  clearS(ctx.chat.id);
  setS(ctx.chat.id, { mode:'rendicion', step:'pickName' });
  await ctx.reply(rendicionIntro());
  await ctx.reply(rendicionPideNombre(), nombresKeyboard());
});

bot.action('finalizar', async (ctx) => {
  await ctx.answerCbQuery('Hecho');
  clearS(ctx.chat.id);
  await sendWelcome(ctx);
});

// ===== Entrada de texto =====
bot.on('text', async (ctx) => {
  const text = ctx.message.text || '';
  const st = getS(ctx.chat.id);
  if (!st.mode) {
    await sendWelcome(ctx);
    return;
  }

  // --- REGISTRO ---
  if (st.mode === 'registro') {
    if (st.step === 'trabajos') {
      if (!st.nombre) {
        await ctx.reply(registroPideNombre(), nombresKeyboard());
        return;
      }
      const nombre = st.nombre;
      const trabajos = text.trim();
      if (!trabajos) {
        await ctx.reply('Por favor escribe los trabajos realizados.');
        return;
      }
      try{
        await appendRegistroTrabajo({ nombre, trabajos });
        await ctx.reply('✅ ¡TRABAJO REGISTRADO!', afterRegistroMenu());
      }catch(err){
        console.error('Sheets error (registro):', err?.message || err);
        await ctx.reply('⚠️ No pude guardar en Google Sheets. Revisa credenciales/Spreadsheet ID.');
      }
      return;
    }
    // si aún no eligió nombre:
    await ctx.reply(registroPideNombre(), nombresKeyboard());
    return;
  }

  // --- COTIZACIONES ---
  if (st.mode === 'cotizacion') {
    if (st.step !== 'plantilla' || !st.brand) {
      // Aún no eligió marca
      setS(ctx.chat.id, { step:'brand' });
      await ctx.reply('Elige la empresa para la cotización:', brandMenu());
      return;
    }

    // Tiene plantilla y brand definido
    const p = parseQuoteText(text);
    if (!p.items.length) {
      await ctx.reply(introCampos());
      await ctx.reply(plantillaCampos());
      return;
    }
    const s = sessionFromParsed(ctx.from.id, p);

    let buffer;
    try{
      // Generar con la marca elegida
      const out = (st.brand === 'ECORURAL')
        ? await sendEcoRuralQuotePDF(ctx.from.id, s)
        : await sendAutoQuotePDF(ctx.from.id, s);

      if (typeof out === 'string') {
        buffer = fs.readFileSync(out);
        try { fs.unlinkSync(out); } catch {}
      } else if (Buffer.isBuffer(out)) {
        buffer = out;
      } else if (out?.path) {
        buffer = fs.readFileSync(out.path);
        try { fs.unlinkSync(out.path); } catch {}
      } else {
        throw new Error('No obtuve un PDF válido.');
      }
    }catch(err){
      console.error('PDF error:', err?.message || err);
      await ctx.reply('⚠️ No pude generar el PDF.');
      return;
    }

    const resumen = [
      `*Cotización de servicios* (${st.brand})`,
      `Empresa: ${p.empresa || '—'}`,
      `Fecha: ${p.fecha}`,
      p.descripcion ? `\nDescripción:\n${p.descripcion}` : null,
      `\nItems:`,
      ...p.items.map(it => `• ${it.qty} ${it.detail} — Bs ${it.line.toFixed(2)}`),
      `\nSubtotal: Bs ${p.subtotal.toFixed(2)}`,
      `Total: Bs ${p.total.toFixed(2)}`
    ].filter(Boolean).join('\n');
    await ctx.reply(resumen, { parse_mode: 'Markdown' });

    const empresaSafe = cleanName(p.empresa || 'Cliente');
    const descSafe    = cleanName(p.descripcion || '');
    const fileName    = `${st.brand} - ${empresaSafe}${descSafe ? ' - ' + descSafe : ''}.pdf`;

    await ctx.replyWithDocument({ source: buffer, filename: fileName });
    await ctx.reply('¿Deseas hacer otra acción?', afterCotizacionMenu());
    return;
  }

  // --- RENDICIÓN ---
  if (st.mode === 'rendicion') {
    if (st.step === 'titulo') {
      const titulo = text.trim();
      if (!titulo) { await ctx.reply('El título no puede estar vacío.'); return; }
      setS(ctx.chat.id, { r_titulo: titulo, step:'monto' });
      await ctx.reply(rendicionPideMonto());
      return;
    }
    if (st.step === 'monto') {
      const monto = parseMonto(text);
      if (!isFinite(monto)) {
        await ctx.reply('Monto inválido. Escribe solo el número (ej: 250 o 250.50).');
        return;
      }
      setS(ctx.chat.id, { r_monto: monto, step:'gastos' });
      await ctx.reply(rendicionPideGastos(), { parse_mode: 'Markdown' });
      return;
    }
    if (st.step === 'gastos') {
      if (!st.nombre) {
        await ctx.reply(rendicionPideNombre(), nombresKeyboard());
        return;
      }
      if (!st.r_titulo) {
        setS(ctx.chat.id, { step:'titulo' });
        await ctx.reply(rendicionPideTitulo());
        return;
      }
      if (!isFinite(st.r_monto)) {
        setS(ctx.chat.id, { step:'monto' });
        await ctx.reply(rendicionPideMonto());
        return;
      }

      const rendicionTexto = text.trim();
      const { total: totalBs, lines } = sumGastos(rendicionTexto);
      const saldo = Number((st.r_monto - totalBs).toFixed(2));

      const resumen = [
        `*Rendición de cuentas*`,
        `Nombre: ${st.nombre}`,
        `Título: ${st.r_titulo}`,
        `Monto recibido: Bs ${st.r_monto.toFixed(2)}`,
        `Gastos:\n${lines.map(l=>`• ${l}`).join('\n')}`,
        `\nTotal Gastos (Bs): ${totalBs.toFixed(2)}`,
        `Saldo: ${saldo.toFixed(2)}`
      ].join('\n');

      await ctx.reply(resumen, { parse_mode: 'Markdown' });

      // Guardar en Sheets (Hoja 2 por defecto)
      try{
        await appendRendicionRow({
          nombre: st.nombre,
          titulo: st.r_titulo,
          montoDado: st.r_monto,
          rendicionTexto,
          totalBs,
          saldo
        });
        await ctx.reply('✅ Guardado con éxito.', afterRendicionMenu());
      }catch(err){
        console.error('Sheets error (rendición):', err?.message || err);
        await ctx.reply('⚠️ No pude guardar la rendición en Google Sheets.');
      }
      return;
    }

    // Si recién entra o faltó seleccionar nombre
    if (st.step === 'pickName' || !st.nombre) {
      await ctx.reply(rendicionPideNombre(), nombresKeyboard());
      return;
    }

    // fallback
    await ctx.reply(rendicionPideTitulo());
    setS(ctx.chat.id, { step:'titulo' });
    return;
  }

  // Fallback general
  await sendWelcome(ctx);
});

bot.launch();
console.log('Telegram bot con Registro / Cotizaciones / Rendición (long-polling)');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
