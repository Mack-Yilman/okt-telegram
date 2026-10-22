/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SENSIBLES, patronSensible } from '../src/sensibles';

describe('patronSensible', () => {
  it.each([
    ['Paciente con DNI 45879632.', 'un DNI'],
    ['dni: 45879632', 'un DNI'],
    ['HC 123456', 'un número de historia clínica'],
    ['historia clínica n° 004512', 'un número de historia clínica'],
    ['cel 987654321', 'un número de celular'],
    ['Paciente Juan Pérez con fiebre', 'el nombre de un paciente'],
    ['Paciente JUAN PÉREZ con resultado crítico', 'el nombre de un paciente'],
  ])('detecta «%s»', (texto, que) => {
    expect(patronSensible(texto)?.que).toBe(que);
  });

  it.each(['Repasar anemia ferropénica', 'La dosis es 1.987654321 mg', 'El paciente pediátrico con fiebre', 'Año 2026, 45 pacientes'])('no marca «%s»', (texto) => {
    expect(patronSensible(texto)).toBeNull();
  });
});

// Los patrones son una copia de los del plugin OKT: si el repo hermano está al lado, deben coincidir.
const HERMANO = join(__dirname, '..', '..', 'obsidian-knowledge-terminal', 'scripts', 'lib', 'sensibles.mjs');
describe.skipIf(!existsSync(HERMANO))('sincronía con obsidian-knowledge-terminal', () => {
  it('usa los mismos patrones que sensibles.mjs', async () => {
    const plugin = (await import(pathToFileURL(HERMANO).href)) as { SENSIBLES: { re: RegExp; que: string }[] };
    expect(SENSIBLES.map((s) => [s.re.source, s.re.flags, s.que])).toEqual(plugin.SENSIBLES.map((s) => [s.re.source, s.re.flags, s.que]));
  });
});
