# Notas privadas

Aplicación SSR E2EE construida con React Router 7, React 19, TypeScript,
Tailwind CSS 4 y MongoDB. El servidor autentica usuarios y almacena blobs
cifrados; títulos, contenidos, contraseñas adicionales y claves descifradas
nunca se envían al backend.

## Funcionalidad

- Registro, verificación de email, login y sesiones HTTP-only.
- Bóveda E2EE con `masterKey` aleatoria protegida por la contraseña de login.
- CRUD de notas cifradas con AES-GCM.
- Protección opcional por nota mediante contraseña adicional.
- Editor/preview Markdown sanitizado.
- Búsqueda de título y contenido mediante índice temporal en RAM.
- Rate limiting, protección CSRF por origen, headers de seguridad y logging
  estructurado con redacción.

## Arquitectura de seguridad

```text
password login -> PBKDF2-SHA-256 -> userKey -> masterKey cifrada
masterKey -> títulos/contenidos de notas normales
password adicional -> PBKDF2-SHA-256 -> extraPasswordKey -> noteKey
noteKey -> título/contenido de nota protegida
```

MongoDB almacena únicamente ciphertext, IVs, salts y metadatos. La recuperación
tras recarga usa IndexedDB para guardar una clave de dispositivo no exportable
y una copia cifrada de la `masterKey`. No se guardan claves descifradas en
`localStorage`, `sessionStorage` o MongoDB.

Consulta [docs/encryption-architecture.md](docs/encryption-architecture.md) y
[docs/security-checklist.md](docs/security-checklist.md).

## Requisitos

- Node.js 24
- pnpm
- MongoDB con autenticación y TLS en producción
- Dominio verificado en Resend
- HTTPS en producción

## Variables de entorno

```env
MONGODB_URI=mongodb://localhost:27017/notes
SESSION_SECRET=replace-with-at-least-32-random-characters
TOTP_ENCRYPTION_KEY=replace-with-32-random-bytes-in-base64-or-64-hex-characters
APP_ORIGIN=https://notes.example.com
RESEND_API_KEY=re_replace_me
RESEND_FROM_EMAIL=Notas privadas <notes@example.com>
```

Genera `SESSION_SECRET` y `TOTP_ENCRYPTION_KEY` con un CSPRNG y gestiona secretos mediante el proveedor
de despliegue. Nunca incluyas `.env` en imágenes, logs o control de versiones.

## Desarrollo

```bash
pnpm install
pnpm run dev
```

## Verificación

```bash
pnpm test
pnpm run typecheck
pnpm run build
```

## Producción

1. Configura `NODE_ENV=production` y todas las variables requeridas.
2. Sirve exclusivamente detrás de HTTPS.
3. Configura límite de body en proxy de aproximadamente 9 MB.
4. Configura `APP_ORIGIN` con el origen HTTPS público. Asegura que el proxy
   sobrescriba `X-Forwarded-For`, `X-Forwarded-Host` y `X-Forwarded-Proto`; no
   aceptes esos headers directamente desde internet.
5. Para múltiples instancias, reemplaza el rate limiter en memoria por Redis/KV.
6. Restringe MongoDB por red, usuario mínimo necesario, TLS y backups cifrados.
7. Ejecuta tests, typecheck, build y auditoría de dependencias en CI.

La cookie de producción usa prefijo `__Host-`, `Secure`, `HttpOnly`,
`SameSite=Lax` y `Path=/`.

## Controles implementados

- Zod valida auth, envelopes de bóveda y payloads cifrados estrictos.
- Mutaciones validan `Origin`/`Sec-Fetch-Site` contra el mismo origen.
- Rate limits para login, registro, verificación, bóveda y notas.
- Códigos de email expiran en 15 minutos, permiten máximo 5 intentos y tienen
  cooldown de reenvío de 60 segundos.
- Markdown pasa por `rehype-sanitize`.
- CSP, HSTS, anti-framing, `nosniff`, referrer y permissions policy.
- Logger JSON redacta campos sensibles y evita registrar emails/passwords.
- Mensajes de login no distinguen usuario inexistente de contraseña incorrecta.

## Rutas

- `/auth/register`
- `/auth/login`
- `/auth/verify-email`
- `/auth/2fa`
- `/auth/2fa/confirm`
- `/auth/logout`
- `/app`
- `/settings/security`
- `/api/notes`
- `/api/notes/:noteId`
- `/api/vault`
- `/api/2fa/confirm-action`

## Limitaciones conocidas

- El rate limiter actual es por proceso; no coordina múltiples réplicas.
- La CSP permite scripts inline porque React Router inyecta datos de hidratación.
  Debe migrarse a nonces por request para retirar `'unsafe-inline'`.
- Olvidar una contraseña adicional hace irrecuperable la nota protegida.
- Un navegador comprometido mientras la bóveda está abierta puede leer memoria;
  E2EE no protege contra XSS ejecutándose en el origen ni malware local.
