import { createApp } from 'vue'
import { createSpringSystem } from 'coily'
import { createTicker } from 'tickloop'
import { createCoilyPlugin } from '../src'
import App from './App.vue'

const system = createSpringSystem()
createTicker().add((_, delta) => {
  system.simulate(delta)
})

const app = createApp(App)
app.use(createCoilyPlugin({ system }))
app.mount('#app')
