# Arquitectura de cifrado

## Jerarquía de claves

```text
password de login
  -> PBKDF2-SHA-256 (salt único, 250,000 iteraciones)
  -> userKey
  -> descifra masterKey
  -> masterKey cifra títulos y contenidos
```

`userKey` solo existe durante registro o login. `masterKey` aleatoria es la
única clave usada para cifrar notas versión 2.

## Protección adicional por nota

Una nota normal continúa cifrada directamente con `masterKey`. Al activar una
contraseña adicional, el cliente genera una `noteKey` aleatoria y recifra tanto
el título como el contenido:

```text
contraseña adicional
  -> PBKDF2-SHA-256 (salt único, 250,000 iteraciones)
  -> extraPasswordKey
  -> descifra noteKey
  -> noteKey cifra título y contenido
```

La `noteKey` protegida no se envuelve también con `masterKey`; hacerlo permitiría
evitar la contraseña adicional. La contraseña y las claves descifradas solo
existen en memoria. Si se olvida la contraseña adicional, esa nota no puede
recuperarse.

## Datos persistidos

El documento `users` almacena, además de autenticación:

```text
encryptedMasterKey
masterKeyIv
kdfSalt
iterations
encryptionVersion
```

El documento `notes` versión 2 almacena:

```text
userId
encryptedTitle
encryptedContent
titleIv
contentIv
encryptionVersion
pinned
archived
hasExtraPassword
extraPasswordSalt
extraPasswordEncryptedNoteKey
extraPasswordNoteKeyIv
createdAt
updatedAt
```

Los cuatro campos de protección adicional solo se incluyen cuando está activa.
El backend nunca recibe contraseñas, `userKey`, `masterKey`, `noteKey`, títulos
ni contenidos planos. Cambiar o quitar la contraseña requiere la contraseña
adicional actual y todo el recifrado ocurre en el navegador.

## Búsqueda local

La búsqueda no usa MongoDB ni envía consultas o texto plano al backend. Durante
la sesión, el cliente obtiene los blobs cifrados, descifra las notas normales y
crea un índice temporal de título y contenido exclusivamente en memoria RAM.
Las notas con contraseña adicional se agregan al índice solo después de ser
desbloqueadas. El índice desaparece al cerrar o recargar la aplicación.

## Recuperación durante una sesión

Para sobrevivir una recarga sin volver a pedir password, el navegador genera
una clave AES-GCM de dispositivo no exportable. IndexedDB almacena esa
`CryptoKey` no exportable y una copia cifrada de `masterKey`.

Esto es necesario porque una cookie de sesión por sí sola no puede recuperar
una clave E2EE sin entregar capacidad de descifrado al servidor. Logout elimina
el registro local. Si falta o falla, `/app` redirige al mismo login para
reautenticar; no existe una pantalla separada de desbloqueo.

`VaultRecoveryAdapter` es el punto de extensión para sustituir la recuperación
local por WebAuthn, passkeys o autenticación biométrica en una fase futura.

## Migración legacy

Usuarios sin envelope reciben uno durante su siguiente login. En cliente:

1. Se crea y persiste el envelope de `masterKey`.
2. Se identifican notas versión 1.
3. Se descifran usando la contraseña ingresada.
4. Se recifran directamente con `masterKey`.
5. Se eliminan `encryptedNoteKey`, `noteKeyIv` y `kdfSalt` de cada nota.

La migración automática requiere que la contraseña de login coincida con la
contraseña usada por la bóveda legacy. Si eran distintas, la migración no puede
completarse sin solicitar esa credencial antigua; no existe una alternativa
criptográficamente válida.

## Recuperación de acceso

La contraseña no puede recuperarse porque solo se almacena su hash. Un mensaje
de error posterior a autenticar no implica necesariamente una contraseña
incorrecta: puede indicar fallo de cookie de sesión, migración o IndexedDB.

Para desarrollo debe usarse `http://localhost:5173`. En producción se requiere
HTTPS para que la cookie `Secure` de sesión funcione. Si una cuenta no contiene
notas ni envelope de bóveda, puede inicializarse de forma segura durante el
siguiente login con su contraseña válida.
