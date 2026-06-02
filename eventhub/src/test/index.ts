import { initAdvancedEvent, createAdvancedEvent } from '../index.js'
import eventhub from '../index.js'
initAdvancedEvent()
createAdvancedEvent({}, { enabled: true });
const EVENTKEY = eventhub.getEventKey()
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

