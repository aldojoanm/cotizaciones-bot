// quote-engine.js — súper simple (sin catálogo, sin unidades especiales)
function asMoney(n){
  const x = Number(n||0);
  return Math.round(x * 100) / 100;
}
function parseQty(q){
  if (typeof q === 'number') return isFinite(q) ? q : 0;
  const m = String(q||'').match(/[\d.,]+/);
  return m ? Number(m[0].replace(',','.')) || 0 : 0;
}

// quote-engine.js — Construye la “quote” usando SUBTOTAL por línea (sin multiplicar)
export function buildQuoteFromSession(s){
  const now = new Date();
  const nombre = s.profileName || '';
  const itemsRaw = (s?.vars?.cart || []);

  const items = [];
  let totalBs = 0;

  for (const it of itemsRaw){
    const qty   = Number(it?.cantidad ?? 0);
    const name  = String(it?.nombre ?? '');
    const line  = Number(it?.subtotal_bs ?? it?.line_bob ?? 0); // “lo que sale” por esa línea

    totalBs += line;

    items.push({
      nombre: name,
      cantidad: qty,
      precio_bs: 0,
      subtotal_bs: Math.round((line || 0) * 100) / 100
    });
  }

  totalBs = Math.round(totalBs * 100) / 100;

  return {
    id: `COT-${Date.now()}`,
    fecha: now,
    cliente: { nombre },
    items,
    subtotal_bs: totalBs,
    total_bs: totalBs,
    moneda: 'BOB',
    note: s?.note || {}
  };
}
