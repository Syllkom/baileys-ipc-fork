// Socket de Baileys falso para probar baileys-ipc sin WhatsApp.
// Se inyecta con la opción `socketFactory` (ruta a este archivo) al crear la instancia.
//
// Opciones (`fake` en las ConnectOptions):
//   autoOpen        (true)  emite connection:'open' al crear el socket (no se usa con pin-code)
//   pairingFails    (false) requestPairingCode lanza un error
//   hangLogout      (false) logout() nunca responde
//
// Métodos de control, llamables desde el hilo principal como `instance.sock.__x(...)`:
//   __emit(evento, payload)  emite un evento de Baileys desde el worker
//   __completePairing()      simula que el teléfono aceptó el código (open)
//   __crash()                lanza una excepción no capturada dentro del worker
//   __echoArgs(...a) / __emitClose(code) / __emitHardMessage()  ver abajo
// Cada llamada recibida avisa por un canal lateral (connection.update con type "fake_call").
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { workerData, parentPort } from 'node:worker_threads'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Canal lateral: el worker avisa al hilo principal de lo que recibe el socket falso, sin depender
// de las respuestas IPC (así se pueden probar las llamadas aunque la respuesta no funcione).
// Llega al principal como `connection.update` con `type: 'fake_call'`.
const side = (name, data = {}) => parentPort.postMessage({ event: 'connection', type: 'fake_call', name, data })

const describe = (v) => Buffer.isBuffer(v) ? { kind: 'Buffer', length: v.length, bytes: [...v] }
    : v instanceof Uint8Array ? { kind: 'Uint8Array', length: v.length }
    : v === null ? { kind: 'null' } : Array.isArray(v) ? { kind: 'array', length: v.length }
    : { kind: typeof v, value: typeof v === 'object' ? undefined : v }

async function consume(stream) {
    const hash = createHash('sha256')
    let length = 0
    for await (const chunk of stream) { hash.update(chunk); length += chunk.length }
    return { sha256: hash.digest('hex'), length }
}

const boom = (message, statusCode) => Object.assign(new Error(message), {
    isBoom: true, output: { statusCode, payload: { statusCode, message } }
})

export default function makeFakeSocket(config) {
    const opts = { autoOpen: true, pairingFails: false, hangLogout: false, ...(workerData.fake || {}) }
    const ev = new EventEmitter()
    const note = (name, data) => side(name, data)

    const sock = {
        ev,
        authState: config.auth,
        user: undefined,
        ws: { isOpen: false },

        async sendMessage(jid, content, options) {
            const media = ['image', 'video', 'audio', 'document', 'sticker'].find((k) => content?.[k])
            let received
            if (media && content[media]?.stream) received = await consume(content[media].stream)
            note('sendMessage', { jid, media, received })
            return { key: { remoteJid: jid, id: 'FAKE1', fromMe: true }, jid, received }
        },

        async waUploadToServer(stream, options) {
            const received = await consume(stream)
            note('waUploadToServer', { received })
            return { mediaUrl: 'https://example.invalid/' + received.sha256, directPath: '/v/' + received.sha256, ...received }
        },

        async profilePictureUrl(jid) {
            note('profilePictureUrl', { jid })
            if (jid.startsWith('missing')) throw new Error('item-not-found')
            return 'https://example.invalid/pp/' + jid
        },

        async fetchStatus(jid) { note('fetchStatus', { jid }); throw new Error('boom') },

        async groupMetadata(jid) { return { id: jid, subject: 'Grupo', participants: [{ id: '1@lid', admin: null }], creation: 1700000000 } },

        // devuelve tipos "difíciles": Buffer, BigInt, Date, Map, Set, Uint8Array
        async hardTypes() {
            return {
                buffer: Buffer.from([1, 2, 3, 250]), big: 12345678901234567890n, date: new Date(1700000000000),
                map: new Map([['a', 1]]), set: new Set([1, 2]), u8: new Uint8Array([9, 8]), nested: { deep: [Buffer.from('hi')] }
            }
        },

        async slow(ms) { await sleep(ms); return 'late' },
        async failWith(message, statusCode) { throw boom(message, statusCode) },
        async connectionClosed() { throw boom('Connection Closed', 428) },

        async requestPairingCode(number, customCode) {
            note('requestPairingCode', { number, customCode })
            if (opts.pairingFails) throw new Error('pairing rejected')
            const code = customCode || 'ABCD1234'
            config.auth.creds.pairingCode = code
            config.auth.creds.me = { id: number + ':0@s.whatsapp.net', name: '~' }
            ev.emit('creds.update', config.auth.creds) // Baileys también persiste creds al pedir el código
            return code
        },

        async logout() {
            note('logout')
            if (opts.hangLogout) return new Promise(() => {})
            ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: boom('Logged Out', 401) } })
        },

        // ── Control para las pruebas ──
        __emit(event, payload) { ev.emit(event, payload); return true },
        __completePairing() { open(); return true },
        __crash() { setTimeout(() => { throw new Error('crash de prueba') }, 5); return true },
        __echoArgs(...args) { note('echoArgs', { args: args.map(describe) }); return true },
        __emitClose(statusCode) {
            ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: boom('closed', statusCode) } })
            return true
        },
        // mensaje con Buffer y BigInt dentro, para probar la serialización de eventos
        __emitHardMessage() {
            ev.emit('messages.upsert', { type: 'notify', messages: [{
                key: { remoteJid: '1@s.whatsapp.net', id: 'HARD1', fromMe: false },
                message: { imageMessage: { jpegThumbnail: Buffer.from([1, 2, 3, 250]), fileLength: 12345678901234567890n } },
                messageTimestamp: 1700000000
            }] })
            return true
        }
    }

    function open() {
        sock.user = { id: '51999000111:7@s.whatsapp.net', lid: '123456:7@lid', name: 'Fake' }
        sock.ws.isOpen = true
        ev.emit('connection.update', { connection: 'open' })
    }

    if (opts.autoOpen) setTimeout(open, 30)
    return sock
}
