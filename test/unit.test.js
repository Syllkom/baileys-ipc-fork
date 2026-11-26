import test from 'node:test'
import assert from 'node:assert/strict'
import { IPCRequest } from '../BaileysIPC/Library/IPCRequest.js'
import { IPCProxy } from '../BaileysIPC/Library/IPCProxy.js'

// ───────────────────────── IPCRequest ─────────────────────────
// Convención: las pruebas con `todo` describen el comportamiento CORRECTO que aún no existe
// (se indica la fase del plan que lo arregla). No hacen fallar la ejecución; al arreglarlo,
// se quita el `todo`.

test('IPCRequest: resolve, reject y clear completan las peticiones pendientes', async () => {
    const r = new IPCRequest(() => {})
    const ok = new Promise((resolve, reject) => r.requests.set('A', { resolve, reject, timer: null }))
    assert.equal(r.resolve('A', 42), true)
    assert.equal(await ok, 42)
    assert.equal(r.resolve('A', 1), false, 'una petición ya resuelta no se resuelve dos veces')

    const bad = new Promise((resolve, reject) => r.requests.set('B', { resolve, reject, timer: null }))
    r.reject('B', 'falló')
    await assert.rejects(bad, /falló/)

    const cleared = new Promise((resolve, reject) => r.requests.set('C', { resolve, reject, timer: null }))
    r.clear('worker detenido')
    await assert.rejects(cleared, /worker detenido/)
    assert.equal(r.requests.size, 0)
})

test('IPCRequest.send devuelve una promesa y envía un requestId', { todo: 'fase 1: el callback del constructor tapa el método send()' }, async () => {
    const sent = []
    const r = new IPCRequest((msg) => sent.push(msg))
    const p = r.send({ type: 'SOCKET', PATH: ['x'] }, 1000)
    assert.ok(p instanceof Promise, 'debe devolver una promesa')
    assert.ok(sent[0]?.requestId, 'el mensaje debe llevar requestId')
    r.resolve(sent[0].requestId, 42)
    assert.equal(await p, 42)
})

test('IPCRequest.send rechaza al vencer el timeout', { todo: 'fase 1' }, async () => {
    const r = new IPCRequest(() => {})
    const p = r.send({ type: 'SOCKET', PATH: ['x'] }, 30)
    assert.ok(p instanceof Promise)
    await assert.rejects(p, /Timeout/)
})

// ───────────────────────── IPCProxy ─────────────────────────

const makeProxy = (intercept = {}) => {
    const sent = []
    const sock = new IPCProxy((msg) => { sent.push(msg); return 'ok' }, intercept)
    return { sock, sent }
}

test('IPCProxy: una llamada anidada envía PATH y ARGS', () => {
    const { sock, sent } = makeProxy()
    sock.a.b('x', 2)
    assert.deepEqual(sent[0], { type: 'SOCKET', PATH: ['a', 'b'], ARGS: ['x', 2] })
})

test('IPCProxy: los argumentos se limpian (funciones fuera, BigInt a texto, ciclos fuera)', () => {
    const { sock, sent } = makeProxy()
    const ciclo = { n: 1 }; ciclo.self = ciclo
    sock.m({ fn() {}, big: 10n, ciclo })
    assert.deepEqual(sent[0].ARGS, [{ big: '10', ciclo: { n: 1, self: undefined } }])
})

test('IPCProxy: un método interceptado no viaja por IPC', () => {
    const { sock, sent } = makeProxy({ sendMessage: (...a) => 'interceptado:' + a.join(',') })
    assert.equal(sock.sendMessage('j', 'c'), 'interceptado:j,c')
    assert.equal(sent.length, 0)
})

test('IPCProxy: las propiedades asignadas al proxy raíz se leen sin IPC', () => {
    const { sock, sent } = makeProxy()
    sock.user = { id: '1@s.whatsapp.net' }
    assert.deepEqual(sock.user, { id: '1@s.whatsapp.net' })
    assert.equal(sent.length, 0)
})

test('IPCProxy: typeof de algo que no existe en el socket debe ser "undefined"', { todo: 'fase 2: manifiesto del socket' }, () => {
    const { sock } = makeProxy()
    assert.equal(typeof sock.metodoQueNoExiste, 'undefined')
})

test('IPCProxy: sock.x?.() no debe llamar si x no existe', { todo: 'fase 2' }, () => {
    const { sock, sent } = makeProxy()
    sock.metodoQueNoExiste?.()
    assert.equal(sent.length, 0)
})

test('IPCProxy: un Buffer pasado como argumento debe conservarse como Buffer', { todo: 'fase 4: códec' }, () => {
    const { sock, sent } = makeProxy()
    sock.m(Buffer.from([1, 2, 3]))
    assert.ok(Buffer.isBuffer(sent[0].ARGS[0]) || sent[0].ARGS[0] instanceof Uint8Array, `llegó como ${JSON.stringify(sent[0].ARGS[0])}`)
})

test('IPCProxy: un método llamado "sendMessage" dentro de otra ruta no debe interceptarse', { todo: 'fase 2' }, () => {
    const { sock, sent } = makeProxy({ sendMessage: () => 'interceptado' })
    sock.newsletter.sendMessage('j')
    assert.equal(sent.length, 1)
    assert.deepEqual(sent[0].PATH, ['newsletter', 'sendMessage'])
})
