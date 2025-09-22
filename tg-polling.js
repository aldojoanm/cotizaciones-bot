// tg-viaticos.js — Bot de REGISTRO de trabajo + RENDICIÓN de viáticos
import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import {
  appendRegistroTrabajo,
  appendRendicionRow
} from './sheets.js';

// ====== ENV ======
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) { console.error('Falta TELEGRAM_BOT_TOKEN en .env'); process.exit(1); }
const bot = new Telegraf(token);

// ====== Estado ======
/**
 * state por chatId:
 * {
 *   mode: 'registro'|'rendicion'|null,
 *   step: string|null,
 *   nombre: string|null,
 *   // rendición:
 *   r_titulo: string|null,
 *   r_monto: number|null
 * }
 */
const state = new Map();
const getS = (id) => state.get(id) || {};
const setS = (id, patch) => state.set(id, { ...getS(id), ...patch });
const clearS = (id) => state.delete(id);

// ====== UI ======
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
    Markup.button.callback('📝 REGISTRO DE TRABAJO', 'registro'),
    Markup.button.callback('💳 RENDICIÓN DE VIÁTICOS', 'rendicion')
  ]
]);

const afterRegistroMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('➕ AGREGAR NUEVO', 'registro_nuevo'), Markup.button.callback('✅ FINALIZAR', 'finalizar')]
]);

const afterRendicionMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('➕ AGREGAR NUEVO', 'rendicion_nuevo'), Markup.button.callback('✅ FINALIZAR', 'finalizar')]
]);

// Textos
const registroIntro = () => 'REGISTRA TU TRABAJO DE HOY. La FECHA y HORA se tomarán automáticamente.';
const registroPideNombre = () => 'Selecciona tu nombre:';
const registroPideTrabajos = () => '✍️ Escribe los TRABAJOS realizados hoy día.';

const rendicionIntro = () => '💳 Realiza tu RENDICIÓN DE CUENTAS (viáticos).';
const rendicionPideNombre = () => 'Selecciona tu nombre:';
const rendicionPideTitulo = () => '📌 Escribe el EVENTO / OCASIÓN:';
const rendicionPideMonto = () => '💵 Coloca el MONTO RECIBIDO (en Bs):';
const rendicionPideGastos = () => '🧾 Detalla tus gastos (una línea por gasto, ej: `100 - Trufi`, `20 - Almuerzo`).';

// ====== Helpers Rendición ======
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

// ====== Flujo ======
async function sendWelcome(ctx){
  await ctx.reply('👋 ¿Qué deseas hacer hoy?', mainMenu());
}

bot.start(async (ctx) => {
  clearS(ctx.chat.id);
  await sendWelcome(ctx);
});

// ===== Acciones principales =====
bot.action('registro', async (ctx) => {
  await ctx.answerCbQuery();
  clearS(ctx.chat.id);
  setS(ctx.chat.id, { mode:'registro', step:'pickName' });
  await ctx.reply(registroIntro());
  await ctx.reply(registroPideNombre(), nombresKeyboard());
});

bot.action('rendicion', async (ctx) => {
  await ctx.answerCbQuery();
  clearS(ctx.chat.id);
  setS(ctx.chat.id, { mode:'rendicion', step:'pickName' });
  await ctx.reply(rendicionIntro());
  await ctx.reply(rendicionPideNombre(), nombresKeyboard());
});

// ===== Selección de nombre =====
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

// ===== Acciones post-flujo =====
bot.action('registro_nuevo', async (ctx) => {
  await ctx.answerCbQuery();
  clearS(ctx.chat.id);
  setS(ctx.chat.id, { mode:'registro', step:'pickName' });
  await ctx.reply(registroIntro());
  await ctx.reply(registroPideNombre(), nombresKeyboard());
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
console.log('Bot de REGISTRO + RENDICIÓN iniciado (long-polling).');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
