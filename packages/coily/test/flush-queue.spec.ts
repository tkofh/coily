import { describe, expect, test, vi } from 'vitest'
import { FlushQueue } from '../src/flush-queue.ts'

describe('FlushQueue', () => {
  test('runs requests immediately when no pass is active', () => {
    const queue = new FlushQueue()
    const callback = vi.fn()

    queue.request(callback)

    expect(callback).toHaveBeenCalledOnce()
  })

  test('defers requests until the end of a batch', () => {
    const queue = new FlushQueue()
    const callback = vi.fn()

    queue.batch(() => {
      queue.request(callback)
      expect(callback).not.toHaveBeenCalled()
    })

    expect(callback).toHaveBeenCalledOnce()
  })

  test('deduplicates a callback requested multiple times in one pass', () => {
    const queue = new FlushQueue()
    const callback = vi.fn()

    queue.batch(() => {
      queue.request(callback)
      queue.request(callback)
      queue.request(callback)
    })

    expect(callback).toHaveBeenCalledOnce()
  })

  test('drains callbacks in request order', () => {
    const queue = new FlushQueue()
    const order: string[] = []

    queue.batch(() => {
      queue.request(() => order.push('a'))
      queue.request(() => order.push('b'))
      queue.request(() => order.push('c'))
    })

    expect(order).toEqual(['a', 'b', 'c'])
  })

  test('drains only when the outermost nested pass ends', () => {
    const queue = new FlushQueue()
    const callback = vi.fn()

    queue.batch(() => {
      queue.batch(() => {
        queue.request(callback)
      })
      expect(callback).not.toHaveBeenCalled()
    })

    expect(callback).toHaveBeenCalledOnce()
  })

  test('requests made while draining run immediately', () => {
    const queue = new FlushQueue()
    const order: string[] = []

    queue.batch(() => {
      queue.request(() => {
        order.push('queued')
        queue.request(() => order.push('nested'))
      })
    })

    expect(order).toEqual(['queued', 'nested'])
  })

  test('batches opened while draining defer their requests', () => {
    const queue = new FlushQueue()
    const order: string[] = []

    queue.batch(() => {
      queue.request(() => {
        queue.batch(() => {
          queue.request(() => order.push('inner'))
          order.push('outer')
        })
      })
    })

    expect(order).toEqual(['outer', 'inner'])
  })

  test('drains queued callbacks when the pass body throws', () => {
    const queue = new FlushQueue()
    const callback = vi.fn()

    expect(() => {
      queue.batch(() => {
        queue.request(callback)
        throw new Error('boom')
      })
    }).toThrow('boom')

    expect(callback).toHaveBeenCalledOnce()
  })

  test('enter/exit behave like batch', () => {
    const queue = new FlushQueue()
    const callback = vi.fn()

    queue.enter()
    queue.request(callback)
    expect(callback).not.toHaveBeenCalled()
    queue.exit()

    expect(callback).toHaveBeenCalledOnce()
  })
})
