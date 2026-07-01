import { Capacitor } from '@capacitor/core'

// Si el jugador entra a una sala por su cuenta (p.ej. desde el listado) y
// resulta ser la misma sala de un reto/invitación pendiente, retiramos la
// notificación de la bandeja — ya no tiene sentido que siga ahí.
export async function dismissRoomNotification(roomCode) {
  if (!Capacitor.isNativePlatform() || !roomCode) return
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    const { notifications } = await PushNotifications.getDeliveredNotifications()
    const toRemove = notifications.filter(n => n.data?.roomCode === roomCode)
    if (toRemove.length) await PushNotifications.removeDeliveredNotifications({ notifications: toRemove })
  } catch (e) {
    console.warn('dismissRoomNotification failed:', e)
  }
}
