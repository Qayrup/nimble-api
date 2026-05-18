// import { createAdvancedEvent } from '../index.js'
// const globalEventBus = createAdvancedEvent({}, { enabled: true })
// const EVENTKEY = globalEventBus.getEvenKey()
// function aaa(e) {
//   console.log('EVENTKEY.$BUILT, aaaEVENTKEY.$BUILT, aaaEVENTKEY.$BUILT, aaaEVENTKEY.$BUILT, aaaEVENTKEY.$BUILT, aaa')

// }
// globalEventBus.onKey(EVENTKEY.BUILT.ERROR.TEST, function (e) {
//   console.log(e,
//     '==============================防抖======================================='
//   )
// }, {
//   mode: 'debounce'
// })
// setTimeout(() => {
//   globalEventBus.off(EVENTKEY.$BUILT, aaa)
// }, 3000)
// globalEventBus.onKey(EVENTKEY.BUILT.ERROR.TEST, function (e) {
//   new Promise(res => {
//     setTimeout(_ => res(), 1000)
//   })
//   console.info(e,
//     '==============================节流======================================='
//   )
// }, {
//   mode: 't'
// })
// globalEventBus.onAll(EVENTKEY.$BUILT, function (e) {
//   console.log(globalEventBus.getMetrics(EVENTKEY.BUILT.ERROR.TEST))
// })
// globalEventBus.onAll(EVENTKEY.$BUILT, aaa)
// setInterval(e => {
//   try {
//     globalEventBus.emit(EVENTKEY.BUILT.ERROR.TEST, 'e')
//   } catch (error) {
//     console.error(error)
//   }
// }, 100)

// setInterval(e => {
//   try {
//     globalEventBus.emit(EVENTKEY.BUILT.ERROR.TEST, 'e')
//   } catch (error) {
//     console.error(error)
//   }
// }, 100)


//===
import { initAdvancedEvent, createAdvancedEvent } from '../index.js'
import eventhub from '../index.js'
initAdvancedEvent()
createAdvancedEvent({}, { enabled: true });
const EVENTKEY = eventhub.getEvenKey()
eventhub.onKey(EVENTKEY.BUILT.ERROR.TEST, function (e) {
  console.log(e,
    '==============================防抖======================================='
  )
}, {
  mode: 'debounce'
})

eventhub.onKey(EVENTKEY.BUILT.ERROR.TEST, async function (e) {
  await new Promise<void>(res => {
    setTimeout(_ => res(), 1000)
  })
  console.log(e,
    '==============================节流======================================='
  )
}, {
  mode: 't'
})
eventhub.onAll(EVENTKEY.$BUILT, function (_e) {
  console.log(eventhub.getMetrics(EVENTKEY.BUILT.ERROR.TEST));
});
setInterval(() => eventhub.emit(EVENTKEY.BUILT.ERROR.TEST, 'e'), 100);

