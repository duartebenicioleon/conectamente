# ConectaMente 5.0 — base con servidor

Esta carpeta contiene una primera versión conectada a un backend real:
- Registro e inicio de sesión (solo mayores de 18 años).
- Contraseñas con hash bcrypt.
- Base PostgreSQL para usuarios, likes, matches y mensajes.
- Descubrimiento de perfiles y coincidencias mutuas.
- Endpoints de chat y sugerencias de respuesta con IA.
- Clave de IA guardada como variable de entorno del servidor, nunca en el navegador.

## Requisitos
- Node.js 20 o superior.
- Una base de datos PostgreSQL.
- Una cuenta de hosting para Node y otra para PostgreSQL.
- Una API key de OpenAI para activar el endpoint de IA (opcional).

## Probar en tu computadora
1. Instalá Node.js.
2. Creá una base PostgreSQL y ejecutá el contenido de `schema.sql`.
3. Copiá `.env.example` a `.env` y completá los datos.
4. En una terminal, dentro de esta carpeta, ejecutá:
   ```bash
   npm install
   npm start
   ```
5. Abrí `http://localhost:3000`.

## Subirlo a Internet (Render + GitHub)
1. Subí toda esta carpeta a un repositorio de GitHub.
2. En Render, creá un servicio **Web Service** conectado a ese repositorio.
3. Build command: `npm install`
4. Start command: `npm start`
5. Creá una base PostgreSQL y copiá su URL interna a la variable `DATABASE_URL`.
6. Ejecutá `schema.sql` una sola vez sobre esa base.
7. En Environment agregá `JWT_SECRET`, `DATABASE_URL`, `CLIENT_ORIGIN` y, si querés IA, `OPENAI_API_KEY` y `OPENAI_MODEL`.
8. Deploy. La URL pública del servicio sirve también la página que está en `public/`.

## Endpoints principales
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/me`
- `PATCH /api/me`
- `GET /api/discover`
- `POST /api/likes`
- `GET /api/matches`
- `GET /api/matches/:id/messages`
- `POST /api/matches/:id/messages`
- `POST /api/ai/reply`
- `GET /api/health`

## Importante: qué falta antes de abrirlo al público
Esta es una base inicial, no una plataforma lista para producción. Faltan verificación de email, recuperación de contraseña, carga segura de fotos (almacenamiento externo), moderación y reportes revisados, bloqueo, controles antiabuso, privacidad/legal, notificaciones push, chat en tiempo real, pruebas y monitoreo. Los endpoints de mensajes ya están preparados, pero la interfaz de chat aún debe integrarse. El endpoint de IA genera sugerencias; no hace que perfiles ficticios sean personas reales.

No pongas `OPENAI_API_KEY` ni `JWT_SECRET` en `public/`, HTML, JavaScript del navegador o repositorios públicos. Las llamadas de IA pueden generar costos según el uso y el proveedor.
