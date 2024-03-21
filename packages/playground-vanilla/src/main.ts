import { createTicker } from 'tickloop'
import { SpringSystem } from '../../coily/src/system'
import './style.css'

// const q = 1 - damping ** 2

document.addEventListener('DOMContentLoaded', () => {
  const system = new SpringSystem()
  const springX = system.createSpring({
    mass: 1,
    tension: 100,
    damping: 10,
    target: 0,
  })
  const springY = system.createSpring({
    mass: 1,
    tension: 100,
    damping: 10,
    target: 0,
  })

  console.log(springY)

  const spring2X = system.createSpring({
    mass: 5,
    tension: 500,
    damping: 400,
    target: 0,
  })
  const spring2Y = system.createSpring({
    mass: 5,
    tension: 500,
    damping: 400,
    target: 0,
  })

  const ball = document.querySelector('#ball') as HTMLDivElement
  const ball2 = document.querySelector('#ball2') as HTMLDivElement
  const ticker = createTicker()
  ticker.start()

  ticker.add((_, delta) => {
    // spring2X.target = spring.value
    spring2X.target = springX.value
    spring2Y.target = springY.value
    system.tick(delta / 1000)

    ball.style.setProperty('--x', `${springX.value}px`)
    ball.style.setProperty('--y', `${springY.value}px`)
    ball2.style.setProperty('--x', `${spring2X.value}px`)
    ball2.style.setProperty('--y', `${spring2Y.value}px`)
    // console.log(spring.target, spring.value)
  })

  document.addEventListener('mousemove', (event) => {
    springX.target = event.clientX
    springY.target = event.clientY
  })
})
