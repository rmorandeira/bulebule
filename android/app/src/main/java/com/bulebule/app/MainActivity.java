package com.bulebule.app;

import com.getcapacitor.BridgeActivity;

// El textZoom del WebView hereda el tamaño de fuente del sistema (Ajustes >
// Accesibilidad > Tamaño de fuente). Con letra grande, ese factor se aplica
// sobre nuestros tamaños en CSS y descuadra el HUD (botones/tarjetas
// pensados para 100%). Se fija a 100% para que la UI del juego siempre se
// vea igual, independientemente del ajuste de accesibilidad del dispositivo.
public class MainActivity extends BridgeActivity {
  @Override
  public void onStart() {
    super.onStart();
    getBridge().getWebView().getSettings().setTextZoom(100);
  }
}
