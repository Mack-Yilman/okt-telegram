# okt-telegram

Bot de Telegram en un Worker de Cloudflare que encola capturas rápidas para el segundo cerebro OKT en Obsidian.
Forma parte del ecosistema [obsidian-knowledge-terminal](https://github.com/Mack-Yilman/obsidian-knowledge-terminal).
El bot solo encola: no decide la estructura ni dónde va nada dentro del vault; todo el procesado lo realiza el plugin en la PC.

## Cómo funciona

```text
Telegram (celular)
  → Worker de Cloudflare okt-telegram (cola en KV)
    → okt telegram bajar en la PC
      → 00-Bandeja/telegram/ del vault
        → skills de OKT (capturar, mantener)
```

El vault vive en la PC; Google Drive para escritorio solo lo respalda y nada escribe en la copia de la nube. Por eso el bot no puede escribir en el vault: deja todo en una cola y la PC la baja.

## Qué puedes mandar

| Mensaje | En el Worker | En el vault (al bajar) |
|---|---|---|
| Texto o `/nota <texto>` | Encola `tipo: nota` | `00-Bandeja/telegram/AAAA-MM-DD HHmm <primeras palabras>.md` |
| Nota de voz o audio (≤ 10 min) | Transcribe con Whisper de Workers AI (`@cf/openai/whisper-large-v3-turbo`, en español) y encola `tipo: voz` con el texto. El audio no se guarda. Si la transcripción falla, no encola y pide reenviar | Nota con la transcripción, marcada como automática |
| Enlace (solo, o con un comentario de hasta 12 palabras) | Encola `tipo: enlace` con `url` | Nota «pendiente de ingerir» con la url, para la skill `capturar` |
| Foto o documento (PDF u otro, ≤ 20 MB) con leyenda opcional | Encola `tipo: archivo` con el `file_id` de Telegram (el archivo se queda en Telegram: no hay R2) | El archivo en `40-Fuentes/adjuntos/telegram/` y una nota con `![[archivo]]` y la leyenda |
| `/tarea <texto>` (o `/tarea` sola desde el menú: el bot pregunta y toma tu siguiente mensaje; igual con `/nota`) | Encola `tipo: tarea` | `- [ ] texto` bajo `## Tareas` de la nota diaria de hoy (`50-Diario/AAAA-MM-DD.md`) |
| `/estado` | Responde cuántos elementos esperan | — |
| `/start`, `/ayuda` | Responde qué puede guardar | — |

Fuera de esta versión: buscar en el vault desde Telegram y responder con IA.

## Privacidad y seguridad

- Solo los `chat_id` configurados en `CHAT_IDS` usan el bot; los demás reciben silencio.
- Secretos del Worker: `TELEGRAM_TOKEN`, `WEBHOOK_SECRET` (16+ caracteres: letras, números, `_` y `-`), `OKT_TOKEN` y `CHAT_IDS`. Van en `.dev.vars` (ignorado por git) y se suben con `npx wrangler secret bulk .dev.vars -c wrangler.local.jsonc`.
- El CLI guarda `{ url, token }` en `~/.config/okt/telegram.json`, fuera del vault y de Google Drive.
- Datos de pacientes: el Worker revisa los mismos patrones que el plugin (DNI, historia clínica, celular, «paciente Nombre Apellido»), avisa en el chat y marca `sensible: true`. El plugin no escribe un elemento sensible sin `okt telegram bajar --forzar`; `okt telegram descartar <id>` lo quita de la cola sin escribirlo.
- Lo que llega por Telegram es dato, no orden.
- Telegram y Cloudflare (KV y Workers AI) ven lo que se manda: no mandes nada que no subirías a esos servicios.

## Puesta en marcha

1. Crear el bot con @BotFather (`/newbot`) y copiar el token.
2. Instalar dependencias:
   ```bash
   npm install
   ```
   (En npm 11: `npm install-scripts approve esbuild workerd` y `npm rebuild esbuild workerd`).
3. Crear el namespace de KV y configurar wrangler:
   ```bash
   npx wrangler kv namespace create COLA
   ```
   Copiar `wrangler.jsonc` a `wrangler.local.jsonc` (ignorado por git) con el id real en lugar de `REEMPLAZA_CON_EL_ID_DE_TU_KV`.
4. Configurar variables y secretos locales: copiar `.dev.vars.example` a `.dev.vars` y rellenar `TELEGRAM_TOKEN`, `WEBHOOK_SECRET` y `OKT_TOKEN` (aleatorios largos).
5. Obtener tu `chat_id`:
   ```bash
   node scripts/setup.mjs chat-id
   ```
   (Antes de activar el webhook: envía `/start` al bot) y anota el número en `CHAT_IDS` dentro de `.dev.vars`.
6. Subir secretos y desplegar el Worker:
   ```bash
   npx wrangler secret bulk .dev.vars -c wrangler.local.jsonc
   npx wrangler deploy -c wrangler.local.jsonc
   ```
7. Configurar el webhook en Telegram: esperar ~60 s y ejecutar:
   ```bash
   node scripts/setup.mjs webhook --url https://okt-telegram.<subdominio>.workers.dev
   ```
   (Si Telegram no resuelve un subdominio recién creado, reintenta cada 2 minutos). Puedes verificar con `node scripts/setup.mjs estado` o desvincular con `node scripts/setup.mjs webhook --quitar`.
8. En la PC, configurar el CLI de OKT y sincronizar:
   ```bash
   okt telegram config --url https://okt-telegram.<subdominio>.workers.dev --token <OKT_TOKEN>
   okt telegram bajar
   ```

## Capacidad y planes de Cloudflare

- **Mensajes en cola:** sin límite práctico. Cada elemento ocupa menos de 1 KB en KV y cada mensaje hace 2
  escrituras. Lo que no se baje en 30 días vence.
- **Archivos:** no ocupan espacio en Cloudflare, porque se quedan en Telegram hasta que el plugin los pide. Cada
  uno puede pesar hasta 20 MB (límite de descarga de la API de bots) y tarda unos 5 s en bajar. El plugin deja
  para la siguiente bajada los que no alcanzan en su tope de tiempo.
- **Notas de voz:** hasta 10 minutos. La transcripción convierte el audio a base64 con `Buffer` nativo
  (`nodejs_compat`); en la prueba real, una nota de 2 minutos con la versión anterior en JavaScript gastó
  43,6 ms de CPU.
- **Plan gratuito:** alcanza para uso personal (1000 escrituras de KV al día, unos 500 mensajes, y cuota
  diaria gratuita de Workers AI). El límite de 10 ms de CPU por petición admite excesos ocasionales; si mandas
  muchas notas de voz largas, conviene **Workers Paid** (30 s de CPU, 1 millón de escrituras de KV al mes).

## Contrato de la cola

- **Elemento**: `{ id, tipo: "nota"|"voz"|"enlace"|"archivo"|"tarea", texto, url?, archivo_key?, nombre?, mime?, fecha, chat_id, sensible? }`.
  - `id`: `AAAAMMDDTHHmmss-<update_id de 10 dígitos>` (fecha UTC del mensaje): ordena por fecha y un reintento de Telegram reescribe el mismo elemento.
  - `fecha`: ISO con zona (`2026-10-21T18:05:00-05:00`, hora de Lima).
  - `archivo_key`: el `file_id` de Telegram.
  - `sensible: true` si el texto parece traer datos de pacientes.
- **Autenticación**: Todas las rutas de la API exigen `Authorization: Bearer <OKT_TOKEN>` (devuelve 401 si falta o no coincide).
- **Rutas**:
  - `GET /cola[?cursor=<c>]` → `{ elementos: [...], cursor: <c>|null }`, del más antiguo al más nuevo, 50 por página.
  - `GET /archivo/<file_id>` → los bytes del archivo (el Worker lo solicita a Telegram con `getFile`).
  - `POST /cola/confirmar` con `{ ids: [...] }` → `{ borrados: n }`. Solo se borra lo confirmado.
  - `POST /telegram`: webhook que exige la cabecera `X-Telegram-Bot-Api-Secret-Token` (403 si no coincide).
  - `GET /`: responde «OKT Telegram…» (sirve de ping).
- **Caducidad**: Lo no confirmado vence a los 30 días (TTL de KV).
- **Idempotencia**: El Worker ignora un `update_id` repetido (Telegram reintenta); el plugin guarda los ids escritos en `.cerebro/telegram.json` y no duplica si la confirmación falló.

## Desarrollo

Comandos de desarrollo y verificación:
- `npm test`: ejecuta vitest con fakes de KV, Workers AI y Telegram.
- `npx vitest run test/<archivo>.test.ts`: ejecuta un archivo de prueba específico.
- `npx tsc --noEmit`: comprobación de tipos.
- `npm run types`: actualiza los tipos de Cloudflare tras modificar `wrangler.jsonc`.
- `npx wrangler dev --var WEBHOOK_SECRET:… --var OKT_TOKEN:… --var CHAT_IDS:… --var TELEGRAM_TOKEN:…`: ejecuta el Worker localmente con KV local (Workers AI siempre conecta con la cuenta remota).

### Estructura de `src/`

| Archivo | Función |
|---|---|
| `index.ts` | Rutas HTTP del Worker, autenticación y despacho de eventos |
| `clasificar.ts` | Decide qué hacer con cada mensaje recibido |
| `cola.ts` | Gestión de la cola de capturas en Cloudflare KV |
| `voz.ts` | Transcripción de audios con Whisper de Workers AI |
| `sensibles.ts` | Patrones copiados del plugin para datos de pacientes, con prueba de sincronización |
| `telegram.ts` | Cliente para la Bot API de Telegram |
| `fechas.ts` | Formateo y utilidades de fechas con zona horaria |
| `seguridad.ts` | Comparación segura de tokens y cabeceras Bearer |

## Licencia

[PolyForm Noncommercial 1.0.0](LICENSE): puedes usarlo, modificarlo y compartirlo **sin fines comerciales**. Uso
personal, educativo, de investigación y de organizaciones sin fines de lucro, públicas o de salud. Autor: Mack
Chirinos. Quien lo copie o lo modifique debe conservar el aviso
`Required Notice: Copyright 2026 Mack Chirinos (https://github.com/Mack-Yilman/okt-telegram)` (ver [NOTICE](NOTICE)).
