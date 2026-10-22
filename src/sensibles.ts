// Datos de pacientes que el vault no guarda. Copia literal de los patrones de
// obsidian-knowledge-terminal/scripts/lib/sensibles.mjs (una prueba vigila que coincidan).

export interface Sensible {
  re: RegExp;
  que: string;
}

export const SENSIBLES: Sensible[] = [
  { re: /\bDNI\b\D{0,6}\d{8}\b/i, que: 'un DNI' },
  { re: /\b(historia\s+cl[ií]nica|H\.?\s?C\.?)\s*(n[°ºo.]*\s*)?:?\s*\d{4,}/i, que: 'un número de historia clínica' },
  { re: /(?<!\d|\d[.,])9\d{8}(?!\d|[.,]\d)/, que: 'un número de celular' },
  { re: /\b[Pp]aciente\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+/, que: 'el nombre de un paciente' },
];

export function patronSensible(texto: string): Sensible | null {
  return SENSIBLES.find((s) => s.re.test(texto)) ?? null;
}
