import { describe, expect, it } from 'vitest';
import { confirmar, contar, encolar, idDe, listar, marcarVisto, yaVisto, type Elemento } from '../src/cola';
import { fechaLocal } from '../src/fechas';
import { fakeKv } from './fakes';

const kvDe = (kv: ReturnType<typeof fakeKv>) => kv as unknown as KVNamespace;

const el = (id: string, texto = 'x'): Elemento => ({ id, tipo: 'nota', texto, fecha: '2026-10-21T18:05:00-05:00', chat_id: '111' });

describe('fechas', () => {
  it('da la hora de Lima con su zona', () => {
    expect(fechaLocal(new Date(Date.UTC(2026, 9, 21, 23, 5, 7)), 'America/Lima')).toBe('2026-10-21T18:05:07-05:00');
    expect(fechaLocal(new Date(Date.UTC(2026, 9, 22, 2, 0, 0)), 'America/Lima')).toBe('2026-10-21T21:00:00-05:00');
  });
});

describe('cola', () => {
  it('el id ordena por fecha del mensaje y es estable ante reintentos', () => {
    const a = idDe(Date.UTC(2026, 9, 21, 23, 5, 0) / 1000, 7);
    expect(a).toBe('20261021T230500-0000000007');
    expect(idDe(Date.UTC(2026, 9, 21, 23, 5, 0) / 1000, 7)).toBe(a);
    expect(idDe(Date.UTC(2026, 9, 21, 23, 6, 0) / 1000, 3) > a).toBe(true);
  });

  it('encola con caducidad de 30 días y lista del más antiguo al más nuevo', async () => {
    const kv = fakeKv();
    await encolar(kvDe(kv), el('20261021T230600-0000000002', 'segundo'));
    await encolar(kvDe(kv), el('20261021T230500-0000000001', 'primero'));
    expect(kv.m.get('cola:20261021T230500-0000000001')?.ttl).toBe(30 * 86400);
    const r = await listar(kvDe(kv));
    expect(r.elementos.map((e) => e.texto)).toEqual(['primero', 'segundo']);
    expect(r.cursor).toBeNull();
  });

  it('pagina con cursor', async () => {
    const kv = fakeKv();
    for (let i = 1; i <= 5; i++) await encolar(kvDe(kv), el(`20261021T23050${i}-000000000${i}`));
    const p1 = await listar(kvDe(kv), null, 2);
    expect(p1.elementos).toHaveLength(2);
    const p2 = await listar(kvDe(kv), p1.cursor, 2);
    const p3 = await listar(kvDe(kv), p2.cursor, 2);
    expect([...p1.elementos, ...p2.elementos, ...p3.elementos].map((e) => e.id)).toHaveLength(5);
    expect(p3.cursor).toBeNull();
    expect(await contar(kvDe(kv))).toBe(5);
  });

  it('confirmar borra solo ids válidos de la cola', async () => {
    const kv = fakeKv();
    await encolar(kvDe(kv), el('20261021T230500-0000000001'));
    await encolar(kvDe(kv), el('20261021T230600-0000000002'));
    await marcarVisto(kvDe(kv), 9);
    const borrados = await confirmar(kvDe(kv), ['20261021T230500-0000000001', '../visto:9', 'visto:9', 'inexistente']);
    expect(borrados).toBe(1);
    expect(kv.m.has('cola:20261021T230600-0000000002')).toBe(true);
    expect(await yaVisto(kvDe(kv), 9)).toBe(true);
  });

  it('recuerda un update_id visto un día', async () => {
    const kv = fakeKv();
    expect(await yaVisto(kvDe(kv), 5)).toBe(false);
    await marcarVisto(kvDe(kv), 5);
    expect(await yaVisto(kvDe(kv), 5)).toBe(true);
    expect(kv.m.get('visto:5')?.ttl).toBe(86400);
  });
});
