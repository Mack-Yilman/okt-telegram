/**
 * Comparación en tiempo constante: se comparan los SHA-256 (igual longitud) byte a byte con XOR.
 * No usa crypto.subtle.timingSafeEqual porque es una extensión de Workers que Node (vitest) no tiene.
 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let dif = 0;
  for (let i = 0; i < x.length; i++) dif |= x[i]! ^ y[i]!;
  return dif === 0;
}

/** Token de «Authorization: Bearer <token>». */
export function bearer(req: Request): string {
  return /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]?.trim() ?? '';
}
