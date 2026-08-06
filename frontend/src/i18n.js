import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'bule_lang'

function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

export function detectDeviceLanguage() {
  const nav = (navigator.language || navigator.languages?.[0] || 'es').toLowerCase()
  return nav.startsWith('en') ? 'en' : 'es'
}

export function getLanguage() {
  const saved = localStorage.getItem(STORAGE_KEY)
  return saved === 'en' || saved === 'es' ? saved : detectDeviceLanguage()
}

export function setLanguage(lang) {
  localStorage.setItem(STORAGE_KEY, lang)
  window.dispatchEvent(new Event('bule_lang_change'))
}

export function useLanguage() {
  const [lang, setLang] = useState(getLanguage)
  useEffect(() => {
    function onChange() { setLang(getLanguage()) }
    window.addEventListener('bule_lang_change', onChange)
    return () => window.removeEventListener('bule_lang_change', onChange)
  }, [])
  return lang
}

export function useTranslation() {
  const lang = useLanguage()
  const t = useCallback((key, params) => {
    let val = get(dict[lang], key)
    if (val === undefined) val = get(dict.es, key)
    if (val === undefined) return key
    return typeof val === 'function' ? val(params) : val
  }, [lang])
  return { t, lang }
}

// ── Diccionario ──────────────────────────────────────────────────────────────
// Cobertura actual: login/consentimiento, chrome principal de RoomList y
// UserSection completo. El resto de pantallas (sheets de crear sala, quejas,
// filtros, torneos, tienda, partida) siguen en español y se migran en tandas
// posteriores.

const dict = {
  es: {
    common: {
      cancel: 'Cancelar',
      loading: 'Cargando...',
      free: 'Gratis',
    },
    login: {
      googleButton: 'Iniciar sesión con Google',
      googleError: 'Error al iniciar sesión con Google',
      consentPrefix: 'He leído y acepto la',
      privacyLink: 'Política de Privacidad',
      and: 'y los',
      termsLink: 'Términos y Condiciones',
      consentRequired: 'Debes aceptar la Política de Privacidad y los Términos y Condiciones para continuar',
    },
    header: {
      connected: 'Conectado',
      disconnected: 'Sin conexión',
      ranking: p => `Ranking ${p.rank}/${p.total}`,
      muteAria: 'Silenciar música',
      unmuteAria: 'Activar música',
      feedbackAria: 'Quejas y sugerencias',
    },
    pages: {
      clasificacionLabel: 'Clasificación',
      clasificacionDesc: 'Compite en partidas individuales y mejora tu posición en la clasificación mundial',
      challengeLabel: 'Challengue',
      challengeDesc: 'Reta a otros jugadores en duelos 1vs1 y demuestra quién es el mejor',
      onlineLabel: 'Juego online',
      onlineDesc: 'Juega una partida tú sólo o contra la máquina',
      tiendaLabel: 'Tienda online',
      tiendaDesc: 'Utiliza tus Bules para comprar objetos y regalos',
    },
    ranking: {
      searchPlaceholder: 'Buscar jugador',
      searchClearAria: 'Borrar búsqueda',
      filterAria: 'Filtrar',
      emptySearch: 'No se encontró ningún jugador',
      emptyDefault: 'Juega partidas para aparecer en la clasificación',
      onlineTooltip: 'En línea',
      playingPill: 'jugando',
      youPill: 'tú',
    },
    online: {
      searchPlaceholder: 'Buscar sala',
      emptySearch: 'No se encontró ninguna sala',
      emptyDefault: 'No hay partidas abiertas ahora mismo',
      players: 'Jugadores',
      full: 'Llena',
      inProgress: 'En curso',
      join: 'Unirse',
      enter: 'Entrar',
      pendingChallengeAria: 'Reto pendiente',
      noConnection: 'Sin conexión al servidor',
      enterNameFirst: 'Introduce tu nombre primero',
      joinError: 'No se pudo unir a la sala',
    },
    navbar: {
      ranking: 'Clasificación',
      challenge: 'Challengue',
      online: 'Juego online',
      shop: 'Tienda',
      user: 'Usuario',
    },
    createBar: {
      play: 'Jugar',
    },
    roomModal: {
      title: 'Sala privada',
      hintPrefix: 'Introduce el código para unirte a',
      wrongCode: 'Código incorrecto',
      join: 'Unirse',
    },
    toast: {
      feedbackSent: 'Mensaje enviado, ¡gracias!',
    },
    intro: {
      start: 'Comenzar',
    },
    updateModal: {
      title: 'Nueva versión disponible',
      text: 'Hay una actualización importante de Bule Bule. Actualiza la app para seguir jugando.',
      button: 'Actualizar ahora',
    },
    user: {
      back: 'Volver',
      tabs: { stats: 'Stats', historial: 'Historial', items: 'Items', ajustes: 'Ajustes' },
      profile: {
        caidaTitle: 'Jugador de caída',
        caidaDesc: p => `El ${p.p1}% de las rondas las juegas a la primera tirada — confías en la suerte`,
        perfeccionistaTitle: 'Perfeccionista',
        perfeccionistaDesc: p => `Usas las 3 tiradas en el ${p.p3}% de las rondas — siempre intentas mejorar la mano`,
        impredecibleTitle: 'Jugador impredecible',
        impredecibleDesc: 'Mezclas caídas y agotamiento de tiradas — difícil de leer',
        calculadorTitle: 'Jugador calculador',
        calculadorDesc: p => `Paras en la segunda tirada el ${p.p2}% de las veces — buen balance entre riesgo y seguridad`,
        versatilTitle: 'Jugador versátil',
        versatilDesc: 'Adaptas el número de tiradas a cada situación sin un patrón claro',
      },
      stats: {
        loading: 'Cargando estadísticas...',
        bules: 'Bules',
        ofTotal: p => `de ${p.total}`,
        games: 'partidas',
        wins: 'victorias',
        losses: 'derrotas',
        winRate: 'win rate',
        profileTitle: 'PERFIL',
        roll1: '1 tirada',
        roll2: '2 tiradas',
        roll3: '3 tiradas',
        handsTitle: p => `JUGADAS (${p.total} rondas)`,
        handsEmpty: 'Juega partidas para ver tus estadísticas de jugadas',
      },
      items: {
        empty: 'Sin items todavía',
        emptySub: 'Compra items en la tienda con tus Bules',
        active: 'Activo',
        owned: 'Tuyo',
        unequip: 'Desactivar skin',
        equip: 'Activar skin',
        bules: p => `${p.n} Bules`,
      },
      historial: {
        today: 'Hoy',
        yesterday: 'Ayer',
        empty: 'Sin actividad aún',
        emptySub: 'Aquí verás tus partidas y compras',
        win: 'Victoria',
        loss: 'Derrota',
      },
      settings: {
        changePictureAria: 'Cambiar foto',
        appearance: 'APARIENCIA',
        themeLight: 'Claro',
        themeDark: 'Oscuro',
        themeSystem: 'Sistema',
        nameLabel: 'NOMBRE EN PARTIDA',
        save: 'Guardar',
        notifications: 'NOTIFICACIONES ACTIVAS',
        language: 'IDIOMA',
        languageHint: 'Detectado automáticamente según tu dispositivo. Puedes cambiarlo aquí.',
        langEs: 'Español',
        langEn: 'English',
        legal: 'LEGAL',
        privacyLink: 'Política de Privacidad',
        termsLink: 'Términos y Condiciones',
        rgpdText: 'Tienes derecho a acceder, rectificar o eliminar tus datos personales. Puedes eliminar tu cuenta y tus datos en cualquier momento con el botón de abajo, o escribirnos a rmorandeira@gmail.com para ejercer tus derechos.',
        acceptedOn: p => `Aceptados el ${p.date}`,
        safety: 'SEGURIDAD',
        reportLink: 'Reportar lenguaje ofensivo o acoso',
        reportDisabled: 'Esta función no está disponible temporalmente.',
        reportPlayerLabel: 'JUGADOR (OPCIONAL)',
        reportPlayerPlaceholder: 'Nombre del jugador',
        reportMessageLabel: 'MENSAJE O DESCRIPCIÓN DE LO OCURRIDO',
        reportMessagePlaceholder: 'Copia el mensaje o describe lo que ha pasado...',
        reportSubmit: 'Enviar reporte',
        reportSending: 'Enviando...',
        reportSent: 'Gracias, hemos recibido tu reporte y lo revisaremos.',
        reportErrorEmpty: 'Cuéntanos qué ha pasado antes de enviar el reporte.',
        reportErrorGeneric: 'No se pudo enviar el reporte, inténtalo de nuevo.',
        version: p => `Versión ${p.v}`,
        logout: 'Cerrar sesión',
        deleteAccount: 'Eliminar cuenta',
        deleteConfirm: 'Esta acción es irreversible. ¿Seguro?',
        delete: 'Eliminar',
      },
    },
  },
  en: {
    common: {
      cancel: 'Cancel',
      loading: 'Loading...',
      free: 'Free',
    },
    login: {
      googleButton: 'Sign in with Google',
      googleError: 'Error signing in with Google',
      consentPrefix: 'I have read and accept the',
      privacyLink: 'Privacy Policy',
      and: 'and the',
      termsLink: 'Terms and Conditions',
      consentRequired: 'You must accept the Privacy Policy and Terms and Conditions to continue',
    },
    header: {
      connected: 'Connected',
      disconnected: 'No connection',
      ranking: p => `Rank ${p.rank}/${p.total}`,
      muteAria: 'Mute music',
      unmuteAria: 'Unmute music',
      feedbackAria: 'Feedback and suggestions',
    },
    pages: {
      clasificacionLabel: 'Leaderboard',
      clasificacionDesc: 'Compete in solo matches and climb the world leaderboard',
      challengeLabel: 'Challenge',
      challengeDesc: 'Challenge other players to 1v1 duels and prove who is the best',
      onlineLabel: 'Online play',
      onlineDesc: 'Play a match alone or against the computer',
      tiendaLabel: 'Online shop',
      tiendaDesc: 'Use your Bules to buy items and gifts',
    },
    ranking: {
      searchPlaceholder: 'Search player',
      searchClearAria: 'Clear search',
      filterAria: 'Filter',
      emptySearch: 'No player found',
      emptyDefault: 'Play matches to appear on the leaderboard',
      onlineTooltip: 'Online',
      playingPill: 'playing',
      youPill: 'you',
    },
    online: {
      searchPlaceholder: 'Search room',
      emptySearch: 'No room found',
      emptyDefault: 'No open games right now',
      players: 'Players',
      full: 'Full',
      inProgress: 'In progress',
      join: 'Join',
      enter: 'Enter',
      pendingChallengeAria: 'Pending challenge',
      noConnection: 'No connection to the server',
      enterNameFirst: 'Enter your name first',
      joinError: 'Could not join the room',
    },
    navbar: {
      ranking: 'Leaderboard',
      challenge: 'Challenge',
      online: 'Online play',
      shop: 'Shop',
      user: 'User',
    },
    createBar: {
      play: 'Play',
    },
    roomModal: {
      title: 'Private room',
      hintPrefix: 'Enter the code to join',
      wrongCode: 'Wrong code',
      join: 'Join',
    },
    toast: {
      feedbackSent: 'Message sent, thank you!',
    },
    intro: {
      start: 'Start',
    },
    updateModal: {
      title: 'New version available',
      text: 'An important Bule Bule update is available. Update the app to keep playing.',
      button: 'Update now',
    },
    user: {
      back: 'Back',
      tabs: { stats: 'Stats', historial: 'History', items: 'Items', ajustes: 'Settings' },
      profile: {
        caidaTitle: 'Instant player',
        caidaDesc: p => `You play ${p.p1}% of rounds on the first roll — you trust your luck`,
        perfeccionistaTitle: 'Perfectionist',
        perfeccionistaDesc: p => `You use all 3 rolls in ${p.p3}% of rounds — always trying to improve your hand`,
        impredecibleTitle: 'Unpredictable player',
        impredecibleDesc: 'You mix quick stops and full rerolls — hard to read',
        calculadorTitle: 'Calculating player',
        calculadorDesc: p => `You stop on the second roll ${p.p2}% of the time — good balance of risk and safety`,
        versatilTitle: 'Versatile player',
        versatilDesc: 'You adapt the number of rolls to each situation with no clear pattern',
      },
      stats: {
        loading: 'Loading stats...',
        bules: 'Bules',
        ofTotal: p => `of ${p.total}`,
        games: 'games',
        wins: 'wins',
        losses: 'losses',
        winRate: 'win rate',
        profileTitle: 'PROFILE',
        roll1: '1 roll',
        roll2: '2 rolls',
        roll3: '3 rolls',
        handsTitle: p => `HANDS (${p.total} rounds)`,
        handsEmpty: 'Play matches to see your hand stats',
      },
      items: {
        empty: 'No items yet',
        emptySub: 'Buy items in the shop with your Bules',
        active: 'Active',
        owned: 'Owned',
        unequip: 'Unequip skin',
        equip: 'Equip skin',
        bules: p => `${p.n} Bules`,
      },
      historial: {
        today: 'Today',
        yesterday: 'Yesterday',
        empty: 'No activity yet',
        emptySub: 'Your matches and purchases will show up here',
        win: 'Win',
        loss: 'Loss',
      },
      settings: {
        changePictureAria: 'Change picture',
        appearance: 'APPEARANCE',
        themeLight: 'Light',
        themeDark: 'Dark',
        themeSystem: 'System',
        nameLabel: 'IN-GAME NAME',
        save: 'Save',
        notifications: 'NOTIFICATIONS ENABLED',
        language: 'LANGUAGE',
        languageHint: 'Automatically detected from your device. You can change it here.',
        langEs: 'Español',
        langEn: 'English',
        legal: 'LEGAL',
        privacyLink: 'Privacy Policy',
        termsLink: 'Terms and Conditions',
        rgpdText: 'You have the right to access, rectify or delete your personal data. You can delete your account and data at any time with the button below, or email us at rmorandeira@gmail.com to exercise your rights.',
        acceptedOn: p => `Accepted on ${p.date}`,
        safety: 'SAFETY',
        reportLink: 'Report offensive language or harassment',
        reportDisabled: 'This feature is temporarily unavailable.',
        reportPlayerLabel: 'PLAYER (OPTIONAL)',
        reportPlayerPlaceholder: "Player's name",
        reportMessageLabel: 'MESSAGE OR DESCRIPTION OF WHAT HAPPENED',
        reportMessagePlaceholder: 'Copy the message or describe what happened...',
        reportSubmit: 'Send report',
        reportSending: 'Sending...',
        reportSent: "Thanks, we've received your report and will review it.",
        reportErrorEmpty: 'Tell us what happened before sending the report.',
        reportErrorGeneric: "Couldn't send the report, please try again.",
        version: p => `Version ${p.v}`,
        logout: 'Log out',
        deleteAccount: 'Delete account',
        deleteConfirm: 'This action is irreversible. Are you sure?',
        delete: 'Delete',
      },
    },
  },
}
