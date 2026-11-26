# Pruebas de baileys-ipc

```bash
npm install     # instala las dependencias de desarrollo (Baileys, pino, etc.)
npm test        # ~45 s; no necesita WhatsApp ni red
```

## Cómo funciona

Las pruebas arrancan workers reales, pero con un **socket de Baileys falso**
(`test/fixtures/fake-socket.js`) que se inyecta con la opción `socketFactory` al crear la instancia:

```js
manager.createInstance('id', {
    connectType: 'qr-code',
    socketFactory: '/ruta/absoluta/fake-socket.js',
    fake: { autoOpen: false, pairingFails: true, hangLogout: true }   // comportamiento del socket falso
})
```

Sin `socketFactory`, el worker usa Baileys real exactamente como antes.

El socket falso avisa de cada llamada que recibe por un **canal lateral** (`connection.update` con
`type: 'fake_call'`, ver `watchFake` en `helpers.js`), de modo que se puede comprobar qué llegó al
socket aunque las respuestas IPC no funcionen.

## `todo` = bug conocido

Una prueba con `{ todo: 'fase N: …' }` describe el comportamiento **correcto** que todavía no existe.
No hace fallar `npm test`. Al arreglar el bug, se quita el `todo` y la prueba pasa a proteger la corrección.
Si un `todo` pasa sin querer, `node --test` lo muestra como `ok … # TODO`: señal de que ya se puede promover.

## Fases del plan

| Fase | Tema |
|---|---|
| 1 | Arreglos rápidos: respuestas/timeouts de `IPCRequest`, `connectType`, errores del worker, pairing, reinicios |
| 2 | Manifiesto del socket (qué existe realmente en `sock`) |
| 3 | Puente de eventos genérico |
| 4 | Códec de serialización y errores estructurados |
