import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { BaileysIPC } from '../BaileysIPC/index.js'

export const FAKE_SOCKET = path.resolve('test/fixtures/fake-socket.js')
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Crea un gestor con almacenamiento temporal. `cleanup()` detiene todo y borra los archivos. */
export function makeManager() {
    const dir = mkdtempSync(path.join(tmpdir(), 'ipc-test-'))
    const manager = new BaileysIPC(dir)
    const cleanup = async () => {
        for (const inst of manager.instances.values()) {
            // IPCWorker programa un reinicio a los 5 s tras una caída y no comprueba si mientras tanto
            // se llamó a stop(): el worker "resucita". Se neutraliza aquí para que las pruebas terminen.
            inst.worker.start = async () => {}
            try { await inst.stop() } catch {}
        }
        manager.instances.clear()
        try { manager.StoreIPCs.db.close() } catch {}
        rmSync(dir, { recursive: true, force: true })
    }
    return { manager, dir, cleanup }
}

/** Espera a un evento 'connection.update' que cumpla `match`. Rechaza si pasa `timeout` ms. */
export function waitConnection(instance, match, timeout = 8000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { instance.off('connection.update', on); reject(new Error('timeout esperando connection.update')) }, timeout)
        const on = (u) => { if (match(u)) { clearTimeout(timer); instance.off('connection.update', on); resolve(u) } }
        instance.on('connection.update', on)
    })
}

/** Crea e inicia una instancia con el socket falso y espera a que abra. */
export async function startFake(manager, id = '51999000111', extra = {}) {
    const instance = manager.createInstance(id, { connectType: 'qr-code', socketFactory: FAKE_SOCKET, ...extra })
    const opened = waitConnection(instance, (u) => u.type === 'connection_open')
    await instance.start()
    await opened
    return instance
}

export { once }

/** Guarda los avisos del canal lateral del socket falso. */
export function watchFake(instance) {
    const calls = []
    instance.on('connection.update', (u) => { if (u.type === 'fake_call') calls.push({ name: u.name, ...u.data }) })
    const wait = async (name, timeout = 5000, from = 0) => {
        const start = Date.now()
        while (Date.now() - start < timeout) {
            const hit = calls.slice(from).find((c) => c.name === name)
            if (hit) return hit
            await sleep(20)
        }
        throw new Error(`no llegó la llamada "${name}" al socket falso`)
    }
    return { calls, wait }
}

/** Espera un evento de la instancia (por ejemplo 'messages.upsert'). */
export function waitEvent(instance, name, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout esperando "${name}"`)), timeout)
        instance.once(name, (data) => { clearTimeout(timer); resolve(data) })
    })
}
