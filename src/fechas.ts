// Fechas con zona horaria (America/Lima por defecto). Nunca toISOString().slice: da UTC.

const dos = (n: number) => String(n).padStart(2, '0');

function partes(d: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return { a: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour!, min: +p.minute!, s: +p.second! };
}

/** "2026-10-21T18:05:07-05:00": la hora local de `tz` con su desfase. */
export function fechaLocal(d: Date, tz: string): string {
  const x = partes(d, tz);
  const desfase = Math.round((Date.UTC(x.a, x.m - 1, x.d, x.h, x.min, x.s) - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  const signo = desfase < 0 ? '-' : '+';
  const abs = Math.abs(desfase);
  return `${x.a}-${dos(x.m)}-${dos(x.d)}T${dos(x.h)}:${dos(x.min)}:${dos(x.s)}${signo}${dos(Math.floor(abs / 60))}:${dos(abs % 60)}`;
}

/** "2026-10-21 1805": para nombres de archivo. */
export function sello(d: Date, tz: string): string {
  const x = partes(d, tz);
  return `${x.a}-${dos(x.m)}-${dos(x.d)} ${dos(x.h)}${dos(x.min)}`;
}
