/**
 * Async TimeOut
 * @param mls
 * @returns {Promise<any>}
 */
function asleep(mls) {
	return new Promise((g) => {
		setTimeout(() => {
			g(true);
		}, mls || 1);
	})
}

/**
 * Create ID
 * @param need_count
 * @param abc
 * @returns {string}
 */
function create_id(need_count = 8, abc = 0) {
	if (abc === 0) abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	else if (abc === 1) abc = "0123456789";
	
	let text = "",
		possible = abc;
	
	for (let i = 0; i < need_count; i++)
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	
	return text;
}

/**
 * Generated rand integer
 * @param min
 * @param max
 * @returns {number}
 */
function rand(min, max) {
	return Math.round(min + Math.random() * (max - min));
}

/**
 * Parse JSON with default value
 * @param text
 * @param return_with_error => Return this, if get error with parse
 * @param skip_errors => (boolean) Display error in console?
 * @returns {*}
 */
function json_parse(text, return_with_error, skip_errors) {
	skip_errors = skip_errors === true;
	let return_json = return_with_error;
	try {
		return_json = JSON.parse(text);
	} catch (err) {
		if (skip_errors === false) console.log("json_parse::", err);
	}
	return return_json;
}

/**
 * Clone object
 * Создаём независимый объект (с утерей ссылок)
 * @param o
 * @returns {*}
 */
function clone(o) {
	let out, v, key;
	out = Array.isArray(o) ? [] : {};
	for (key in o) {
		v = o[key];
		out[key] = (typeof v === "object" && v !== null) ? clone(v) : v;
	}
	return out;
}

/**
 * Cache buffer
 * Ограничиваем нагрузку, создавая "слушателей" на выполнение главной функции.
 * Множественные запросы превращаются в один. После выполнения его, на все сделанные запросы отправляетсся этот ответ
 *
 * this.request(args) => args конвертируются в ID. Очереди с разными ID независимы друг от друга
 * @param settings_from_args: {countdown: int)
 * @returns object
 */
function buffer_request(settings_from_args = {}) {
	const settings = Object.assign({
		debug: false,
		countdown: 3 * 1000,
	}, settings_from_args);
	
	/*const _data = (() => {
		const info = {
			timestamp: null,
			data: undefined,
		};
		
		const _set = data => {
			info.data = data;
			info.timestamp = Date.now();
			return true;
		};
		const _get = () => info;
		
		const lifetime_calc = (first_data = Date.now()) => {
			return first_data - info.timestamp;
		};
		
		return {
			update: _set,
			get get() {
				return _get().data
			},
			lifetime: lifetime_calc
		}
	})();*/
	
	/**
	 * Совмещение технологий "чужих" и своих
	 */
	const handler = (() => {
		let _fn_used = () => Promise.reject("Not is set handler");
		
		return {
			set fn(fn_from_args) {
				if (typeof fn_from_args !== "function") throw "Handler must be a function";
				let fn_need = fn_from_args;
				// need async\promise, set if empty
				if (["Promise", "AsyncFunction"].indexOf(fn_need.constructor.name) === -1) {
					fn_need = async function () {
						return fn_from_args.apply(this, arguments);
					};
				}
				
				_fn_used = fn_need;
				return true;
			},
			launch: async function (args) {
				return _fn_used.call(this, args);
			},
		}
	})();
	const request = (() => {
		const _query = {
			id: {
				list: [
					/*{
						args: [],
						cb: {g: null, b: null}
					}*/
				],
				status: {
					is_run: false,
					timestamp: null,
					timer: null,
				}
			}
		};
		
		let _args_to_id = (args) => (typeof args[0] === "string" || typeof args[0] === "number") ? args[0].toString() : args.length > 0 ? args.join("_") : "_default";
		
		const _args_to_req = (args) => {
			const req = {
				uid: null,
				data: null,
			};
			if (args.uid !== undefined) req.uid = args.uid;
			else req.uid = args;
			if (Array.isArray(req.uid) === false) req.uid = [req.uid];
			
			if (args.data !== undefined) req.data = args.data;
			else req.data = args;
			
			return req;
		};
		
		let _run = async (args) => {
			const req = _args_to_req(args);
			
			const id = _args_to_id(req.uid);
			const one = _query[id];
			if (one === undefined || typeof one !== "object") throw `No exist query line by '${id}' id`;
			if (one.status.is_run === true) return "Already run";
			if (one.list.length <= 0) return "Empty query";
			
			let cd_time = (one.status.timestamp + settings.countdown) - Date.now();
			if (cd_time > 0) {
				if (settings.debug === true) console.log(`Need wait '${cd_time}' before run; wait and run`);
				clearTimeout(one.status.timer);
				return one.status.timer = setTimeout(_run, cd_time, args);
			}
			
			one.status.is_run = true;
			try {
				if (settings.debug === true) console.log("Типо запуск обычной функции");
				const resp = {success: false, result: undefined};
				// Аргументы не учитываются, возможно стоит их убрать
				try {
					resp.result = handler.launch.apply(this, [req.data]);
					if (one === undefined || typeof one !== "object") {
						// noinspection ExceptionCaughtLocallyJS
						throw `No exist query line by '${id}' id::after request`;
					}
					resp.success = true;
				} catch (e) {
					resp.result = e;
					resp.success = false;
				}
				while (one.list.length > 0) {
					const req = one.list.shift();
					if (resp.success === true) req.cb.g(resp.result);
					if (resp.success === false) req.cb.b(resp.result);
				}
			} finally {
				one.status.is_run = false;
				one.status.timestamp = Date.now();
			}
			return null;
		};
		
		// add and launch
		return async (args = []) => {
			const req = _args_to_req(args);
			const id = _args_to_id(req.uid);
			
			if (_query[id] === undefined) _query[id] = {
				list: [],
				status: {
					is_run: false,
					timestamp: null,
					timer: null,
				},
			};
			
			if (settings.debug === true) console.log("_query see::", Object.keys(_query));
			
			let res = new Promise((g, b) => _query[id].list.push({cb: {g, b}}));
			// noinspection JSIgnoredPromiseFromCall
			_run(args);
			return res;
		};
	})();
	
	return {
		get settings() {
			return settings;
		},
		handler,
		request,
	};
	/*
	 x = new buffer_request({debug:true});
	 x.handler.fn = () => console.log("ok 1.. fn input handler JOBing");
	 x.handler.request();
	 x.handler.request();
	 x.handler.request();
	 
	 x.handler.request("user_1_countdown");
	 x.handler.request("user_1_countdown");
	 
	 x.handler.request("user_2_countdown");
	 x.handler.request("user_2_countdown");
	 */
}

/**
 * "Бригадир" запросов. Балансировка использования исполнителей к списку задач
 * @param worker_function
 * @param ended_job
 * @returns {{jobs: ({add, list, get}|*), workers: ({run, add, list, fn}|*)}}
 * @constructor
 */
function workering(worker_function, ended_job = {}) {
	if (typeof worker_function !== "function") throw "[Workering] Must set function!";
	const fns = {
		worker_do: worker_function,
		ended_job: Object.assign({
			success: () => Promise.resolve(true),
			fail: () => Promise.resolve(true),
		}, ended_job)
	};
	let jobs;
	let workers;
	// Задачи для исполнителя
	jobs = (() => {
		let list = [];
		const add = (args, worker_do = fns.worker_do, ended_job = fns.ended_job) => {
			const job = {
				promises: {finish: undefined, success: undefined, fail: undefined},
				ended_job: ended_job || fns.ended_job,
				worker_do: worker_do || fns.worker_do,
				args: Object.assign({}, args)
			};
			job.promises.finish = new Promise((g, b) => {
				job.promises.success = g;
				job.promises.fail = b;
			});
			list.push(job);
			workers.run();
			return job.promises.finish;
		};
		let get = () => list.shift();
		
		return {
			add,
			get list() {
				return list;
			},
			get
		};
	})();
	
	// Исполнители
	workers = (() => {
		const list = {
			total: {},
			free: {}
		};
		const add = (args = {}) => {
			let worker = {
				details: args,
				name: args["_worker_name"] || Math.random().toString(),
				is_busy: false
			};
			list.total[worker.name] = worker;
			list.free [worker.name] = Date.now();
			return worker;
		};
		
		let query_is_run = false;
		const run = () => {
			if (jobs.list.length <= 0) return "Nothing to do";
			if (query_is_run === true) return "Already run";
			let free_workers = Object.keys(list.free);
			if (free_workers.length <= 0) return "All workers is busy. He auto get new job after end";
			while (free_workers.length > 0) {
				if (jobs.list.length <= 0) break;
				let worker_name = free_workers.pop();
				// noinspection JSIgnoredPromiseFromCall
				_lets_job(worker_name)
			}
			query_is_run = false;
		};
		const _lets_job = async (worker_name) => {
			let worker = list.total[worker_name];
			if (worker === undefined || list.free[worker_name] === undefined) return "Worker is busy";
			let job = jobs.get();
			if (job === undefined) return "Ops, no jobs";
			//console.log("Find job, set busy::", job);
			delete list.free[worker_name];
			worker.is_busy = true;
			let res = {
				success: false,
				message: null,
			};
			try {
				//console.log("START DO JOB[0]");
				res.message = await job.worker_do(job.args, worker.details);
				res.success = true;
				//console.log("END DO JOB[0]")
			} catch (e) {
				console.log("END DO JOB[Error]", e)
				
				res.message = e;
				res.success = false;
			}
			//console.log("Job is done, go ended::", res);
			// noinspection JSIgnoredPromiseFromCall
			_ended_job(worker_name, job, res.success);
			return job.promises[res.success === true ? "success" : "fail"](res.message);
		};
		const _ended_job = async (worker_name, job, successfully = false) => {
			let worker = list.total[worker_name];
			if (worker === undefined) throw "Worker is lag!";
			if (worker.is_busy === false) return "Worker already is free";
			try {
				let cell = successfully === true ? "success" : "fail";
				//console.log("job.ended_job::", job, Object.keys(job.ended_job), cell, job.ended_job[cell]);
				await job.ended_job[cell](job);
			} catch (e) {
				console.log("Error with ended job::error::", e);
			}
			worker.is_busy = false;
			list.free[worker_name] = Date.now();
			return run();
		};
		
		return {
			run,
			add,
			get list() {
				return list
			},
			set fn(new_function) {
				return fns.worker_do = new_function;
			}
		};
	})();
	
	
	return {
		// Set JOB functions
		jobs, workers,
	}
	
}

const Workering_v2 = ({count = 1} = {}) => {
	const _queue = require('queue');
	const q = _queue({autostart: true, concurrency: count});
	
	let _fn = () => Promise.reject("not set function");
	
	
	const _add = async (args, fn_job = _fn) => {
		if (typeof fn_job !== "function") fn_job = _fn;
		//console.log("fn_job::", fn_job,fn_job.toString())
		
		const res = {
			success: false,
			msg: null,
		};
		
		await new Promise((g_main) =>
			q.push(() =>
				new Promise(async (g) => {
					try {
						//console.log("workering::_add:: fn_job", fn_job);
						const _res = await fn_job(args);
						res.success = true;
						res.msg = _res;
					} catch (e) {
						res.success = false;
						res.msg = e;
					}
					return g(true);
				}).then(
					g_main,
					(err) => (res.success = false, res.msg = err)
				))
		);
		
		if (res.success === false) throw res.msg;
		return res.msg;
	};
	
	return {
		set fn(data) {
			_fn = data;
		},
		job: _add
	}
};

/**
 * Сортировка ассоциативного и обычного массива
 *
 * @param first => Первый аргумент
 * @param second => Второй аргумент
 * @param cell => Значение ячейки для сортировки
 *
 */
function sort_by_cell(first, second, cell = "price") {
	const one = cell === null ? first : first[cell];
	const two = cell === null ? second : second[cell];
	if (one < two) return 1;
	if (one > two) return -1;
	return 0;
}

/**
 * Преобразовывает `timestamp` в строку даты ( 2019.02.14 08:52 )
 * @param timestamp_from
 * @returns {string}
 */
const timestamp_to_date = timestamp_from => {
	const timestamp = new Date(timestamp_from);
	return [
			timestamp.getFullYear(),
			(timestamp.getMonth() + 1).toString().padStart(2, "0"),
			(timestamp.getUTCDate()).toString().padStart(2, "0"),
		].join(".")
		+ " " +
		[
			(timestamp.getHours()).toString().padStart(2, "0"),
			(timestamp.getMinutes()).toString().padStart(2, "0")
		].join(":");
};

/**
 * Check values
 */
const _is = (() => {
	const numbers = (() => {
		const _reg = new RegExp('^[0-9]+$');
		return (text = null, length = null) =>
			typeof text === "string" &&
			text.length > 0 &&
			_reg.test(text) &&
			(length === null ? true : text.length === length)
	})();
	
	const hex = (() => {
		const _reg = new RegExp('[^A-z0-9]');
		return (text = null, length = null) =>
			typeof text === "string" &&
			text.length > 0 &&
			_reg.test(text) === false &&
			(length === null ? true : text.length === length)
	})();
	
	const hex_extended = (() => {
		const _reg = new RegExp('[^A-z0-9_]');
		return (text = null, length = null) =>
			typeof text === "string" &&
			text.length > 0 &&
			_reg.test(text) === false &&
			(length === null ? true : text.length === length)
	})();
	
	const token = (() => {
		const _token_length = 32;
		return text => hex(text, _token_length)
	})();
	
	const user_uid = (() => {
		const _length = 7;
		return text => hex(text) && text.length === _length && text[0] === "_"
	})();
	
	
	const float = (text = null) => {
		if (typeof text !== "string") return false;
		const splited = text.split(".");
		if (splited.length !== 2) return false;
		if (numbers(splited[0]) === false) return false;
		// noinspection RedundantIfStatementJS
		if (numbers(splited[1]) === false) return false;
		return true;
	};
	
	const ip_v4 = (() => {
		const _length = {min: 3, max: 50};
		const _reg = new RegExp('^([0-9]{1,3}\.){3}[0-9]{1,3}(([0-9]|[1-2][0-9]|3[0-2]))?$')
		return text => typeof text === "string" && text.length >= _length.min && text.length <= _length.max && _reg.test(text) && text === text.trim();
	})();
	
	const ip_v4__strict = (() => {
		const _length = {min: 3, max: 50};
		const _reg = new RegExp('^((25[0-5]|(2[0-4]|1\\d|[1-9]|)\\d)(\\.(?!$)|$)){4}$')
		return text => typeof text === "string" && text.length >= _length.min && text.length <= _length.max && _reg.test(text) && text === text.trim();
	})();
	
	const ip_any = (() => {
		const _length = {min: 3, max: 50};
		const _reg = new RegExp('((^\\s*((([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5]))\\s*$)|(^\\s*((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}))|:)))(%.+)?\\s*$))')
		return text => typeof text === "string" && text.length >= _length.min && text.length <= _length.max && _reg.test(text) && text === text.trim();
	})();
	
	const uw_long = (text = null) => hex(text, 6);
	
	const articles_uid = (text = null) => hex(text, 12);
	
	return {
		numbers, hex,
		hex_extended,
		token, user_uid,
		float, ip_v4, ip_any,ip_v4__strict,
		articles_uid,
		uw_long,
		
	}
})();


/**
 * Сложный объект в одноразмерный.
 * { x: 1, b:{ c: 3, d: 4} } => {x: 1, b__c: 3, b__d: 4}
 */
const obj_lazy = (() => {
	const encode = (obj, prefix = null, delimiter = "__") => {
		let res = {};
		
		for (const cell in obj) {
			const data = obj[cell];
			let _to_assign = {};
			if (typeof data === "object" && data !== null && data !== undefined) {
				//console.log("data", data);
				let _to_keys = encode(data, prefix, delimiter);
				for (let key in _to_keys) {
					_to_assign[cell + delimiter + key] = _to_keys[key];
				}
			} else {
				_to_assign[prefix === null ? cell : prefix + cell] = data;
			}
			//console.log("_to_assign::", _to_assign);
			res = Object.assign(res, _to_assign);
		}
		
		return res;
	};
	
	const decode = (source_part, prefix = null, delimiter = "___") => {
		if (prefix !== null) throw "unsupported_args";
		const result = {};
		
		for (const cell_source in source_part) {
			if (source_part.hasOwnProperty(cell_source) === false) continue;
			
			const value = source_part[cell_source];
			const [cell_first, ...cell_another] = cell_source.split(delimiter);
			
			result[cell_first] = cell_another.length === 0
				? value
				: {
					...result[cell_first],
					...decode({[cell_another.join(delimiter)]: value}, prefix, delimiter),
				}
		}
		return result;
	};
	
	return {encode, decode,};
})();

const events_core = () => {
	let subscribers = [];
	let emit = (data, _event_type = undefined) => {
		if (_event_type !== undefined) data = Object.assign({_event_type}, data);
		subscribers.forEach((on, cell) => {
			if (on._event_type !== null && (data._event_type === undefined || on._event_type !== data._event_type)) return true;
			on.cb(data);
			if (on.once === true) delete subscribers[cell];
		});
		return true;
	};
	
	let on = (_event_type = null, cb, once = false) => {
		if (typeof _event_type === "function") {
			cb = _event_type;
			_event_type = null;
		}
		if (typeof cb !== "function") return false;
		once = once === true;
		subscribers.push({_event_type, cb, once});
		return true;
	};
	
	let once = (_event_type = null, cb) => on(_event_type, cb, true);
	
	return {
		on,
		once,
		emit,
	}
};
const events_core_v2 = () => {
	const subscribers = [];
	
	const emit = (event_name = null, data = null) => {
		let count = 0;
		subscribers.forEach((on, cell) => {
			if (on.name !== null && on.name !== event_name) return false;
			if (on.once === true) delete subscribers[cell];
			on.cb(data);
			count++;
			return true;
		});
		
		return count;
	};
	
	const on = (event_name = null, cb = null, once = false) => {
		if (typeof event_name === "function") {
			const _real_event_name = cb;
			cb = event_name;
			event_name = _real_event_name;
		}
		if (typeof cb !== "function") return "Invanlid arg 'cb'";
		
		const uid = Math.random().toString() + "_" + Date.now();
		once = once === true;
		subscribers.push({name: event_name, uid, cb, once});
		return uid;
	};
	
	const once = (event_name, cb) => on(event_name, cb, true);
	
	const clear = uid => {
		if (uid === null) return false;
		const _index = subscribers.findIndex(one => one !== undefined && one.uid === uid);
		if (_index === -1) return false;
		subscribers.splice(_index, 1);
		return true;
	};
	
	const after = (event_name, {timeout = null,} = {}) => {
		if (timeout !== null && Number.isInteger(timeout) === false || timeout < 1) timeout = null;
		const res = {
			stop: null,
			wait: null,
			id: null,
			is_done: false,
		};
		const _callbacks = {g: null, b: null};
		const _timer = {
			id: null,
			is_on: timeout !== null,
		}
		
		res.wait = new Promise((g, b) => (_callbacks.g = g, _callbacks.b = b));
		res.id = once(event_name, data => {
			res.is_done = true;
			_callbacks.g(data);
			
			if (_timer.is_on === true) clearTimeout(_timer.id);
			
			return true;
		});
		
		res.stop = (type = "manual") => {
			if (res.is_done === true) return true;
			
			res.is_done = true;
			_callbacks.b("timeout");
			
			if (type !== "auto" && _timer.is_on === true) clearTimeout(_timer.id);
			clear(res.id);
			
			return true;
		};
		if (_timer.is_on === true) _timer.id = setTimeout(res.stop, timeout, "auto");
		
		return res;
	}
	
	return {
		on, once,
		emit,
		clear,
		after,
		get subscribers() {
			return subscribers
		},
	}
};

const graceful_shutdown_core = (() => {
	const work = (() => {
		const list = [];
		const add = (cb, name = "unnamed") => list.push({cb, name});
		
		return {
			add,
			get list() {
				return list
			},
		}
	})();
	
	const run = (() => {
		const data = {
			promise: null,
			fn_finish: null,
			ready: false,
		};
		
		const main = async () => {
			if (data.ready === true) return true;
			if (data.promise !== null) {
				//redis_connect.modules.telegram.send(`[graceful_shutdown][DOUBLE RUN] Мультизапрос на завершение\n<pre>${require.main.filename}</pre>`, "me");
				return data.promise;
			}
			
			data.promise = new Promise((g) => {
				data.fn_finish = g;
			});
			console.log("graceful_shutdown::run");
			const list_of_job = new Map();
			const wait_all = Promise.allSettled(
				work.list.map(async ({cb, name}) => {
					const data = {name, cb, status: "load", msg: null, timestamp_end: null};
					list_of_job.set(cb, data);
					try {
						const res = await cb();
						
						data.status = "success";
						data.msg = (res === undefined || res === null) ? "empty" : res.toString();
						list_of_job.set(cb, data);
						
						return true;
					} catch (err) {
						data.status = "fail";
						data.msg = (err === undefined || err === null) ? "empty" : err.toString();
						list_of_job.set(cb, data);
						//redis_connect.modules.telegram.send(`[graceful_shutdown][JOB FAIL]\n${name}\n${err}\n<pre>${cb.toString()}</pre>\n<pre>${require.main.filename}</pre>`, "me");
						
						return false;
					} finally {
						data.timestamp_end = Date.now();
						list_of_job.set(cb, data);
					}
					
				})
			);
			const _timer_id = setInterval(() => {
				//redis_connect.modules.telegram.send(`[graceful_shutdown][LONG WAIT] Долгое ожидание завершения\n<pre>${require.main.filename}</pre>`, "me");
			}, 3 * 1000);
			await wait_all;
			clearInterval(_timer_id);
			process.exit(1);
			return true;
		};
		
		return {
			main,
		}
	})();
	
	const init = () => {
		process.on("SIGINT", async () => {
			console.log("SIGINT INIT");
			await run.main();
			return true;
		});
	};
	
	return {
		init,
		work, run,
	}
});

function to_numbers_hash(data) {
	const s = data instanceof Object ? JSON.stringify(data) : data.toString();
	let nHash = 0;
	if (!s.length) return nHash;
	for (let i_cur = 0, i_max = s.length, n; i_cur < i_max; ++i_cur) {
		n = s.charCodeAt(i_cur);
		nHash = ((nHash << 5) - nHash) + n;
		nHash = nHash & nHash;  // Convert to 32-bit integer
	}
	return Math.abs(nHash);
}

const uid_for_request = (() => {
	const length = 3;
	const create = () => create_id(length, 1);
	const verif = data => _is.numbers(data, length);
	return {
		create, verif,
		get get() {
			return create()
		},
	};
})();

const uw_basic = (() => {
	const length = 6;
	const create = () => create_id(length, 1);
	const verif = data => _is.hex(data, length);
	return {
		create, verif,
		get get() {
			return create()
		},
	};
})();

const uw_long = (() => {
	const length = 6;
	const create = () => create_id(length, 0);
	const verif = data => _is.hex(data, length);
	return {
		create, verif,
		get get() {
			return create()
		},
	};
})();

const memcached_core = (_settings_local = {}) => {
	let _core = null;
	let settings = {url: "localhost:11211"};
	
	if (_core === null) _core = require("memcached");
	
	settings = {...settings, ..._settings_local};
	let connection = new _core(settings.url);
	
	const obj = {_source: connection, del: null, set: null, get: null};
	obj.del = async key => new Promise((g, b) => {
		obj._source.del(key, function (err, res) {
			if (err) return b(err); else return g(res);
		});
	});
	
	obj.set = async (key, value, lifetime = 0) => new Promise((g, b) => {
		obj._source.set(key, value, lifetime, (err) => {
			if (err) return b(err); else return g(value);
		});
	});
	
	obj.get = async key => new Promise((g, b) => {
		obj._source.get(key, (err, res) => {
			if (err) return b(err); else return g(res);
		});
	});
	
	return obj;
};


const by_once_core = () => {
	const _list = new Set();
	const add = uid => (_list.add(uid), true);
	const has = uid => _list.has(uid);
	const remove = uid => (_list.delete(uid), true);
	const trying = uid => {
		if (has(uid) === true) return false;
		add(uid);
		return true;
	}
	return {
		add, has, remove, trying,
	}
}


const easy_delays__core = (_init_config = null) => {
	const config = (() => {
		const _default = {
			weight: [],
			lifetime: 5 * 1000,
			limits: {
				weight: null,
				count: null,
			},
		};
		let current = null;
		
		const update = (_new = {}) => {
			current = clone({
				..._default,
				...current,
				..._new,
			});
			//console.log("config::upadate::",current,_new)
			return true;
		};
		
		const get = () => current;
		
		
		return {
			get, update,
			get current() {
				return get()
			},
			set current(val) {
				return update(val)
			},
			
			get default() {
				return _default
			},
		};
	})();
	
	const _list = new Map();
	
	const _get = uid => {
		if (_list.has(uid) === false) _list.set(uid, new Set());
		return _list.get(uid);
	}
	
	const calc = uid => {
		const res = {
			count: 0,
			weight: 0,
			limit: null,
		};
		
		const _from_list = _get(uid);
		const _arr_of_weight__last_cell_index = config.current.weight.length - 1;
		
		const _ts_current = Date.now();
		
		for (const one of _from_list) {
			if (_ts_current >= one.ts_expire) {
				_from_list.delete(one);
				continue;
			}
			
			
			const _arr_of_weight__record = config.current.weight[Math.min(
				res.count, _arr_of_weight__last_cell_index
			)];
			
			// Спец флаги, расширяющие возможности
			if (_arr_of_weight__record?.flags instanceof Set) {
				// Абсолютное значение, пропускающее все остальные начисления в weight
				if (_arr_of_weight__record?.flags.has("absolute")) res.weight = 0;
			}
			
			res.weight += (_arr_of_weight__record?.value ?? _arr_of_weight__record) || 0;
			res.count++;
		}
		
		if (Number.isSafeInteger(config.current.limits.weight) === true && res.weight > config.current.limits.weight) res.limit = "weight";
		if (Number.isSafeInteger(config.current.limits.count) === true && res.count > config.current.limits.count) res.limit = "count";
		
		return res;
	}
	
	const plus = uid => {
		const _from_list = _get(uid);
		_from_list.add({
			ts_expire: Date.now() + config.current.lifetime,
		});
		return true;
	};
	
	const clear = (() => {
		const uid = uid => {
			_list.delete(uid);
			return true;
		};
		const all = () => {
			_list.clear();
			return true;
		}
		return {uid, all};
	});
	
	const init = (_init_config = {}) => {
		config.update(_init_config);
		
		return true;
	}
	init(_init_config);
	
	
	return {
		config, clear,
		calc, plus,
	}
}

const mongodb_require = () => {
	const _local_config = require(process.env.CONFIG_PATH__NFT).mongodb_config;
	
	const {MongoClient} = require('mongodb');
	
	let _client = null;
	let _db = null;
	const _collections = new Map();
	
	
	const collection = (collection_name) => {
		if (_collections.has(collection_name) === false) {
			_collections.set(
				collection_name,
				_db.collection(collection_name)
			);
		}
		
		return _collections.get(collection_name);
	}
	
	const init = async () => {
		_client = new MongoClient(_local_config.url);
		
		await _client.connect();
		_db = _client.db(_local_config.db);
		console.log("mongo::ready");
		
		return true;
	};
	
	
	return {
		init,
		collection,
		self: {
			MongoClient,
		}
	}
};

const currency_pretty = () => {
	const currency_formatter = require('currency-formatter');
	
	return (value, type) => {
		switch (type) {
			case "rub":
			default: {
				if (value === null) return "—";
				
				return currency_formatter.format(+value, {code: 'RUB',});
			}
			
			case "ptc": {
				if (value === null) return "—";
				
				return currency_formatter.format(+value, {code: 'RUB', symbol: "%"});
			}
			
			case "int": {
				if (value === null) return "—";
				
				return currency_formatter.format(+value, {code: 'RUB', symbol: "", precision: 0,});
			}
		}
	};
}

const abash_core = () => {
	const {exec} = require('child_process');
	
	return async (cmd, {like_obj = false,timeout=false}={}) => {
		const res = {success: false, body: "init_error"};
		
		try {
			// console.log("_FN::send cmd::",[cmd]);
			const _res = await new Promise(
				(g, b) => {
					if (typeof timeout==="number" && timeout>0)setTimeout(b,timeout,"timeout");
					exec(cmd, (err, body, sys_err) => {
						// console.log("err, body, sys_err::",body,err, sys_err);
						
						if (err || sys_err) return b(err ?? sys_err);
						return g(body);
					});
				}
			);
			res.success = true;
			res.body = _res;
		} catch (e) {
			res.success = false;
			res.body = e;
		}
		
		if (like_obj === true) return res;
		
		if (res.success === false) throw res.body;
		return res.body;
	}
};

module.exports = {
	asleep, create_id, rand, to_numbers_hash, json_parse, clone, sort_by_cell, timestamp_to_date,  obj_lazy,
	buffer_request,
	workering, Workering_v2,
	events_core, events_core_v2,
	 _is,
	graceful_shutdown_core, uid_for_request, uw_basic, uw_long, memcached_core,  by_once_core, easy_delays__core, abash_core,
	mongodb_require, currency_pretty,
};
