# Checklist de seguridad

## Revisión completada

- [x] El backend no recibe títulos, contenido ni contraseñas adicionales.
- [x] MongoDB almacena notas únicamente como blobs cifrados.
- [x] `masterKey`, `userKey` y `noteKey` descifradas permanecen en RAM.
- [x] `localStorage` contiene solo preferencias visuales.
- [x] IndexedDB contiene una clave no exportable y `masterKey` cifrada.
- [x] Cookies de producción: `__Host-`, Secure, HTTP-only, SameSite y firmadas.
- [x] Mutaciones protegidas contra CSRF mediante validación de mismo origen.
- [x] Auth y APIs protegidas con rate limiting.
- [x] Registro aplica cooldown de reenvío.
- [x] Códigos de verificación tienen expiración y límite de intentos.
- [x] Zod rechaza campos desconocidos y payloads cifrados inválidos.
- [x] Preview Markdown sanitizado antes de renderizar HTML.
- [x] Headers anti-XSS, anti-framing, HSTS, nosniff y permissions policy.
- [x] Logger estructurado redacta campos sensibles.
- [x] Errores inesperados no muestran stack en producción.
- [x] Búsqueda y resaltado ocurren exclusivamente en memoria.
- [x] Tests unitarios cubren primitivas crypto, auth, CSRF y rate limiting.

## Hallazgos y resolución

### CSRF

Antes no existía validación explícita. Todas las mutaciones ahora verifican
`Origin` y `Sec-Fetch-Site`. Las sesiones mantienen `SameSite=Lax` como defensa
adicional.

### XSS y Markdown

El preview Markdown ahora usa `rehype-sanitize`. React escapa títulos y snippets.
Se eliminó el script inline manual de tema. La CSP limita recursos, framing,
objetos y conexiones.

### Secretos y logs

No se encontraron logs existentes con passwords, códigos o claves. El logger
nuevo redacta nombres sensibles y limita tamaño/profundidad. Resend ya no
propaga detalles internos al cliente.

### Almacenamiento

No se encontraron claves E2EE en `localStorage` o `sessionStorage`. IndexedDB
se usa deliberadamente para recuperación local y no contiene una `masterKey`
plana.

## Recomendaciones futuras

1. Reemplazar rate limiting en memoria por Redis/KV con operaciones atómicas.
2. Implementar nonce CSP por request y retirar `script-src 'unsafe-inline'`.
3. Añadir límites de body y timeout en reverse proxy/CDN.
4. Añadir rotación de `SESSION_SECRET` soportando secreto actual y anterior.
5. Añadir expiración absoluta/idle de sesión y pantalla de dispositivos activos.
6. Integrar SIEM/observabilidad con retención limitada y alertas de auth.
7. Ejecutar `pnpm audit`, SAST, secret scanning y DAST en CI.
8. Añadir tests de integración con MongoDB efímero y pruebas E2E de navegador.
9. Añadir WebAuthn/passkeys para recuperación protegida de la bóveda.
10. Definir CSP sin Google Fonts o servir fuentes desde el mismo origen.

