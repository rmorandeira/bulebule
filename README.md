# Bule Bule

Juego de dados multijugador en tiempo real, jugable en navegador y como app nativa Android. Los jugadores tiran 5 dados (caras AS/K/Q/J/8/7) buscando la mejor combinación, en salas de hasta 8 jugadores, con bots, torneos, un modo "Powerups" y una economía de moneda virtual ("Bules").

- **Web:** [bulebule.web.app](https://bulebule.web.app)
- **Android:** disponible en Google Play

## Stack técnico

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + Vite, Three.js (escena 3D de dados), Socket.IO client |
| Backend | Node.js + Express + Socket.IO, lógica de juego server-authoritative |
| Física de dados | [`@dimforge/rapier3d-compat`](https://rapier.rs/) (WASM) corriendo en el servidor, con un banco de semillas pre-computado para resultados deterministas |
| Persistencia | SQLite (`better-sqlite3`) |
| App nativa | Capacitor (Android) |
| Backoffice | React + Vite, panel de administración separado |
| Hosting | Firebase Hosting (frontend, auto-deploy en push a `main`) + Railway (backend, auto-deploy en push a `main`) |

## Estructura del repo

```
frontend/           App React (jugador) — Vite, Three.js, Socket.IO client
backend/            Servidor Node/Express/Socket.IO + lógica de juego
  game/             Física de dados (Rapier3D) y banco de semillas
  scripts/          Generación/refuerzo del banco de semillas
  backoffice/       Panel de administración (React + Vite), build en backoffice-dist/
android/             Proyecto nativo Capacitor
docs/                Informe técnico autocontenido (HTML + PDF) — arquitectura, histórico, costes, roadmap
```

## Desarrollo local

Requiere Node 22+ (versión usada en CI).

### Backend

```bash
cd backend
cp .env.example .env   # rellenar las claves que se necesiten (ver tabla de abajo)
npm install
npm run dev             # nodemon, puerto 3001 por defecto
```

### Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev              # servidor de Vite, proxy a localhost:3001
```

### Backoffice (panel de administración)

```bash
cd backend/backoffice
cp .env.example .env
npm install
npm run dev
```

### App Android

```bash
cd frontend && npm run build
npx cap sync android
cd android && ./gradlew bundleRelease   # requiere JAVA_HOME apuntando a un JDK 21
```

## Variables de entorno

**`backend/.env`**

| Variable | Uso |
|---|---|
| `PORT` | Puerto del servidor (por defecto 3001) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Notificaciones push web (generar con `web-push generate-vapid-keys`) |
| `UMAMI_URL` / `UMAMI_WEBSITE_ID` | Analítica (opcional, vacío la desactiva) |
| `FIREBASE_SERVICE_ACCOUNT` | JSON del service account de Firebase Admin (Google Sign-In) |
| `BACKOFFICE_SECRET` | Autenticación del panel de administración |
| `ALLOWED_ORIGIN` | CORS |

**`frontend/.env`**

| Variable | Uso |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | OAuth de Google Sign-In |
| `VITE_UMAMI_URL` / `VITE_UMAMI_WEBSITE_ID` | Analítica (opcional) |
| `VITE_BACKEND_URL` | URL del backend (vacío = mismo origen) |
| `VITE_ADMOB_TESTING` | Anuncios de AdMob en modo test |

## Documentación

El informe técnico completo (arquitectura, histórico de commits, componentes, costes de desarrollo, roadmap, y marco legal/regulatorio) está en [`docs/index.html`](docs/index.html) — navegable en el navegador, con exportación en PDF (`docs/bule-bule-docs.pdf`).

Términos y condiciones y política de privacidad: [`frontend/public/terminos.html`](frontend/public/terminos.html), [`frontend/public/privacidad.html`](frontend/public/privacidad.html).

## Licencia

Código y contenido propiedad de Roi Vázquez Morandeira. Todos los derechos reservados — no está permitida su reproducción, distribución o uso comercial sin autorización previa (ver [Términos y Condiciones](frontend/public/terminos.html)).
