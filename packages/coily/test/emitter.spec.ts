import { describe, expect, test, vi } from 'vitest'
import { Emitter } from '../src/emitter'

describe('Emitter', () => {
  test('calls registered handler on emit', () => {
    const emitter = new Emitter()
    const handler = vi.fn()

    emitter.on('update', handler)
    emitter.emit('update')

    expect(handler).toHaveBeenCalledOnce()
  })

  test('supports multiple handlers for the same event', () => {
    const emitter = new Emitter()
    const a = vi.fn()
    const b = vi.fn()

    emitter.on('update', a)
    emitter.on('update', b)
    emitter.emit('update')

    expect(a).toHaveBeenCalledOnce()
    expect(b).toHaveBeenCalledOnce()
  })

  test('on() returns an unsubscribe function', () => {
    const emitter = new Emitter()
    const handler = vi.fn()

    const unsub = emitter.on('update', handler)
    unsub()
    emitter.emit('update')

    expect(handler).not.toHaveBeenCalled()
  })

  test('off() removes a specific handler', () => {
    const emitter = new Emitter()
    const a = vi.fn()
    const b = vi.fn()

    emitter.on('update', a)
    emitter.on('update', b)
    emitter.off('update', a)
    emitter.emit('update')

    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledOnce()
  })

  test('off() without handler removes all handlers for that event', () => {
    const emitter = new Emitter()
    const a = vi.fn()
    const b = vi.fn()

    emitter.on('update', a)
    emitter.on('update', b)
    emitter.off('update')
    emitter.emit('update')

    expect(a).not.toHaveBeenCalled()
    expect(b).not.toHaveBeenCalled()
  })

  test('clear() removes all handlers for all events', () => {
    const emitter = new Emitter()
    const updateHandler = vi.fn()
    const startHandler = vi.fn()

    emitter.on('update', updateHandler)
    emitter.on('start', startHandler)
    emitter.clear()
    emitter.emit('update')
    emitter.emit('start')

    expect(updateHandler).not.toHaveBeenCalled()
    expect(startHandler).not.toHaveBeenCalled()
  })

  test('emit on unregistered event does not throw', () => {
    const emitter = new Emitter()
    expect(() => emitter.emit('update')).not.toThrow()
  })

  test('handler removed during emit does not affect current dispatch', () => {
    const emitter = new Emitter()
    const second = vi.fn()

    emitter.on('update', () => {
      emitter.off('update', second)
    })
    emitter.on('update', second)
    emitter.emit('update')

    // The slice() in emit should protect the iteration
    expect(second).toHaveBeenCalledOnce()
  })
})
