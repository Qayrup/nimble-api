import { AdvancedEventEmitter } from '../index.js'
const globalEventBus = new AdvancedEventEmitter({}, { enabled: true })
const EVENTKEY = globalEventBus.getEvenKey()
globalEventBus.onKey(EVENTKEY.BUILT.ERROR.TEST, function (e) {
  console.log(e,
    '==============================防抖======================================='
  )
}, {
  mode: 'debounce'
})

globalEventBus.onKey(EVENTKEY.BUILT.ERROR.TEST, async function (e) {
  await new Promise(res => {
    setTimeout(_ => res(), 1000)
  })
  console.log(e,
    '==============================节流======================================='
  )
}, {
  mode: 't'
})
globalEventBus.onAll(EVENTKEY.$BUILT, function (e) {
  console.log(globalEventBus.getMetrics(EVENTKEY.BUILT.ERROR.TEST))
})
setInterval(e => globalEventBus.emit(EVENTKEY.BUILT.ERROR.TEST, 'e'), 100)