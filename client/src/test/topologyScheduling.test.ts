import assert from 'node:assert/strict'
import test from 'node:test'
import { DisplayGeometryClient } from '../src/core/worker/displayGeometryClient'
import { fixture, tick, view } from './topologyFixture'

test('camera frames request new visible blocks while moving and merge input bursts', async t => {
    const f = fixture(t)
    await f.ready()
    f.camera.moving = true
    for (let i = 1; i <= 120; i++) {
        f.camera.center = i
        f.camera.emit('move')
        f.camera.emit('zoom')
    }
    assert.equal(f.calls.length, 1, 'raw camera events must coalesce until the browser frame')
    assert.equal(f.frames.size, 1)
    await f.frame()
    assert.equal(f.calls.length, 2, 'a moving camera must start loading before moveend')
    assert.equal(f.calls[1].center, 120)
    assert.notDeepEqual(f.calls[1].blocks, f.calls[0].blocks, 'the request must select the new viewport geometry')
    assert.equal(f.calls[0].signal.aborted, false)
    f.calls[1].resolve(view)
    await tick()
    assert.equal(f.layer.isReady, true)
    assert.equal(f.camera.isMoving(), true, 'the new viewport must commit during motion')
    f.camera.center = 200
    f.camera.emit('move')
    await f.frame()
    assert.equal(f.calls.length, 3)
    f.camera.center = 240
    f.camera.moving = false
    f.camera.emit('moveend')
    await f.frame()
    f.calls[2].resolve(view)
    await tick()
    assert.equal(f.calls.length, 4)
    assert.equal(f.calls[3].center, 240, 'the final view must follow the active request')
    f.calls[3].resolve(view)
    await tick()
    assert.equal(f.frames.size, 0)
    assert.equal(f.layer.isReady, true)
    assert.equal(f.maxActive(), 1)
    f.camera.emit('moveend')
    f.camera.emit('resize')
    await f.frame()
    assert.equal(f.calls.length, 4, 'an unchanged camera must be deduplicated')
    await f.frame()
    assert.equal(f.frames.size, 0, 'an idle camera must not keep scheduling frames')
})

test('one in-flight query coalesces camera bursts and reaches final ready', async t => {
    const f = fixture(t)
    const started = f.start()
    await tick()
    f.camera.moving = true
    for (let i = 1; i <= 120; i++) {
        f.camera.center = i
        f.camera.emit('move')
        f.camera.emit('resize')
        await f.frame()
    }
    assert.equal(f.calls.length, 1)
    assert.equal(f.calls[0].signal.aborted, false)
    f.calls[0].resolve(view)
    await tick()
    assert.equal(f.calls.length, 2)
    assert.equal(f.calls[1].center, 120, 'only the most recent camera may follow the first query')
    assert.equal(f.layer.isReady, false)
    for (let i = 121; i <= 240; i++) {
        f.camera.center = i
        f.camera.emit('resize')
        await f.frame()
    }
    assert.equal(f.calls.length, 2)
    assert.equal(f.calls[1].signal.aborted, false)
    f.calls[1].resolve(view)
    await tick()
    assert.equal(f.calls.length, 3)
    assert.equal(f.calls[2].center, 240)
    f.calls[2].resolve(view)
    await started
    assert.equal(f.camera.isMoving(), true)
    assert.equal(f.layer.isReady, true)
    assert.equal(f.maxActive(), 1)
    assert.ok(f.calls.every(call => !call.signal.aborted))
})

test('a superseded zoom response cannot commit geometry or mark the latest view ready', async t => {
    const f = fixture(t)
    await f.ready()
    f.camera.zoom = 9
    f.camera.emit('zoom')
    await f.frame()
    assert.equal(f.calls.length, 2)
    f.camera.zoom = 11
    f.camera.emit('zoom')
    await f.frame()
    const before = Reflect.get(f.layer, '_view')
    f.calls[1].resolve({ chunks: [] })
    await tick()
    assert.equal(Reflect.get(f.layer, '_view'), before)
    assert.equal(f.calls.length, 3)
    assert.equal(f.layer.isReady, false)
    f.calls[2].resolve(view)
    await tick()
    assert.equal(f.layer.isReady, true)
    assert.equal(f.maxActive(), 1)
})

test('HTTP completed for an obsolete zoom skips decode and still drains the latest view in the same load', async t => {
    const f = fixture(t)
    await f.ready()
    f.camera.zoom = 9
    f.camera.emit('zoom')
    await f.frame()
    const old = f.calls[1]
    f.camera.zoom = 11
    f.camera.emit('zoom')
    await f.frame()
    // Invalid bytes make an accidental decoder call fail as GDN5, rather than
    // silently looking like an aborted obsolete camera.
    let aborted: unknown
    try { await old.decode!([{ block: old.blocks[0], buffer: new ArrayBuffer(1) }]) }
    catch (error) { aborted = error }
    assert.equal((aborted as Error).name, 'AbortError')
    assert.equal(old.signal.aborted, true)
    old.reject(aborted)
    await tick()
    assert.equal(f.calls.length, 3)
    assert.equal(f.layer.isReady, false)
    assert.equal(f.calls[2].signal.aborted, false)
    f.calls[2].resolve(view)
    await tick()
    assert.equal(f.layer.isReady, true)
    assert.equal(f.maxActive(), 1)
})

test('hide cancels the active lifecycle and queued cameras cannot restart it', async t => {
    const f = fixture(t)
    const started = f.start()
    await tick()
    f.camera.center = 1
    f.camera.emit('move')
    assert.equal(f.frames.size, 1)
    f.layer.hide()
    assert.equal(f.frames.size, 0, 'hide must cancel the queued camera frame')
    assert.equal(f.calls[0].signal.aborted, true)
    f.calls[0].resolve(view)
    await started
    await tick()
    assert.equal(f.calls.length, 1)
    f.layer.show()
    await tick()
    assert.equal(f.calls.length, 2)
    f.calls[1].resolve(view)
    await tick()
    assert.equal(f.layer.isReady, true)
})

test('source replacement cancels only the old lifecycle and ignores its late response', async t => {
    const f = fixture(t)
    const old = f.start()
    await tick()
    f.camera.center = 100
    f.camera.emit('resize')
    const current = f.start()
    await tick()
    assert.equal(f.calls.length, 2)
    assert.equal(f.calls[0].signal.aborted, true)
    assert.equal(f.calls[1].signal.aborted, false)
    f.calls[0].resolve({ chunks: [] }) // Must never reach source validation.
    await old
    assert.equal(f.layer.isReady, false)
    f.calls[1].resolve(view)
    await current
    assert.equal(f.layer.isReady, true)
    f.camera.emit('moveend')
    await f.frame()
    assert.equal(f.calls.length, 2)
})

test('remove cancels the active load and queued frame without restarting', async t => {
    const f = fixture(t)
    const started = f.start()
    await tick()
    f.camera.center = 100
    f.camera.emit('move')
    f.layer.remove(f.camera as never, undefined as never)
    assert.equal(f.calls[0].signal.aborted, true)
    assert.equal(f.frames.size, 0)
    f.calls[0].resolve(view)
    await started
    await f.frame()
    assert.equal(f.calls.length, 1)
    assert.equal(f.layer.isReady, false)
    assert.ok([...f.camera.listeners.values()].every(listeners => listeners.size === 0))
})

test('context loss cancels active and queued camera work and suspends new queries', async t => {
    const f = fixture(t)
    const started = f.start()
    await tick()
    f.camera.emit('move')
    f.camera.canvas.dispatchEvent(new Event('webglcontextlost'))
    assert.equal(f.calls[0].signal.aborted, true)
    assert.equal(f.frames.size, 0)
    f.calls[0].resolve(view)
    await started
    f.camera.center = 100
    f.camera.emit('move')
    f.camera.emit('resize')
    await f.frame()
    assert.equal(f.calls.length, 1)
    assert.equal(f.layer.isReady, false)
})

test('viewport errors reach the shared listener immediately and successful recovery clears them', async t => {
    const f = fixture(t)
    const errors: unknown[] = []
    const unsubscribe = f.layer.addErrorListener(error => errors.push(error))
    assert.deepEqual(errors, [null])
    const started = f.start()
    await tick()
    const error = new Error('viewport unavailable')
    f.calls[0].reject(error)
    await assert.rejects(started, /viewport unavailable/)
    assert.deepEqual(errors, [null, error])
    const late: unknown[] = []
    const stopLate = f.layer.addErrorListener(value => late.push(value))
    assert.deepEqual(late, [error])
    f.camera.emit('resize')
    await f.frame()
    assert.equal(f.calls.length, 2)
    f.calls[1].resolve(view)
    await tick()
    assert.equal(errors.at(-1), null)
    assert.equal(f.layer.isReady, true)
    unsubscribe(); stopLate()
})

test('DPR-only camera changes supersede a pending selection and enter the selection RPC', async t => {
    const run = DisplayGeometryClient.prototype.run
    const radii: number[] = []
    DisplayGeometryClient.prototype.run = function (task, continueAfterBlock) {
        if (task.type === 'select') radii.push(task.requiredRadius ?? 0.75)
        return run.call(this, task, continueAfterBlock)
    }
    t.after(() => { DisplayGeometryClient.prototype.run = run })
    const f = fixture(t)
    await f.ready()
    f.camera.zoom = 9
    f.camera.emit('zoom')
    await f.frame()
    const stale = f.calls[1]
    f.camera.canvas.width = 50
    f.camera.canvas.height = 50
    f.camera.emit('resize')
    await f.frame()
    let cancelled: unknown
    try { await stale.decode!([{ block: stale.blocks[0], buffer: new ArrayBuffer(1) }]) }
    catch (error) { cancelled = error }
    assert.equal((cancelled as Error).name, 'AbortError')
    stale.reject(cancelled)
    await tick()
    assert.equal(f.calls.length, 3)
    assert.equal(radii.at(-1), 1.5)
    f.calls[2].resolve(view)
    await tick()
    assert.equal(f.layer.isReady, true)
})
