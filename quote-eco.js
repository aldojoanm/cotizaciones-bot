// quote-eco.js — Igual al layout de Publicom + logo extra arriba del título “COTIZACIÓN”
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

const TZ = process.env.TIMEZONE || 'America/La_Paz';

// === utils (mismos helpers del base) ===
function findAsset(...relPaths){
  for (const r of relPaths){
    const p = path.resolve(r);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function ensure(v, def){ return v==null || v==='' ? def : v; }
function money(n){
  const s = (Number(n||0)).toFixed(2);
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function upperES(s){ return String(s ?? '').toLocaleUpperCase('es-BO'); }

function parseDateFlexible(s) {
  if (!s) return new Date();
  const t = String(s).trim();
  let m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const d = parseInt(m[1],10), mo = parseInt(m[2],10)-1, y = parseInt(m[3].padStart(4,'20'),10);
    const dt = new Date(y, mo, d);
    if (!isNaN(dt)) return dt;
  }
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const y = +m[1], mo = +m[2]-1, d = +m[3];
    const dt = new Date(y, mo, d);
    if (!isNaN(dt)) return dt;
  }
  const dt = new Date(t);
  return isNaN(dt) ? new Date() : dt;
}
function fmtLongDateES(inputDate, tz = TZ){
  const d = parseDateFlexible(inputDate);
  const s = new Intl.DateTimeFormat('es-BO', { timeZone: tz, weekday:'long', day:'numeric', month:'long', year:'numeric' })
    .format(d)
    .replace(',', '');
  return upperES(s);
}

// === render principal (igual al base + logo extra arriba del título) ===
async function renderEcoQuotePDF(quote, outPath){
  const dir = path.dirname(outPath);
  try{ fs.mkdirSync(dir, { recursive:true }); }catch{}

  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const xMargin = 36;
  const usableW = pageW - xMargin*2;

  // Assets: mantenemos watermark y logo de Publicom + añadimos el nuevo logo chico
  const watermarkPath = findAsset('./public/publicom-p-transparent.png');
  const logoPath      = findAsset('./public/publicom-logo.png');
  const extraLogoPath = findAsset('./public/logo-c.png', './public\\logo-c.png', 'public/logo-c.png', 'public\\logo-c.png');

  // Fondo (igual al base)
  const BG_Y_SHIFT = -50;
  if (watermarkPath){
    doc.save();
    doc.opacity(0.06);
    const mw = 460;
    const mx = (pageW - mw) / 2;
    const my = (pageH - mw * 0.45) / 2 + BG_Y_SHIFT;
    try { doc.image(watermarkPath, mx, my, { width: mw }); } catch {}
    doc.restore();
  }

  // Header: logo Publicom arriba a la derecha (igual al base)
  let y = 28;
  if (logoPath){
    try { doc.image(logoPath, pageW - xMargin - 120, y, { width: 120 }); } catch {}
  }

  // ** NUEVO **: logo extra arriba del título, tamaño pequeño
  if (extraLogoPath){
    try { doc.image(extraLogoPath, xMargin, y, { width: 60 }); } catch {}
  }

  // Título (lo bajamos más para que no se superponga con el logo extra)
  const TITLE_EXTRA = 72; // antes ~24; ahora más abajo para despejar el logo
  doc.font('Helvetica-Bold').fontSize(18).text('COTIZACIÓN', xMargin, y + TITLE_EXTRA, { align: 'left' });

  // Continuamos como el base
  y = 86 + 18 + (TITLE_EXTRA - 24); // ajustamos el “punto de partida” por el descenso extra

  // ===== BLOQUE DE DATOS =====
  const c = quote.cliente || {};
  const empresaVal = upperES(ensure(c.nombre, '—'));

  const drawField = (label, value) => {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(`${label}: `, xMargin, y, { continued: true });
    doc.font('Helvetica').fontSize(10).fillColor('#111827').text(value);
    y += 18;
  };

  drawField('EMPRESA', empresaVal);

  const fechaEntrada = quote?.note?.fecha || quote?.fecha;
  const fechaFmt = fmtLongDateES(fechaEntrada);
  drawField('FECHA', fechaFmt);

  if (quote.note?.descripcion) {
    doc.font('Helvetica-Bold').fontSize(10).text('DESCRIPCIÓN: ', xMargin, y, { continued: true });
    doc.font('Helvetica').fontSize(10).text(upperES(String(quote.note.descripcion)));
    y += 18;
  }

  // Frase entre comillas
  y += 6;
  doc.font('Helvetica-Oblique').fontSize(10).fillColor('#374151')
     .text('“Para su consideración, remitimos la presente cotización con el detalle de los servicios solicitados.”', xMargin, y, { width: usableW });
  doc.fillColor('black');

  // ===== TABLA =====
  y = doc.y + 28;

  const cols = [
    { key:'cantidad',    label:'CANTIDAD',      w: usableW * 0.18, align:'center' },
    { key:'detalle',     label:'DESCRIPCIÓN',   w: usableW * 0.56, align:'left'   },
    { key:'subtotal_bs', label:'SUBTOTAL (Bs)', w: usableW * 0.26, align:'center' },
  ];
  const tableX = xMargin;
  const tableW = cols.reduce((a,c)=>a+c.w,0);
  const headerH = 26;

  doc.save();
  doc.rect(tableX, y, tableW, headerH).fill('#f3f4f6');
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10);
  {
    let cx = tableX + 10;
    for (const cdef of cols){
      doc.text(cdef.label, cx, y + (headerH-12)/2, { width: cdef.w-20, align: 'center' });
      cx += cdef.w;
    }
  }
  {
    let tx = tableX;
    for (const cdef of cols){
      doc.rect(tx, y, cdef.w, headerH).strokeColor('#000').lineWidth(0.5).stroke();
      tx += cdef.w;
    }
  }
  doc.restore();
  y += headerH;

  const ensureSpace = (need = 100) => {
    if (y + need > (pageH - 64)){
      doc.addPage();
      y = 42;

      // Repetimos watermark y logo Publicom (igual al base)
      if (watermarkPath){
        doc.save();
        doc.opacity(0.06);
        const mw = 460;
        const mx = (pageW - mw) / 2;
        const my = (pageH - mw * 0.45) / 2 + BG_Y_SHIFT;
        try { doc.image(watermarkPath, mx, my, { width: mw }); } catch {}
        doc.restore();
      }
      if (logoPath){
        try { doc.image(logoPath, pageW - xMargin - 100, 28, { width: 100 }); } catch {}
      }

      // Encabezado de tabla
      doc.save();
      doc.rect(tableX, y, tableW, headerH).fill('#f3f4f6');
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10);
      let cx = tableX + 10;
      for (const cdef of cols){
        doc.text(cdef.label, cx, y + (headerH-12)/2, { width: cdef.w-20, align: 'center' });
        cx += cdef.w;
      }
      let tx = tableX;
      for (const cdef of cols){
        doc.rect(tx, y, cdef.w, headerH).strokeColor('#000').lineWidth(0.5).stroke();
        tx += cdef.w;
      }
      doc.restore();
      y += headerH;
    }
  };

  const rowPadV = 8;
  const minRowH = 22;
  doc.fontSize(10).fillColor('black');

  let totalSumaBs  = 0;

  for (const itRaw of (quote.items || [])){
    const cant    = Number(itRaw.cantidad || 0);
    const detalle = String(itRaw.nombre || '');
    const lineAmount = Number(itRaw.subtotal_bs || 0);
    totalSumaBs += lineAmount;

    const cellTexts = [ isFinite(cant) ? String(cant) : '', detalle, money(lineAmount) ];

    const cellHeights = [];
    for (let i=0; i<cols.length; i++){
      const w = cols[i].w - 20;
      const h = doc.heightOfString(cellTexts[i], { width: w, align: cols[i].align });
      cellHeights.push(Math.max(h + rowPadV*2, minRowH));
    }
    const rowH = Math.max(...cellHeights);
    ensureSpace(rowH + 10);

    // zebra
    doc.save();
    doc.rect(tableX, y, tableW, rowH).fillOpacity(0.04).fill('#6b7280').fillOpacity(1);
    doc.restore();

    // celdas
    let tx = tableX;
    for (let i=0; i<cols.length; i++){
      const cdef = cols[i];
      const innerX = tx + 10;
      const innerW = cdef.w - 20;
      doc.rect(tx, y, cdef.w, rowH).strokeColor('#000').lineWidth(0.5).stroke();
      doc.fillColor('#111827')
         .font(i===1 ? 'Helvetica-Bold' : 'Helvetica')
         .text(cellTexts[i], innerX, y + rowPadV, { width: innerW, align: cdef.align });
      tx += cdef.w;
    }
    y += rowH;
  }

  // TOTAL
  const totalBs = Number(quote.total_bs || totalSumaBs);

  ensureSpace(54);
  doc.moveTo(tableX, y).lineTo(tableX + tableW, y).strokeColor('#000').lineWidth(0.5).stroke();
  const totalRowH = 28;

  const leftW = cols[0].w + cols[1].w;
  const rightW= cols[2].w;

  doc.font('Helvetica-Bold').fillColor('#111827');
  doc.rect(tableX, y, leftW, totalRowH).strokeColor('#000').lineWidth(0.5).stroke();
  doc.text('TOTAL (Bs)', tableX, y + 7, { width: leftW, align: 'center' });

  doc.save();
  doc.rect(tableX + leftW, y, rightW, totalRowH).fill('#fde68a');
  doc.restore();
  doc.rect(tableX + leftW, y, rightW, totalRowH).strokeColor('#000').lineWidth(0.5).stroke();
  doc.text(`Bs ${money(totalBs)}`, tableX + leftW, y + 7, { width: rightW, align: 'center' });

  doc.end();
  await new Promise((res, rej)=>{ stream.on('finish', res); stream.on('error', rej); });
  return outPath;
}

// ========= API para el bot =========
export async function sendEcoRuralQuotePDF(userId, session){
  const items = Array.isArray(session?.vars?.cart) ? session.vars.cart.map(it => ({
    nombre:      String(it?.nombre ?? ''),
    cantidad:    Number(it?.cantidad ?? 0),
    subtotal_bs: Number(it?.subtotal_bs ?? 0)
  })) : [];

  const quote = {
    cliente: { nombre: session?.profileName || '' },
    items,
    note: {
      fecha:        session?.note?.fecha || null,
      descripcion:  session?.note?.descripcion || ''
    },
    total_bs: Number(session?.note?.total_bob ?? 0)
  };

  const outDir = path.resolve('tmp/pdf');
  try { fs.mkdirSync(outDir, { recursive:true }); } catch {}
  const outPath = path.join(outDir, `eco-quote-${userId}-${Date.now()}.pdf`);

  return renderEcoQuotePDF(quote, outPath);
}
