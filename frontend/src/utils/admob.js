import { Capacitor } from '@capacitor/core'

// ── IDs de producción — reemplaza con los de tu cuenta AdMob ──
// App ID también va en android/app/src/main/AndroidManifest.xml:
//   <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID"
//              android:value="ca-app-pub-XXXXXXXXXXXXXXXX~XXXXXXXXXX"/>
const ADMOB_APP_ID   = 'ca-app-pub-4894674675461010~3259923426'
const BANNER_TOP_ID  = 'ca-app-pub-4894674675461010/3549330940'
const BANNER_BOT_ID  = 'ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX'  // TODO: banner unit inferior

// IDs de prueba de Google (activos mientras los de producción sean placeholder)
const TEST_APP_ID    = 'ca-app-pub-3940256099942544~3347511713'
const TEST_BANNER_ID = 'ca-app-pub-3940256099942544/6300978111'

const isPlaceholder = (id) => id.includes('XXXXXXXXXXXXXXXX')

export const AD_IDS = {
  app:       isPlaceholder(ADMOB_APP_ID)  ? TEST_APP_ID    : ADMOB_APP_ID,
  bannerTop: isPlaceholder(BANNER_TOP_ID) ? TEST_BANNER_ID : BANNER_TOP_ID,
  bannerBot: isPlaceholder(BANNER_BOT_ID) ? TEST_BANNER_ID : BANNER_BOT_ID,
}

export const IS_NATIVE = Capacitor.isNativePlatform()

let admobReady = false

export async function initAdMob() {
  if (!IS_NATIVE || admobReady) return
  try {
    const { AdMob } = await import('@capacitor-community/admob')
    await AdMob.initialize({ testingDevices: [], initializeForTesting: isPlaceholder(ADMOB_APP_ID) })
    admobReady = true
  } catch (e) {
    console.warn('AdMob init failed:', e)
  }
}

export async function showBanner(position = 'TOP_CENTER') {
  if (!IS_NATIVE) return
  try {
    const { AdMob, BannerAdSize, BannerAdPosition } = await import('@capacitor-community/admob')
    const adId = position === 'BOTTOM_CENTER' ? AD_IDS.bannerBot : AD_IDS.bannerTop
    await AdMob.showBanner({
      adId,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: position === 'BOTTOM_CENTER' ? BannerAdPosition.BOTTOM_CENTER : BannerAdPosition.TOP_CENTER,
      margin: 0,
      isTesting: isPlaceholder(ADMOB_APP_ID),
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
