import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { makeManager, startFake, waitConnection, watchFake, waitEvent, sleep, FAKE_SOCKET } from './helpers.js'

// Convención: `todo` = comportamiento correcto que aún no existe (se indica la fase del plan).

// ───────────────────────── Gestor ─────────────────────────

test('gestor: valida los parámetros de createInstance', async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    assert.throws(() => manager.createInstance('', { connectType: 'qr-code' }), /instanceId/)
    assert.throws(() => manager.createInstance('a', {}), /connectType/)
    assert.throws(() => manager.createInstance('a', { connectType: 'pin-code' }), /phoneNumber/)
})

test('gestor: no permite dos instancias con el mismo id', async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    manager.createInstance('dup', { connectType: 'qr-code', socketFactory: FAKE_SOCKET })
    assert.throws(() => manager.createInstance('dup', { connectType: 'qr-code', socketFactory: FAKE_SOCKET }), /already running/)
    assert.deepEqual(manager.InstancesActive(), ['dup'])
})

// ───────────────────────── Conexión y eventos ─────────────────────────

test('conexión: connection_open normaliza el id y el lid', async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = manager.createInstance('c1', { connectType: 'qr-code', socketFactory: FAKE_SOCKET })
    const opened = waitConnection(instance, (u) => u.type === 'connection_open')
    await instance.start()
    const { data } = await opened
    assert.equal(data.id, '51999000111@s.whatsapp.net')
    assert.equal(data.lid, '123456@lid')
    assert.equal(data.name, 'Fake')
})

test('eventos: messages.upsert conserva Buffer y BigInt', async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = await startFake(manager)
    const got = waitEvent(instance, 'messages.upsert')
    instance.sock.__emitHardMessage()
    const { messages } = await got
    const img = messages[0].message.imageMessage
    assert.deepEqual([...img.jpegThumbnail], [1, 2, 3, 250])
    assert.equal(typeof img.fileLength, 'bigint')
    assert.equal(img.fileLength, 12345678901234567890n)
})

test('eventos: groups.update (y cualquier otro evento de Baileys) llega al hilo principal', { todo: 'fase 3: puente de eventos genérico' }, async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = await startFake(manager)
    const got = waitEvent(instance, 'groups.update', 1000)
    instance.sock.__emit('groups.update', [{ id: 'g@g.us', subject: 'Nuevo nombre' }])
    const data = await got
    assert.equal(data[0].subject, 'Nuevo nombre')
})

// ───────────────────────── Medios (streams) ─────────────────────────

for (const [label, size] of [['2 MB', 2 * 1024 * 1024], ['12 MB', 12 * 1024 * 1024]]) {
    test(`medios: sendMessage con un Buffer de ${label} llega íntegro al socket`, async (t) => {
        const { manager, cleanup } = makeManager(); t.after(cleanup)
        const instance = await startFake(manager)
        const fake = watchFake(instance)
        const data = randomBytes(size)
        instance.sock.sendMessage('1@s.whatsapp.net', { image: data, caption: 'x' })
        const call = await fake.wait('sendMessage', 20000)
        assert.equal(call.media, 'image')
        assert.equal(call.received.length, size)
        assert.equal(call.received.sha256, createHash('sha256').update(data).digest('hex'))
    })
}

test('medios: waUploadToServer con un Buffer llega íntegro al socket', async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = await startFake(manager)
    const fake = watchFake(instance)
    const data = randomBytes(500_000)
    instance.sock.waUploadToServer(data, { mediaType: 'audio' })
    const call = await fake.wait('waUploadToServer')
    assert.equal(call.received.sha256, createHash('sha256').update(data).digest('hex'))
})

// ───────────────────────── Peticiones y respuestas ─────────────────────────

test('petición: las llamadas llegan al socket con sus argumentos', async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = await startFake(manager)
    const fake = watchFake(instance)
    instance.sock.profilePictureUrl('abc@s.whatsapp.net', 'image')
    assert.equal((await fake.wait('profilePictureUrl')).jid, 'abc@s.whatsapp.net')
})

test('petición: await sock.metodo() devuelve el resultado del socket', { todo: 'fase 1: las respuestas IPC no se correlacionan' }, async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = await startFake(manager)
    assert.equal(await instance.sock.profilePictureUrl('abc@s.whatsapp.net'), 'https://example.invalid/pp/abc@s.whatsapp.net')
})

test('petición: los tipos difíciles (Buffer, BigInt, Date, Map, Set) sobreviven', { todo: 'fase 1 + 4' }, async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = await startFake(manager)
    const r = await instance.sock.hardTypes()
    assert.ok(Buffer.isBuffer(r.buffer) || r.buffer instanceof Uint8Array)
    assert.equal(r.big, 12345678901234567890n)
    assert.ok(r.date instanceof Date)
    assert.ok(r.map instanceof Map && r.set instanceof Set)
})

test('petición: un error del socket rechaza la promesa y conserva statusCode', { todo: 'fase 1 + 4' }, async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = await startFake(manager)
    await assert.rejects(instance.sock.failWith('prohibido', 403), (e) => e.message.includes('prohibido') && e.statusCode === 403)
})

test('petición: una llamada lenta vence por timeout', { todo: 'fase 1' }, async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = await startFake(manager)
    await assert.rejects(instance.request({ type: 'SOCKET', PATH: ['slow'], ARGS: [2000] }, 100), /Timeout/)
})

test('argumentos: un Buffer pasado a un método llega como Buffer', { todo: 'fase 4: códec' }, async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = await startFake(manager)
    const fake = watchFake(instance)
    instance.sock.__echoArgs(Buffer.from([1, 2, 3]))
    const call = await fake.wait('echoArgs')
    assert.equal(call.args[0].kind, 'Buffer', `llegó como ${call.args[0].kind}`)
})

// ───────────────────────── Reconexión y ciclo de vida ─────────────────────────

test('ciclo de vida: loggedOut (401) emite action "stop" y borra la sesión guardada', async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = await startFake(manager)
    assert.equal(manager.StoreIPCs.has('51999000111'), false, 'el socket falso aún no guardó credenciales')
    // guardamos creds como lo haría Baileys al conectar
    instance.sock.__emit('creds.update', {})
    const closed = waitConnection(instance, (u) => u.type === 'connection_close')
    instance.sock.__emitClose(401)
    const u = await closed
    assert.equal(u.action, 'stop')
    assert.equal(u.reasonCode, 401)
})

test('ciclo de vida: restartRequired (515) reinicia el worker y vuelve a conectar', async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = await startFake(manager)
    const closed = waitConnection(instance, (u) => u.type === 'connection_close')
    const reopened = new Promise((res) => setTimeout(res, 0)).then(() => waitConnection(instance, (u) => u.type === 'connection_open', 10000))
    instance.sock.__emitClose(515)
    assert.equal((await closed).action, 'restart')
    await reopened
})

test('ciclo de vida: tras un reinicio NO se debe cambiar el modo de conexión', { todo: 'fase 1: se fuerza connectType = "qr-code"' }, async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = manager.createInstance('pin1', { connectType: 'pin-code', phoneNumber: '51999000111', socketFactory: FAKE_SOCKET, fake: { autoOpen: false } })
    const pairing = waitConnection(instance, (u) => u.type === 'connection_pairing', 8000)
    await instance.start()
    await pairing
    const closed = waitConnection(instance, (u) => u.type === 'connection_close')
    instance.sock.__emitClose(515)
    await closed
    await sleep(300)
    assert.equal(instance.worker.options.connectType, 'pin-code')
})

test('ciclo de vida: una llamada que falla con "Connection Closed" (428) pide reinicio', async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = await startFake(manager)
    const closed = waitConnection(instance, (u) => u.type === 'connection_close')
    instance.sock.connectionClosed()
    const u = await closed
    assert.equal(u.action, 'restart')
    assert.equal(u.reasonCode, 428)
})

test('ciclo de vida: si el worker se cae, se reinicia solo', async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = await startFake(manager)
    const exited = waitEvent(instance, 'exit', 5000)
    instance.sock.__crash()
    await exited
    await waitConnection(instance, (u) => u.type === 'connection_open', 12000)
})

test('ciclo de vida: una caída del worker se registra y se avisa con el error', { todo: 'fase 1: hoy se pierde en silencio' }, async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = await startFake(manager)
    const err = new Promise((res) => instance.once('worker_error', res))
    instance.sock.__crash()
    const e = await Promise.race([err, sleep(2500).then(() => null)])
    assert.match(String(e?.message ?? e), /crash de prueba/)
})

test('destroyInstance justo después de una caída no debe resucitar el worker', { todo: 'fase 1: el reinicio diferido de IPCWorker ignora stop()' }, async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = await startFake(manager)
    const exited = waitEvent(instance, 'exit', 5000)
    instance.sock.__crash()
    await exited
    await instance.stop() // el usuario elimina la sesión durante los 5 s de espera
    const oldStart = instance.worker.start
    let restarted = false
    instance.worker.start = async (...a) => { restarted = true; return oldStart.apply(instance.worker, a) }
    await sleep(5600)
    assert.equal(restarted, false, 'el worker se reinició después de stop()')
})

test('destroyInstance: borra la instancia y su sesión', async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = await startFake(manager)
    instance.sock.__emit('creds.update', {})
    await manager.destroyInstance('51999000111')
    assert.equal(manager.hasInstance('51999000111'), false)
    assert.equal(manager.StoreIPCs.has('51999000111'), false)
})

test('destroyInstance: no se cuelga si logout() nunca responde', async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = manager.createInstance('hang', { connectType: 'qr-code', socketFactory: FAKE_SOCKET, fake: { hangLogout: true } })
    const opened = waitConnection(instance, (u) => u.type === 'connection_open')
    await instance.start(); await opened
    const t0 = Date.now()
    let timer
    const limite = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('destroyInstance tardó más de 5 s')), 5000) })
    await Promise.race([manager.destroyInstance('hang'), limite]).finally(() => clearTimeout(timer))
    assert.ok(Date.now() - t0 < 5000)
    assert.equal(manager.hasInstance('hang'), false)
})

// ───────────────────────── Pairing con código ─────────────────────────

test('pairing: connectType pin-code emite el código de vinculación', async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = manager.createInstance('p1', { connectType: 'pin-code', phoneNumber: '+51 999 000 111', socketFactory: FAKE_SOCKET, fake: { autoOpen: false } })
    const fake = watchFake(instance)
    const pairing = waitConnection(instance, (u) => u.type === 'connection_pairing', 8000)
    await instance.start()
    const u = await pairing
    assert.equal(u.pincode, true)
    assert.equal(u.data.pairingCode, 'ABCD1234')
    assert.equal((await fake.wait('requestPairingCode')).number, '51999000111', 'el número se limpia a solo dígitos')
})

test('pairing: customCode llega a requestPairingCode', async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = manager.createInstance('p2', { connectType: 'pin-code', phoneNumber: '51999000111', customCode: 'AETHERO1', socketFactory: FAKE_SOCKET, fake: { autoOpen: false } })
    const pairing = waitConnection(instance, (u) => u.type === 'connection_pairing', 8000)
    await instance.start()
    assert.equal((await pairing).data.pairingCode, 'AETHERO1')
})

test('pairing: si requestPairingCode falla se avisa con un evento y NO se reintenta en bucle', { todo: 'fase 1: hoy el worker muere y se reinicia cada 5 s pidiendo otro código' }, async (t) => {
    const { manager, cleanup } = makeManager(); t.after(cleanup)
    const instance = manager.createInstance('p3', { connectType: 'pin-code', phoneNumber: '51999000111', socketFactory: FAKE_SOCKET, fake: { autoOpen: false, pairingFails: true } })
    const fake = watchFake(instance)
    const failed = waitConnection(instance, (u) => u.type === 'pairing_error', 6000)
    await instance.start()
    await failed
    await sleep(6500)
    assert.equal(fake.calls.filter((c) => c.name === 'requestPairingCode').length, 1, 'no debe volver a pedir código')
})
