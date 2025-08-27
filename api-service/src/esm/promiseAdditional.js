const $easyTry = p => p.then(r => [null, r]).catch(e => [e, null])
if (!Promise.prototype.$easyTry) {
	Object.defineProperty(Promise.prototype, '$easyTry', {
		value: function() {
			// 调用上面定义的 $easyTry 函数，并将当前 Promise 实例作为参数传递
			return $easyTry(this);
		},
		writable: true,
		configurable: true
	});
}