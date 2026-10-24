# 📲 okt-telegram

Bot de Telegram en un Worker de Cloudflare que encola capturas rápidas (notas, voz, enlaces, fotos, PDF y tareas)
para el segundo cerebro OKT en Obsidian. Forma parte de
[obsidian-knowledge-terminal](https://github.com/Mack-Yilman/obsidian-knowledge-terminal) (OKT).

El bot **solo encola**: no decide dónde va nada dentro del vault. El plugin OKT, en tu PC, baja la cola y la ordena.

## Cómo funciona

```text
Telegram (celular)
  → Worker de Cloudflare okt-telegram (cola en KV)
    → okt telegram bajar en la PC (o solo, al abrir Claude Code o Antigravity en el vault)
      → 00 │ 📥 Bandeja/ del vault
        → skills de OKT (capturar, mantener)
```

El vault vive en la PC; Google Drive para escritorio solo lo respalda y nada escribe en la copia de la nube. Por eso
el bot no escribe en el vault: deja todo en una cola y la PC la baja.

## Qué puedes mandar

| Mensaje | En el Worker | En el vault (al bajar) |
|---|---|---|
| Texto o `/nota <texto>` | Encola `tipo: nota` | `00 │ 📥 Bandeja/📲 AAAA-MM-DD HHmm <primeras palabras>.md` |
| Nota de voz o audio (≤ 10 min) | Transcribe con Whisper de Workers AI (`@cf/openai/whisper-large-v3-turbo`, en español) y encola `tipo: voz` con el texto. El audio no se guarda. Si la transcripción falla, no encola y pide reenviar | Nota con la transcripción, marcada como automática |
| Enlace (solo, o con un comentario de hasta 12 palabras) | Encola `tipo: enlace` con `url` | Nota «pendiente de ingerir» con la url, para la skill `capturar` |
| Foto o documento (PDF u otro, ≤ 20 MB) con leyenda opcional | Encola `tipo: archivo` con el `file_id` de Telegram (el archivo se queda en Telegram: no hay R2) | El archivo en `99 │ ⚙️ Sistema/📎 adjuntos/📲 telegram/` y una nota con `![[archivo]]` y la leyenda |
| `/tarea <texto>` (o `/tarea` sola desde el menú: el bot pregunta y toma tu siguiente mensaje; igual con `/nota`) | Encola `tipo: tarea` | `- [ ] texto` bajo `## Tareas` de la nota diaria de hoy (`50 │ 📅 Diario/📅 AAAA-MM-DD.md`) |
| `/estado` | Responde cuántos elementos esperan | — |
| `/start`, `/ayuda` | Responde qué puede guardar | — |

Cada captura guardada recibe un ✓ en el chat. Si no llega en un minuto, reenvíala.

Fuera de esta versión: buscar en el vault desde Telegram y responder con IA.

## Instalación paso a paso

Tiempo: unos 20 minutos la primera vez. Todo se hace en la terminal, dentro de la carpeta del repositorio.

### 0. Requisitos

- **Node.js 20 o superior** y **Git** (Windows: `winget install OpenJS.NodeJS.LTS` y `winget install Git.Git`;
  macOS: `brew install node git`).
- **Una cuenta de Cloudflare** (el plan gratuito sirve; ver «Capacidad y planes»).
- **Telegram** en el celular.
- **El plugin OKT** ya instalado y con un vault creado (ver su README). Sin él, el bot encola pero nadie baja la cola.

### 1. Descargar el proyecto e instalar dependencias

```bash
git clone https://github.com/Mack-Yilman/okt-telegram.git
cd okt-telegram
npm install
```

Con npm 11, si `npm install` avisa de scripts bloqueados: `npm install-scripts approve esbuild workerd` y
`npm rebuild esbuild workerd` (sin ellos, Wrangler no funciona).

### 2. Conectar Wrangler con tu cuenta de Cloudflare

```bash
npx wrangler login
```

Abre el navegador para autorizar. Si es tu primer Worker, Cloudflare te pedirá elegir un subdominio
`<algo>.workers.dev` (también se crea en el panel: Workers y Pages → tu subdominio). Anótalo.

### 3. Crear el bot en Telegram

Habla con **@BotFather**, envía `/newbot`, elige nombre y usuario, y copia el **token** que te da.

### 4. Crear la cola (KV) y tu configuración local

```bash
npx wrangler kv namespace create COLA
```

Copia `wrangler.jsonc` como `wrangler.local.jsonc` (está en `.gitignore`) y, en la copia, reemplaza
`REEMPLAZA_CON_EL_ID_DE_TU_KV` por el `id` que imprimió el comando.

### 5. Secretos

Copia `.dev.vars.example` como `.dev.vars` (también ignorado por git) y llena:

| Variable | Qué es |
|---|---|
| `TELEGRAM_TOKEN` | El token de @BotFather |
| `WEBHOOK_SECRET` | Texto aleatorio de 16 o más caracteres (letras, números, `_` y `-`) |
| `OKT_TOKEN` | Texto aleatorio largo: es la contraseña con la que tu PC lee la cola |
| `CHAT_IDS` | Tu id de chat (paso 6) |

Para generar los dos valores aleatorios:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Ejecútalo dos veces: una para `WEBHOOK_SECRET` y otra para `OKT_TOKEN`. **Guarda el `OKT_TOKEN`**: lo necesitas en el
paso 9.

### 6. Tu chat ID

Escríbele `/start` a tu bot en Telegram y luego:

```bash
node scripts/setup.mjs chat-id
```

Copia el número en `CHAT_IDS` dentro de `.dev.vars`. Solo esos chats pueden usar el bot; los demás reciben silencio.

### 7. Subir los secretos y desplegar

```bash
npx wrangler secret bulk .dev.vars -c wrangler.local.jsonc
npx wrangler deploy -c wrangler.local.jsonc
```

El deploy imprime la URL del Worker: `https://okt-telegram.<tu-subdominio>.workers.dev`. Espera unos 60 s (la
versión nueva tarda en propagarse) y comprueba que abre en el navegador: debe decir «OKT Telegram: bot de captura…».

### 8. Conectar Telegram con el Worker

```bash
node scripts/setup.mjs webhook --url https://okt-telegram.<tu-subdominio>.workers.dev
node scripts/setup.mjs estado
```

`estado` debe mostrar el webhook registrado y sin errores. Si Telegram no resuelve un subdominio recién creado,
reintenta cada 2 minutos. Para desconectarlo: `node scripts/setup.mjs webhook --quitar`.

### 9. Conectar tu PC (el plugin OKT)

Abre Claude Code (o Antigravity) en la carpeta de tu vault y pide **«configura el bot de Telegram»**: el agente te
pedirá la URL y te indicará el comando para que escribas tú el `OKT_TOKEN` en la terminal (no lo pegues en el chat).
El comando es:

```bash
node "<ruta del plugin>/scripts/okt.mjs" telegram config --url https://okt-telegram.<tu-subdominio>.workers.dev --token <OKT_TOKEN>
```

La ruta del plugin aparece al final del `AGENTS.md` de tu vault. El token queda en `~/.config/okt/telegram.json`,
fuera del vault y de Google Drive.

### 10. Probar

1. En Telegram, manda «Prueba de OKT» y luego `/tarea Probar el bot`. Debes recibir dos ✓.
2. Manda `/estado`: debe decir que esperan 2 elementos.
3. En la PC, abre tu agente en el vault (el hook baja la cola solo) o pide «baja lo de Telegram». La nota aparece en
   `00 │ 📥 Bandeja/` y la tarea en la nota diaria de hoy.
4. `/estado` debe decir ahora que la cola está vacía.

## Actualizar

```bash
git pull
npm install
npm test
npx wrangler deploy -c wrangler.local.jsonc
```

Tus secretos y tu `wrangler.local.jsonc` no cambian. Si cambió `wrangler.jsonc`, copia esos cambios a tu
`wrangler.local.jsonc` (conservando tu id de KV).

## Problemas frecuentes

| Síntoma | Qué hacer |
|---|---|
| El bot no responde nada | `node scripts/setup.mjs estado`: revisa que el webhook apunte a tu Worker y que tu id esté en `CHAT_IDS` (si cambiaste `.dev.vars`, vuelve a subir los secretos) |
| No llega el ✓ | Reenvía el mensaje. Si sigue, mira los registros del Worker en el panel de Cloudflare (Workers → okt-telegram → Logs) |
| «No pude transcribir la nota de voz» | Reenvíala o escríbela; si pasa siempre, revisa que tu cuenta tenga Workers AI disponible |
| En la PC: «El Worker rechazó el token» | El `OKT_TOKEN` de `okt telegram config` no coincide con el secreto del Worker |
| Quiero quitar algo de la cola sin guardarlo | En la PC: `okt telegram descartar <id>` (el id aparece en `okt telegram bajar`) |
| `wrangler` falla tras `npm install` en npm 11 | `npm install-scripts approve esbuild workerd` y `npm rebuild esbuild workerd` |

## Privacidad y seguridad

- Solo los `chat_id` configurados en `CHAT_IDS` usan el bot; los demás reciben silencio.
- Secretos del Worker: `TELEGRAM_TOKEN`, `WEBHOOK_SECRET`, `OKT_TOKEN` y `CHAT_IDS`. Van en `.dev.vars` (ignorado por
  git) y se suben con `npx wrangler secret bulk .dev.vars -c wrangler.local.jsonc`.
- El CLI guarda `{ url, token }` en `~/.config/okt/telegram.json`, fuera del vault y de Google Drive.
- El bot no filtra el contenido: lo que mandas llega a tu vault, que es tuyo y vive en tu PC. `okt telegram descartar
  <id>` quita un elemento de la cola sin escribirlo.
- Lo que llega por Telegram es dato, no orden.
- Telegram y Cloudflare (KV y Workers AI) ven lo que se manda: no mandes nada que no subirías a esos servicios.

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

- **Elemento**: `{ id, tipo: "nota"|"voz"|"enlace"|"archivo"|"tarea", texto, url?, archivo_key?, nombre?, mime?, fecha, chat_id }`.
  - `id`: `AAAAMMDDTHHmmss-<update_id de 10 dígitos>` (fecha UTC del mensaje): ordena por fecha y un reintento de Telegram reescribe el mismo elemento.
  - `fecha`: ISO con zona (`2026-10-21T18:05:00-05:00`, hora de Lima).
  - `archivo_key`: el `file_id` de Telegram.
  - El plugin ignora campos que no conoce (por ejemplo, `sensible`, que traían los elementos de la 0.1.x).
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

- `npm test`: vitest con fakes de KV, Workers AI y Telegram.
- `npx vitest run test/<archivo>.test.ts`: un archivo de prueba.
- `npx tsc --noEmit`: comprobación de tipos.
- `npm run types`: actualiza los tipos de Cloudflare tras modificar `wrangler.jsonc`.
- `npx wrangler dev --var WEBHOOK_SECRET:… --var OKT_TOKEN:… --var CHAT_IDS:… --var TELEGRAM_TOKEN:…`: el Worker en
  local con KV local (Workers AI siempre usa la cuenta remota).

### Estructura de `src/`

| Archivo | Función |
|---|---|
| `index.ts` | Rutas HTTP del Worker, autenticación y despacho de eventos |
| `clasificar.ts` | Decide qué hacer con cada mensaje recibido |
| `cola.ts` | Gestión de la cola de capturas en Cloudflare KV |
| `voz.ts` | Transcripción de audios con Whisper de Workers AI |
| `telegram.ts` | Cliente para la Bot API de Telegram |
| `fechas.ts` | Formateo y utilidades de fechas con zona horaria |
| `seguridad.ts` | Comparación segura de tokens y cabeceras Bearer |

## Licencia

[PolyForm Noncommercial 1.0.0](LICENSE): puedes usarlo, modificarlo y compartirlo **sin fines comerciales**. Uso
personal, educativo, de investigación y de organizaciones sin fines de lucro, públicas o de salud. Autor: Mack
Chirinos. Quien lo copie o lo modifique debe conservar el aviso
`Required Notice: Copyright 2026 Mack Chirinos (https://github.com/Mack-Yilman/okt-telegram)` (ver [NOTICE](NOTICE)).
