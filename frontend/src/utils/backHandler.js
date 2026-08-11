// Pila de "quién sabe qué hacer con el botón/gesto de volver atrás" — cada
// pantalla o ficha con su propio cierre (sheet, tab interna, confirmación...)
// se registra al montarse/abrirse y se desregistra al desmontarse/cerrarse.
// El listener nativo de Android solo llama a esto; si nadie está registrado
// (estamos en el nivel raíz de verdad) devuelve false y se deja salir de la app.
let stack = []

export function pushBackHandler(fn) {
  stack.push(fn)
  return () => {
    stack = stack.filter(f => f !== fn)
  }
}

// Prueba primero el handler más reciente; si dice "aquí no hay nada que
// hacer" (return false) sigue bajando por la pila hasta que alguno se
// encargue. Si ninguno lo hace, estamos de verdad en la raíz de la app.
export function handleBackPress() {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]() !== false) return true
  }
  return false
}
