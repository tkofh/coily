import { createSpringSystem, springConfig } from 'coily'
import './style.css'

document.addEventListener('DOMContentLoaded', () => {
  const system = createSpringSystem()
  const bouncyConfig = springConfig({ dampingRatio: 1.1, duration: 750 })
  const stiffConfig = springConfig({ mass: 5, tension: 500, damping: 400 })

  console.log(bouncyConfig)

  const springX = system.createSpring(0, bouncyConfig)
  const springY = system.createSpring(0, bouncyConfig)

  const spring2X = system.createSpring(0, stiffConfig)
  const spring2Y = system.createSpring(0, stiffConfig)

  const ball = document.querySelector('#ball') as HTMLDivElement
  const ball2 = document.querySelector('#ball2') as HTMLDivElement

  system.start()

  document.addEventListener('mousemove', (event) => {
    spring2X.target = event.clientX
    spring2Y.target = event.clientY
    springX.target = event.clientX
    springY.target = event.clientY
  })

  springX.onUpdate(() => {
    ball.style.setProperty('--x', String(springX.value))
  })
  springY.onUpdate(() => {
    ball.style.setProperty('--y', String(springY.value))
  })
  spring2X.onUpdate(() => {
    ball2.style.setProperty('--x', String(spring2X.value))
  })
  spring2Y.onUpdate(() => {
    ball2.style.setProperty('--y', String(spring2Y.value))
  })
})
