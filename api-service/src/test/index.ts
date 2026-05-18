import { initApiService, OPTIMIZE_TYPES } from '../index';

const configAAA = {
  phoneLogin: {
    url: '/system/login/phone/{tel}/{phoneCaptcha}',
    eventSuccess: [
      'EVENT_CONFIG.BUSINESS.USER.LOGIN_OK',
      'EVENT_CONFIG.BUSINESS.SESSION.FLUSHED_TOKEN_OK',
    ],
    eventErrors: {
      default: 'EVENT_CONFIG.BUSINESS.USER.LOGINERR_ERR',
    },
  },
};

const apiService = initApiService(configAAA);

console.log('OPTIMIZE_TYPES:', OPTIMIZE_TYPES);

//------------------------------------------------------------测试代码------------------------------------------------------------------------------------------
console.log(apiService);

const obj = { value: false };
const proxyObj = new Proxy(obj, {
  set(target: Record<string, unknown>, prop: string | symbol, value: unknown) {
    const result = Reflect.set(target, prop, value);
    console.log('-----------设置了-------', value);
    return result;
  },
  get(target: Record<string, unknown>, prop: string | symbol) {
    const val = Reflect.get(target, prop);
    console.log('访问了:', val);
    return val;
  },
});

console.log('-----------------------------------验证自定义proxyObj switch开始-------------------------------------------');
async function aaa() {
  const aaa = apiService.optimize('switchLock', proxyObj).phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 });
  const aaa2 = apiService.optimize('switchLock', proxyObj).phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 });
  const aaa3 = apiService.optimize('switchLock', proxyObj).phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 });
  console.log(
    await apiService.optimize('switchLock', proxyObj).phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 }),
  );
  console.log('-----------------------------------开始-------------------------------------------');
  aaa.then((res: unknown) => {
    console.log('aaa', res, proxyObj.value);
  });
  aaa2.then((res: unknown) => {
    console.log('aaa1', res, proxyObj.value);
  });
  aaa3.then((res: unknown) => {
    console.log('aaa2', res, proxyObj.value);
  });
}
aaa();
console.log('-----------------------------------验证自定义proxyObj switch结束-------------------------------------------');

console.log('-----------------------------------验证自维护锁 switch开始-------------------------------------------');
async function aaa1() {
  const aaa1 = apiService.optimize('switchLock').phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 });
  const aaa2 = apiService.optimize('switchLock').phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 });
  const aaa3 = apiService.optimize('switchLock').phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 });
  console.log(
    await apiService.optimize('switchLock').phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 }),
  );
  console.log('-----------------------------------开始-------------------------------------------');
  aaa1.then((res: unknown) => {
    console.log('aaa1', res);
  });
  aaa2.then((res: unknown) => {
    console.log('aaa2', res);
  });
  aaa3.then((res: unknown) => {
    console.log('aaa3', res);
  });
}
aaa1();
console.log('-----------------------------------验证自维护锁 switch结束-------------------------------------------');

console.log('-----------------------------------验证防抖 debounce开始-------------------------------------------');
async function aaa2() {
  const aaa1 = apiService.optimize('debounce').phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 });
  const aaa2 = apiService.optimize('debounce').phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 });
  const aaa3 = apiService.optimize('debounce').phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 });
  console.log(
    await apiService.optimize('debounce').phoneLoginAPI({ tel: 123, phoneCaptcha: 1212 }),
  );
  console.log('-----------------------------------开始-------------------------------------------');
  aaa1.then((res: unknown) => {
    console.log('aaa1', res);
  });
  aaa2.then((res: unknown) => {
    console.log('aaa2', res);
  });
  aaa3.then((res: unknown) => {
    console.log('aaa3', res);
  });
}
aaa2();
console.log('-----------------------------------验证防抖 debounce结束-------------------------------------------');
