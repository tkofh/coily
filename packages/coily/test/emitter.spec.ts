import { describe, expect, test, vi } from 'vitest'
import { Emitter } from '../src/emitter'

describe('Emitter', () => {
  test('calls registered handler on emit', () => {
    const emitter = new Emitter<{ foo: string }>()
    const handler = vi.fn()

    emitter.on('foo', handler)
    emitter.emit('foo', 'bar')

    expect(handler).toHaveBeenCalledWith('bar')
  })

  test('supports multiple handlers for the same event', () => {
    const emitter = new Emitter<{ foo: never }>()
    const a = vi.fn()
    const b = vi.fn()

    emitter.on('foo', a)
    emitter.on('foo', b)
    emitter.emit('foo')

    expect(a).toHaveBeenCalledOnce()
    expect(b).toHaveBeenCalledOnce()
  })

  test('on() returns an unsubscribe function', () => {
    const emitter = new Emitter<{ foo: never }>()
    const handler = vi.fn()

    const unsub = emitter.on('foo', handler)
    unsub()
    emitter.emit('foo')

    expect(handler).not.toHaveBeenCalled()
  })

  test('off() removes a specific handler', () => {
    const emitter = new Emitter<{ foo: never }>()
    const a = vi.fn()
    const b = vi.fn()

    emitter.on('foo', a)
    emitter.on('foo', b)
    emitter.off('foo', a)
    emitter.emit('foo')

    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledOnce()
  })

  test('off() without handler removes all handlers for that event', () => {
    const emitter = new Emitter<{ foo: never }>()
    const a = vi.fn()
    const b = vi.fn()

    emitter.on('foo', a)
    emitter.on('foo', b)
    emitter.off('foo')
    emitter.emit('foo')

    expect(a).not.toHaveBeenCalled()
    expect(b).not.toHaveBeenCalled()
  })

  test('clear() removes all handlers for all events', () => {
    const emitter = new Emitter<{ foo: never; bar: never }>()
    const fooHandler = vi.fn()
    const barHandler = vi.fn()

    emitter.on('foo', fooHandler)
    emitter.on('bar', barHandler)
    emitter.clear()
    emitter.emit('foo')
    emitter.emit('bar')

    expect(fooHandler).not.toHaveBeenCalled()
    expect(barHandler).not.toHaveBeenCalled()
  })

  test('emit on unregistered event does not throw', () => {
    const emitter = new Emitter<{ foo: never }>()
    expect(() => emitter.emit('foo')).not.toThrow()
  })

  test('handler removed during emit does not affect current dispatch', () => {
    const emitter = new Emitter<{ foo: never }>()
    const second = vi.fn()

    emitter.on('foo', () => {
      emitter.off('foo', second)
    })
    emitter.on('foo', second)
    emitter.emit('foo')

    // The slice() in emit should protect the iteration
    expect(second).toHaveBeenCalledOnce()
  })
})
