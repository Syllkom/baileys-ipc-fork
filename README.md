# Baileys IPC (Fork)

Un wrapper de alto rendimiento para [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) que permite ejecutar cada sesión de WhatsApp en su propio `worker_thread` (hilo de trabajo). La comunicación entre el hilo principal y los workers se realiza a través de una capa IPC (Comunicación entre Procesos) basada en el paso de mensajes de Node.js.

## Creditos
- **Autor Original:** [Zeppth](https://github.com/Zeppth)
- **Fork y Mantenimiento:** [Syllkom (Orwyth)](https://github.com/Syllkom)

Este repositorio es un fork del proyecto original de Zeppth, adaptado y optimizado para el framework [Aethero](https://github.com/Syllkom/Aethero).

## Caracteristicas de este Fork

Este fork incluye parches críticos para garantizar la estabilidad en entornos de produccion y en el manejo de objetos complejos:
- **Sanitizacion IPC (`sanitizeForIPC`):** Se implemento una funcion recursiva que limpia los objetos antes de enviarlos al worker. Esto erradica el error `DataCloneError` que ocurria al intentar clonar funciones, promesas o referencias circulares a traves de los hilos.
- **Interceptores de Media Optimizados:** Mejoras en la transferencia de buffers y streams (imagenes, videos, audios) para evitar bloqueos en el hilo principal.
- **Manejo de Errores Robusto:** Captura de excepciones dentro del worker para evitar que caidas silenciosas maten la sesion.

## Requisitos

- Node.js >= 18.0.0 (Recomendado Node 22+ para soporte nativo de `node:sqlite`).
- Modulos ESM (`"type": "module"` en el `package.json` de tu proyecto).
- Dependencias: `@whiskeysockets/baileys`, `pino`, `qrcode`, `qrcode-terminal`, `@hapi/boom`.

## Instalacion

Puedes instalar este fork directamente desde GitHub usando NPM:

```bash
npm install github:Syllkom/baileys-ipc-fork
```

O agregarlo manualmente a tu `package.json`:

```json
{
  "dependencies": {
    "baileys-ipc": "github:Syllkom/baileys-ipc-fork"
  }
}
```

## Uso Basico

```javascript
import { BaileysIPC } from 'baileys-ipc';

// Directorio donde se guardaran las sesiones
const manager = new BaileysIPC('./storage/sessions');

// Crear una nueva instancia
const instance = manager.createInstance('mi-sesion', {
    connectType: 'qr-code'
});

// Escuchar eventos de conexion
instance.on('connection.update', (update) => {
    if (update.type === 'connection_pairing' && update.qrcode) {
        console.log(update.data.qrCodeText);
    }
});

// Escuchar mensajes
instance.on('messages.upsert', async (data) => {
    const msg = data.messages[0];
    // Procesar mensaje
});

// Iniciar el worker
await instance.start();
```

## Estructura del Proyecto

- `BaileysIPC/`: Codigo que corre en el hilo principal (Manager, Proxies, IPC).
- `BaileysIPC/Worker/`: Codigo que corre aislado en los hilos (AuthState, Baileys socket).
- `IPCStreams.js`: Utilidades para transferir flujos de datos (Streams) entre hilos de forma segura.

## Licencia

MIT
