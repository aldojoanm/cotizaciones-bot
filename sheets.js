// src/sheets.js — Registro y Rendición en Sheets
// - Autocreación de pestañas
// - Rangos A1 seguros con comillas
// - Registro: FECHA | HORA | NOMBRE | TRABAJOS
// - Rendición (Hoja 2): FECHA | NOMBRE | TITULO | MONTO DADO | RENDICION | BS | SALDO
import 'dotenv/config';
import { google } from 'googleapis';

let _sheets;

function decodeCredsFromEnv() {
  const b64 = process.env.GOOGLE_CREDENTIALS_B64;
  if (b64 && b64.trim()) {
    const b64Clean = b64.replace(/\s+/g, '');
    const json = Buffer.from(b64Clean, 'base64').toString('utf8');
    return JSON.parse(json);
  }
  const rawJson = process.env.GOOGLE_CREDENTIALS_JSON;
  if (rawJson && rawJson.trim()) return JSON.parse(rawJson);
  return null;
}

export async function getSheets() {
  if (_sheets) return _sheets;

  let auth;
  const inlineCreds = decodeCredsFromEnv();

  if (inlineCreds) {
    auth = new google.auth.GoogleAuth({
      credentials: inlineCreds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else {
    throw new Error('No hay credenciales: define GOOGLE_CREDENTIALS_B64, GOOGLE_CREDENTIALS_JSON o GOOGLE_APPLICATION_CREDENTIALS.');
  }

  const client = await auth.getClient();
  _sheets = google.sheets({ version: 'v4', auth: client });
  return _sheets;
}

// ===== Helpers =====
const LOCAL_TZ = process.env.LOCAL_TZ || 'America/La_Paz';
const pad2 = n => String(n).padStart(2,'0');

function a1(tabTitle, ref = 'A1') {
  const safeTitle = `'${String(tabTitle).replace(/'/g, "''")}'`;
  return `${safeTitle}!${ref}`;
}

async function ensureTabExists(spreadsheetId, tabTitle) {
  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const titles = (meta.data.sheets || []).map(s => s.properties?.title || '');
  if (!titles.includes(tabTitle)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tabTitle } } }] }
    });
  }
}

function nowLocal() {
  try {
    const parts = new Intl.DateTimeFormat('es-BO', {
      timeZone: LOCAL_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date());
    const get = t => parts.find(p => p.type === t)?.value || '';
    return {
      fecha: `${get('day')}/${get('month')}/${get('year')}`,
      hora:  `${get('hour')}:${get('minute')}`
    };
  } catch {
    const d = new Date();
    return {
      fecha: `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`,
      hora:  `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    };
  }
}

// ===== REGISTRO: FECHA | HORA | NOMBRE | TRABAJOS =====
export async function appendRegistroTrabajo({ nombre, trabajos }) {
  const sheets = await getSheets();
  const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
  const tab = process.env.SHEETS_TAB_REGISTRO || 'Registro';
  if (!spreadsheetId) throw new Error('Falta SHEETS_SPREADSHEET_ID en el entorno.');

  await ensureTabExists(spreadsheetId, tab);

  const { fecha, hora } = nowLocal();
  const values = [[fecha, hora, nombre || '', trabajos || '']];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: a1(tab, 'A1'),
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });

  return true;
}

// ===== RENDICIÓN: FECHA | NOMBRE | TITULO | MONTO DADO | RENDICION | BS | SALDO =====
export async function appendRendicionRow({ nombre, titulo, montoDado, rendicionTexto, totalBs, saldo }) {
  const sheets = await getSheets();
  const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
  const tab = process.env.SHEETS_TAB_RENDICION || 'Hoja 2'; // << Por defecto Hoja 2
  if (!spreadsheetId) throw new Error('Falta SHEETS_SPREADSHEET_ID en el entorno.');

  await ensureTabExists(spreadsheetId, tab);

  const { fecha } = nowLocal();
  const values = [[
    fecha,
    nombre || '',
    titulo || '',
    Number(montoDado ?? 0),
    rendicionTexto || '',
    Number(totalBs ?? 0),
    Number(saldo ?? 0)
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: a1(tab, 'A1'),
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });

  return true;
}
