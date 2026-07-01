import { Capacitor } from '@capacitor/core'

// ── IDs de producción — reemplaza con los de tu cuenta AdMob ──
// App ID también va en android/app/src/main/AndroidManifest.xml:
//   <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID"
//              android:value="ca-app-pub-XXXXXXXXXXXXXXXX~XXXXXXXXXX"/>
const ADMOB_APP_ID   = 'ca-app-pub-4894674675461010~3259923426'
const BANNER_TOP_ID  = 'ca-app-pub-4894674675461010/3549330940'
const BANNER_BOT_ID  = 'ca-app-pub-4894674675461010/3712072343'

// IDs de prueba de Google (activos mientras los de producción sean placeholder)
const TEST_APP_ID    = 'ca-app-pub-3940256099942544~3347511713'
const TEST_BANNER_ID = 'ca-app-pub-3940256099942544/6300978111'

const isPlaceholder = (id) => id.includes('XXXXXXXXXXXXXXXX')

// Fuerza test ads — útil para pruebas internas antes de la aprobación de AdMob.
// Cambiar a false antes de publicar en producción.
const FORCE_TESTING = import.meta.env.VITE_ADMOB_TESTING === 'true'

const isTesting = FORCE_TESTING || isPlaceholder(ADMOB_APP_ID)

export const AD_IDS = {
  app:       isTesting ? TEST_APP_ID    : ADMOB_APP_ID,
  bannerTop: isTesting ? TEST_BANNER_ID : BANNER_TOP_ID,
  bannerBot: isTesting ? TEST_BANNER_ID : BANNER_BOT_ID,
}

export const IS_NATIVE = Capacitor.isNativePlatform()

let initPromise = null

// Cachea la promesa de inicialización para que cualquier llamada a showBanner
// (aunque llegue antes de que termine el arranque de AdMob) espere a que esté
// lista — si no, el banner del anfitrión (que suele llegar a la partida antes
// de que AdMob termine de inicializar) se pedía contra un SDK aún no listo y
// fallaba en silencio.
export function initAdMob() {
  if (!IS_NATIVE) return Promise.resolve()
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const { AdMob } = await import('@capacitor-community/admob')
        await AdMob.initialize({ testingDevices: [], initializeForTesting: isTesting })
      } catch (e) {
        console.warn('AdMob init failed:', e)
      }
    })()
  }
  return initPromise
}

export async function showBanner(position = 'TOP_CENTER') {
  if (!IS_NATIVE) return
  await initAdMob()
  try {
    const { AdMob, BannerAdSize, BannerAdPosition } = await import('@capacitor-community/admob')
    const adId = position === 'BOTTOM_CENTER' ? AD_IDS.bannerBot : AD_IDS.bannerTop
    await AdMob.showBanner({
      adId,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: position === 'BOTTOM_CENTER' ? BannerAdPosition.BOTTOM_CENTER : BannerAdPosition.TOP_CENTER,
      margin: 0,
      isTesting,
    })
  } catch (e) {
    console.warn('AdMob showBanner failed:', e)
  }
}

export async function hideBanner() {
  if (!IS_NATIVE) return
  try {
    const { AdMob } = await import('@capacitor-community/admob')
    await AdMob.hideBanner()
  } catch (e) {
    console.warn('AdMob hideBanner failed:', e)
  }
}

export async function removeBanner() {
  if (!IS_NATIVE) return
  try {
    const { AdMob } = await import('@capacitor-community/admob')
    await AdMob.removeBanner()
  } catch (e) {
    console.warn('AdMob removeBanner failed:', e)
  }
}
