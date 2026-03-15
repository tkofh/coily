import { createSpringSystem } from 'coily'
import './style.css'

document.addEventListener('DOMContentLoaded', () => {
  const system = createSpringSystem()
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

  system.start()

  document.addEventListener('mousemove', (event) => {
    spring2X.target = springX.value
    spring2Y.target = springY.value
    springX.target = event.clientX
    springY.target = event.clientY
  })

  springX.onUpdate(() => {
    ball.style.translate = `calc(${springX.value}px - 50%) calc(${springY.value}px - 50%)`
    ball2.style.translate = `calc(${spring2X.value}px - 50%) calc(${spring2Y.value}px - 50%)`
  })
})
