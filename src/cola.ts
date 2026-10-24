// La cola en KV. Cada elemento es una clave «cola:<id>» con caducidad de 30 días; KV lista las claves
// en orden lexicográfico, y el id empieza por la fecha UTC del mensaje, así que listar ya da el orden
// cronológico sin un índice aparte que se pueda desincronizar. El id sale del mensaje (fecha y
// update_id), así que un reintento de Telegram reescribe la misma clave en vez de duplicarla.

export type Tipo = 'nota' | 'voz' | 'enlace' | 'archivo' | 'tarea';

export interface Elemento {
  id: string;
  tipo: Tipo;
  texto: string;
  url?: string;
  archivo_key?: string;
  nombre?: string;
  mime?: string;
  fecha: string;
  chat_id: string;
}

const PREFIJO = 'cola:';
const TTL_COLA = 30 * 86400;
const TTL_VISTO = 86400;
const ID_VALIDO = /^\d{8}T\d{6}-\d{10}$/;

const dos = (n: number) => String(n).padStart(2, '0');

/** "20261021T230500-0000000007" a partir de la fecha Unix del mensaje y el update_id. */
export function idDe(fechaUnix: number, updateId: number): string {
  const d = new Date(fechaUnix * 1000);
  const f = `${d.getUTCFullYear()}${dos(d.getUTCMonth() + 1)}${dos(d.getUTCDate())}T${dos(d.getUTCHours())}${dos(d.getUTCMinutes())}${dos(d.getUTCSeconds())}`;
  return `${f}-${String(updateId).padStart(10, '0')}`;
}

export async function encolar(kv: KVNamespace, el: Elemento): Promise<void> {
  await kv.put(PREFIJO + el.id, JSON.stringify(el), { expirationTtl: TTL_COLA });
}

export async function listar(kv: KVNamespace, cursor: string | null = null, limite = 50): Promise<{ elementos: Elemento[]; cursor: string | null }> {
  const r = await kv.list({ prefix: PREFIJO, limit: limite, ...(cursor ? { cursor } : {}) });
  const valores = await Promise.all(r.keys.map((k) => kv.get<Elemento>(k.name, 'json')));
  // Un elemento confirmado o vencido entre list y get se omite.
  const elementos = valores.filter((v): v is Elemento => v !== null);
  return { elementos, cursor: r.list_complete ? null : r.cursor };
}

export async function contar(kv: KVNamespace): Promise<number> {
  let total = 0;
  let cursor: string | undefined;
  do {
    const r = await kv.list({ prefix: PREFIJO, ...(cursor ? { cursor } : {}) });
    total += r.keys.length;
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return total;
}

/** Borra los elementos confirmados. Solo acepta ids con el formato de la cola. */
export async function confirmar(kv: KVNamespace, ids: string[]): Promise<number> {
  const validos = [...new Set(ids)].filter((id) => ID_VALIDO.test(id));
  const existentes = await Promise.all(validos.map(async (id) => ((await kv.get(PREFIJO + id)) !== null ? id : null)));
  const borrar = existentes.filter((id): id is string => id !== null);
  await Promise.all(borrar.map((id) => kv.delete(PREFIJO + id)));
  return borrar.length;
}

export async function yaVisto(kv: KVNamespace, updateId: number): Promise<boolean> {
  return (await kv.get(`visto:${updateId}`)) !== null;
}

export async function marcarVisto(kv: KVNamespace, updateId: number): Promise<void> {
  await kv.put(`visto:${updateId}`, '1', { expirationTtl: TTL_VISTO });
}
