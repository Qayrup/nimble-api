import { AdvancedEventEmitter } from '../index.js'
const globalEventBus = new AdvancedEventEmitter({}, { enabled: true })
const EVENTKEY = globalEventBus.getEvenKey()
function aaa(e) {
  console.log('EVENTKEY.$BUILT, aaaEVENTKEY.$BUILT, aaaEVENTKEY.$BUILT, aaaEVENTKEY.$BUILT, aaaEVENTKEY.$BUILT, aaa')

}
globalEventBus.onKey(EVENTKEY.BUILT.ERROR.TEST, function (e) {
  console.log(e,
    '==============================防抖======================================='
  )
}, {
  mode: 'debounce'
})
setTimeout(() => {
  globalEventBus.off(EVENTKEY.$BUILT, aaa)
}, 3000)
globalEventBus.onKey(EVENTKEY.BUILT.ERROR.TEST, function (e) {
  //  new Promise(res => {
  //   setTimeout(_ => res(), 1000)
  // })
  console.log(e,
    '==============================节流======================================='
  )
}, {
  mode: 't'
})
globalEventBus.onAll(EVENTKEY.$BUILT, function (e) {
  // console.log(globalEventBus.getMetrics(EVENTKEY.BUILT.ERROR.TEST))
})
globalEventBus.onAll(EVENTKEY.$BUILT, aaa)
setInterval(e => globalEventBus.emit(EVENTKEY.BUILT.ERROR.TEST, 'e'), 1000)